"""Story read/write rules — §10's feed, expiry, and the idempotent view.

**Stories are read-only for the mobile client, and only three routes exist.**
§10.1 marks ``GET /stories``, ``GET /stories/{id}`` and ``POST /stories/{id}/view``
**[M]** and ``POST /stories`` / ``DELETE /stories/{id}`` **[F]**. The client calls
exactly the three, so those three are the contract. Publication exists because a
feed with no way to fill it cannot be tested, and §10.2's "server-side
(platform/company)" is precisely the justification for a non-client writer.

**Expiry is evaluated in the query, and there is no sweeper.** §10.2 requires the
list to return "**active** stories only" and says "the client sends no date filter,
so the server owns the window". Filtering ``expires_at > now()`` at read time makes
an expired story indistinguishable from a deleted one, which is the desired
behaviour: nothing can observe an expired story, so nothing needs to have deleted
it. Adding a scheduled job (Celery, cron, a sweeper table) would be §10.2's
"periodic job" for *retention* — a different, explicitly optional concern — and
would buy no observable difference while adding a moving part.

**A publisher snapshot is taken once, at publication.** ``_publisher_payload``
copies exactly ``{name, logo_url, verified}`` from the authorised account and
nothing else. It is deliberately *not* a serialized `User`: a publisher banner is
display state, so the row must not be able to carry an email, a role, an id, or
anything resembling a credential into a JSONB column that gets read back out on
every feed request.

**``publisher_kind='company'`` cannot be honoured yet.** §14.10 pairs it with a
``company_id`` FK and a CHECK that the two agree, and `companies` is Phase 9. The
service therefore **rejects** a `company` story rather than storing one whose
company it cannot verify: accepting it would persist a claim ("this is published by
company X") that nothing in the database can stand behind, and the feed would
render an unverifiable badge. Phase 9 relaxes this one branch.

**A view is recorded once, and the schema is what guarantees it.** §14.10 makes
``(story_id, viewer_id)`` the primary key, so :func:`record_view` distinguishes
"inserted" from "already there" by reading first and letting the unique index be
the authority. Two concurrent first-views can both try to insert; exactly one
succeeds and the loser's integrity error is caught and answered as
``already_recorded=True`` rather than as a 500.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ApiError, ErrorCode, error_detail
from app.core.wire import wire_datetime
from app.models.enums import StoryPublisherKind, StoryStatus
from app.models.media import MediaAsset
from app.models.stories import Story, StoryView
from app.models.user import User
from app.realtime import content_events
from app.schemas.common import FastApiPage, build_fastapi_page
from app.schemas.stories import (
    StoryCreate,
    StoryMediaOut,
    StoryOpportunityOut,
    StoryOut,
    StoryPublisherOut,
    StoryViewOut,
)
from app.services.ownership import parse_id
from app.services.posts import POSTABLE_KINDS


def _not_found() -> ApiError:
    """The single answer for a story that is absent, expired, or archived.

    All three are the same 404 on purpose. §10.2 makes an expired story
    indistinguishable from a deleted one, and an archived story is one the operator
    withdrew; collapsing them means a caller cannot use this route to learn when a
    story was withdrawn or how long it had been up, which is not information §10
    ever intended to expose.
    """
    return ApiError(
        status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "That story was not found."
    )


def _publisher_payload(author: User, session: Session) -> dict:
    """The §10.1 publisher snapshot, taken from the authorised account.

    Exactly three keys — ``name``, ``logo_url``, ``verified`` — and that is the
    whole contract. The allow-list is a literal construction rather than "everything
    except", so adding a column to `users` cannot silently start copying it into a
    JSONB payload that is read back out on every feed request.

    ``logo_url`` is §14.11's relative ``served_at`` path, resolved through
    ``media.avatar_url_for`` so the story bubble and ``GET /users/me`` can never
    disagree about the same avatar. It is ``None`` when the account has not set one,
    which the client already handles.

    ``verified`` is always ``False``. §9.2's rule transfers directly: the client
    renders a badge from this field and nothing else, so a wrong ``True`` is a false
    credential claim, and V1 has no publisher verification signal at all.
    """
    from app.services import media as media_service

    return {
        "name": author.name,
        "logo_url": media_service.avatar_url_for(author, session),
        "verified": False,
    }


def _load_media(
    session: Session, media_id: uuid.UUID | None, author_id: uuid.UUID
) -> MediaAsset | None:
    """Authorise the story's artwork, or return ``None`` when there is none.

    Same rules posts uses, for the same reasons:

    * **Missing → 404**, because "does not exist" and "not yours" must be
      indistinguishable (Phase 7's IDOR rule).
    * **Someone else's → 403**, because the caller named a specific asset and was
      refused it; that is a real answer, not an existence leak.
    * **A document → 422**, because ``POSTABLE_KINDS`` is ``{image, video}``: a story
      bubble renders artwork, and a PDF has no dimensions to lay it out.
    """
    if media_id is None:
        return None

    asset = session.get(MediaAsset, media_id)
    if asset is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            ErrorCode.NOT_FOUND,
            "One or more attachments do not exist.",
        )
    if asset.owner_id != author_id:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            ErrorCode.FORBIDDEN,
            "Attachments must belong to the author.",
        )
    if asset.kind not in POSTABLE_KINDS:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            ErrorCode.VALIDATION_ERROR,
            f"Attachments of kind {asset.kind.value!r} cannot be used on a story.",
        )
    return asset


def _active_filters() -> tuple:
    """The one predicate pair §10.2 requires, shared by the list and the detail.

    **Two conditions, and the second is not optional.** ``expires_at > now()`` is the
    window; ``status = 'published'`` is withdrawal. A story that is archived but not
    yet expired is still readable from the table, so a query that filtered only on
    expiry would keep serving an operator-withdrawn story.

    ``now()`` is evaluated **in SQL**, not in Python. That matters twice over: the
    boundary stays one expression the database and the tests agree on, and a page of
    rows cannot straddle two different "now"s when the query runs long enough to
    cross a second.

    The viewer's own filter is applied on top by the callers, because it needs the
    principal and this deliberately does not.
    """
    return Story.expires_at > func.now(), Story.status == "published"


def _viewed_ids(
    session: Session, viewer: User, story_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of ``story_ids`` the viewer has already viewed.

    One query for the whole page rather than one per story: §10.1 requires
    ``viewed`` on the list precisely so the client "can render viewed/unviewed
    without a second request", and answering a page of 20 rows with 21 queries
    would be the server-side version of the problem §10.1 is avoiding. The
    ``IN`` is over the page's ids only, so the cost tracks the page, not the table.

    An empty page short-circuits to an empty set — an ``IN ()`` is invalid SQL on
    some backends and pointless on all of them.
    """
    if not story_ids:
        return set()
    rows = session.scalars(
        select(StoryView.story_id).where(
            StoryView.viewer_id == viewer.id, StoryView.story_id.in_(story_ids)
        )
    )
    return set(rows.all())


def _media_out(story: Story) -> StoryMediaOut | None:
    """The asset this story carries, or ``None`` for a text-only story.

    ``story.media`` is ``lazy="joined"`` on the model, so this reads an already-
    loaded relationship rather than issuing a query per row — the list route
    serialises a whole page through here.

    ``uri`` is ``served_at``, the **relative** path §14.11 defines: the client
    joins it onto its configured base itself, so no host is published here.
    """
    asset = story.media
    if asset is None:
        return None
    return StoryMediaOut(
        id=asset.id,
        kind=asset.kind,
        mime_type=asset.mime_type,
        width=asset.width,
        height=asset.height,
        duration_ms=asset.duration_ms,
        size_bytes=asset.size_bytes,
        uri=asset.served_at,
    )


def _to_out(
    story: Story, publisher: StoryPublisherOut, viewed: bool, viewer: User
) -> StoryOut:
    """Serialise one story for one viewer.

    ``opportunity`` round-trips as the stored display payload when present, and is
    ``None`` in V1 because nothing writes one. It is validated into
    ``StoryOpportunityOut`` on the way out rather than passed through as a bare
    ``dict``, so a malformed payload cannot reach the client as an untyped object —
    the same choice posts made for its `project`/`achievement` round trip.

    ``viewer`` is what makes ``is_self`` honest: it is compared against the row's
    author per request, never carried on the row, for the same reason posts'
    ``author.is_self`` is computed (§9.2). ``author_public_id`` comes from the
    author's ``MJ-…`` public id — the identifier `GET /users/{public_id}` already
    serves — so grouping a person's stories never has to reach into the publisher
    snapshot, which deliberately carries no id.
    """
    opportunity: StoryOpportunityOut | None = None
    if story.opportunity:
        opportunity = StoryOpportunityOut(**story.opportunity)
    return StoryOut(
        id=story.id,
        content_type=story.content_type,
        caption=story.caption,
        status=story.status,
        publisher=publisher,
        opportunity=opportunity,
        viewed=viewed,
        created_at=story.created_at,
        media=_media_out(story),
        author_public_id=story.author.public_id,
        is_self=story.author_id == viewer.id,
    )


def _publisher_out(story: Story) -> StoryPublisherOut:
    """Read §10.1's publisher back out of the stored snapshot.

    ``kind`` comes from its column, never from the payload, so the discriminator
    stays under the database's CHECK even if a payload were written by something
    other than this service. A missing or partial payload falls back to the stored
    defaults rather than raising, because one malformed row must not take down a
    whole feed page.
    """
    payload = story.publisher or {}
    return StoryPublisherOut(
        name=str(payload.get("name") or "Unknown publisher"),
        logo_url=payload.get("logo_url"),
        verified=bool(payload.get("verified", False)),
        kind=story.publisher_kind,
    )


def list_stories(
    session: Session, viewer: User, *, page: int, page_size: int
) -> FastApiPage[StoryOut]:
    """``GET /stories`` — §10.2's active-stories feed, newest first.

    §10.2: "``GET /stories`` returns **active** stories only; the client sends no
    date filter, so the server owns the window." That is :func:`_active_filters`,
    applied to the ``COUNT`` as well as the rows — a count over a different
    predicate than the rows would make ``pages`` lie, and the client's pager reads
    it.

    Ordering is ``(created_at DESC, id DESC)``, matching §14.10's
    ``(expires_at, created_at DESC)`` index in spirit and the feed's own total order
    in practice. The ``id`` tiebreak is load-bearing: stories are created in bursts
    by a publisher, so sharing a ``created_at`` is the normal case, not the edge
    case, and without it page 2 can repeat a row from page 1.

    ``(expires_at, created_at DESC)`` cannot serve this ordering directly, because
    the range predicate is on the leading column while the sort is on the second.
    PostgreSQL will read the index and sort, or scan and filter; either is correct
    and the row count is bounded by how many stories are active, not by history.
    """
    not_expired, is_published = _active_filters()
    total = session.scalar(
        select(func.count()).select_from(Story).where(not_expired, is_published)
    )
    rows = session.scalars(
        select(Story)
        .where(not_expired, is_published)
        .order_by(Story.created_at.desc(), Story.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()

    seen = _viewed_ids(session, viewer, [story.id for story in rows])
    return build_fastapi_page(
        [
            _to_out(story, _publisher_out(story), story.id in seen, viewer)
            for story in rows
        ],
        total or 0,
        page,
        page_size,
    )


def get_story(session: Session, viewer: User, raw_id: str) -> StoryOut:
    """``GET /stories/{id}`` — §10.1's "single story for the viewer".

    The active filters are in the **query**, for the same reason posts' tombstone
    filter is: an expired or archived story must be indistinguishable from one that
    never existed, and a check after the row was fetched would let a caller tell the
    difference by timing or by error message.

    §10.1 is explicit that "a story is visible to any authenticated candidate. There
    is no per-viewer story ACL in V1", so there is no ownership check here at all —
    the only gate is "is it active".
    """
    story_id = parse_id(raw_id, "story")
    not_expired, is_published = _active_filters()
    story = session.scalars(
        select(Story).where(Story.id == story_id, not_expired, is_published)
    ).first()
    if story is None:
        raise _not_found()

    seen = _viewed_ids(session, viewer, [story.id])
    return _to_out(story, _publisher_out(story), story.id in seen, viewer)


def create_story(session: Session, principal: User, payload: StoryCreate) -> StoryOut:
    """``POST /stories`` — the server-side publication path ([F] in §10.1).

    **The author is never read from the request.** ``StoryCreate`` is
    ``extra="forbid"``, so ``author_id`` is a 422 rather than a silently ignored
    field, and the row is written with ``principal.id`` — the same argument §9.3
    makes for posts, and the reason a publisher cannot post as somebody else.

    **A ``company`` story is refused here.** §14.10 wants
    ``CHECK (publisher_kind = 'company') = (company_id IS NOT NULL)`` so a company
    story always names a real company. `companies` is Phase 9, so Phase 8 can neither
    satisfy nor verify that, and storing the claim anyway would put an unverifiable
    ``kind: 'company'`` badge into a feed that renders it. Refusing is the honest
    answer: ``platform`` is the only kind this phase can stand behind. When the
    career domain lands this branch becomes a lookup instead of a rejection, and the
    CHECK comes back with it.

    ``expires_at`` is computed **here**, from ``payload.expires_in_hours``, and never
    accepted as a timestamp. §10.2's reason for the column is that the window becomes
    adjustable, and a relative duration is the adjustable form; accepting an absolute
    instant would let a caller publish a story that had already expired.

    The commit is last, so a rejected media reference or an unsupported publisher
    leaves no partial row behind.
    """
    if payload.publisher_kind is not StoryPublisherKind.PLATFORM:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            ErrorCode.VALIDATION_ERROR,
            "Company stories cannot be published until companies exist.",
            [
                error_detail(
                    "publisher_kind",
                    "Publish as 'platform' for now; company publishing "
                    "arrives with the companies domain.",
                )
            ],
        )

    asset = _load_media(session, payload.media_id, principal.id)

    story = Story(
        author_id=principal.id,
        publisher_kind=payload.publisher_kind,
        publisher=_publisher_payload(principal, session),
        content_type=payload.content_type,
        caption=payload.caption,
        media_id=asset.id if asset else None,
        status=StoryStatus.PUBLISHED,
        expires_at=datetime.now(UTC) + timedelta(hours=payload.expires_in_hours),
    )
    session.add(story)
    session.commit()
    # `expire_on_commit` is on, so server defaults are not populated on the instance
    # yet; re-reading is what makes the 201 body the *stored* story.
    session.refresh(story)
    # Announced **after** the commit above. Every member's story tray learns about
    # this story from the event and then re-reads it over REST; publishing inside
    # the transaction would announce a story a rollback could still erase. §10.1
    # gives stories no per-viewer ACL, so the audience is every member — the same
    # set `GET /stories` already returns it to.
    content_events.story_created(
        story_id=str(story.id),
        author_id=str(story.author_id),
        created_at=wire_datetime(story.created_at),
    )
    return _to_out(story, _publisher_out(story), False, principal)


def delete_story(session: Session, principal: User, raw_id: str) -> None:
    """``DELETE /stories/{id}`` — [F] in §10.1, with no mobile caller.

    **This is a hard delete, not the soft delete posts uses.** §14.10 lists no
    `deleted_at` on `stories`, and §10.2 says the opposite thing for stories: "rows
    may be **deleted** after a retention period... Deleting a story cascades its
    views." A tombstone would be a column the specification does not have, kept for
    a purpose it explicitly disclaims.

    The `story_views` rows go with it through the CASCADE on `story_id`, which is
    exactly what §10.2 relies on for retention.

    Re-deleting is a 404 rather than an idempotent 204, for the reason posts uses:
    §18 covers keyed retries and this is not one, so a 204 would report a deletion
    that did not happen at that moment.

    Only the creator may delete. §10.1 gives stories no per-viewer ACL, but that is
    about *reading*; a publisher withdrawing their own announcement is ownership, and
    §9.3's "never success" for another author's row applies unchanged.
    """
    story_id = parse_id(raw_id, "story")
    story = session.get(Story, story_id)
    if story is None or story.author_id != principal.id:
        # 404 rather than 403: a 403 would confirm the story exists, which is the
        # same non-disclosure rule posts applies in `_assert_owner`.
        raise _not_found()

    session.delete(story)
    session.commit()


def record_view(session: Session, principal: User, raw_id: str) -> StoryViewOut:
    """``POST /stories/{id}/view`` — §10.2's idempotent view.

    **The PK is the guarantee, and this function is written to suit it.**
    ``(story_id, viewer_id)`` is the primary key, so there can be at most one row per
    pair. The flow is: read, and if it is there, return it unchanged; if not, insert.
    The read is an optimisation, not the enforcement — two concurrent first-views can
    both read "absent" and both insert, so the unique index is the real authority and
    :class:`IntegrityError` is caught below and answered as ``already_recorded``.

    That catch is why this is not a 500. Two phones opening the same story at the
    same instant is ordinary, not exceptional, and §10.2 asks for the endpoint to be
    idempotent precisely so the client can retry it.

    **The original ``viewed_at`` is returned on a repeat**, as §10.2 requires: "re-
    viewing returns ``already_recorded: true`` with the original ``viewed_at`` and
    does not insert a second row". So a retried request is identical to the first
    apart from the flag, which is what makes §18's keyed-retry contract hold.

    An expired, archived, or missing story is a 404 *before* any row is written, so a
    view can never be recorded against a story the viewer was not shown.
    """
    story_id = parse_id(raw_id, "story")
    not_expired, is_published = _active_filters()
    story = session.scalars(
        select(Story).where(Story.id == story_id, not_expired, is_published)
    ).first()
    if story is None:
        raise _not_found()

    existing = session.get(StoryView, (story.id, principal.id))
    if existing is not None:
        return StoryViewOut(
            story_id=story.id,
            viewed=True,
            already_recorded=True,
            viewed_at=existing.viewed_at,
        )

    view = StoryView(story_id=story.id, viewer_id=principal.id)
    session.add(view)
    try:
        # One flush inside a savepoint, then commit. If a concurrent request inserted
        # the same pair first this raises, and the savepoint rollback leaves the
        # session usable rather than poisoned.
        with session.begin_nested():
            session.flush()
        session.commit()
    except IntegrityError:
        # The race loser. The winner's row is now visible, and that is the honest
        # answer: this call did not insert it.
        session.rollback()
        recorded = session.get(StoryView, (story.id, principal.id))
        if recorded is None:  # pragma: no cover - only if the row vanished
            raise _not_found() from None
        return StoryViewOut(
            story_id=story.id,
            viewed=True,
            already_recorded=True,
            viewed_at=recorded.viewed_at,
        )

    session.refresh(view)
    return StoryViewOut(
        story_id=story.id,
        viewed=True,
        already_recorded=False,
        viewed_at=view.viewed_at,
    )

