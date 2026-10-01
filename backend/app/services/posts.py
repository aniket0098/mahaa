"""Post read/write rules — §9.3, plus the media safety §7 of Phase 8 demands.

**The author is never read from the request.** §9.3 forbids impersonation, and
the strongest way to forbid it is for the column to have no request-side input at
all: `create_post` takes the authenticated principal and writes `principal.id`.
`PostCreate` has `extra="forbid"`, so a client that sends `author_id` gets a 422
rather than a silently-ignored field.

**Media must belong to the author, and must be the right kind.** `_load_media`
raises 403 when an asset is not the author's and 404 when it does not exist. The
403/404 split is Phase 7's IDOR rule: a *missing* asset is indistinguishable from
one the caller may not see, but an asset owned by *someone else* is a real answer —
the caller named a specific thing they were refused.

**Media kinds are restricted to the ones a post can render.** §9.2's `media[]`
carries `width`/`height` that the client "sizes every image from them"; a PDF or
a resume has neither, and attaching one would put an entry in the feed the client
cannot lay out. `POSTABLE_KINDS` is therefore `{image, video}`.

**Ordering is `(created_at DESC, id DESC)` everywhere.** `docs/feed-api-contract.md`
and §14.9's partial index agree, and `id` breaks ties because two posts can share
a `created_at` at microsecond resolution. Without the tiebreak, page 2 can repeat
a row from page 1 — the classic reason an offset feed needs a total order.

**This module is synchronous, like every other service here.** `DbSession` is
`Annotated[Session, Depends(get_db)]` and every other service calls
`session.commit()`. The routes are `async def` because FastAPI runs them on the
event loop, but they do blocking work on a sync session — that is this project's
established shape, and introducing `AsyncSession` for one domain would mean a
second engine, a second sessionmaker and a second set of tests for no gain.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ApiError, ErrorCode, error_detail
from app.models.enums import MediaKind, PostCategory
from app.models.media import MediaAsset
from app.models.posts import Post, PostMedia
from app.models.user import User
from app.schemas.common import Page, build_page
from app.schemas.posts import (
    PostAuthorOut,
    PostCreate,
    PostMediaOut,
    PostUpdate,
    WirePost,
)
from app.services.ownership import parse_id

#: §9.2's `media[]` entries are rendered as images or video. See the docstring.
POSTABLE_KINDS = frozenset({MediaKind.IMAGE, MediaKind.VIDEO})


def _load_media(
    session: Session, media_ids: Sequence[uuid.UUID], author_id: uuid.UUID
) -> list[MediaAsset]:
    """Load and authorise every attachment, preserving the caller's order.

    Order is the caller's, not the database's: §14.9 makes `position` part of the
    primary key, so the client's list order *is* the stored order. Sorting the
    result by id would silently reorder a post.

    Duplicate ids are collapsed rather than rejected, because the schema's
    ``unique (post_id, media_id)`` constraint would turn a repeat into an opaque
    500. Deduplicating here turns "the same image twice" into one attachment,
    which is what the composer means by it.
    """
    if not media_ids:
        return []

    wanted: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for media_id in media_ids:
        if media_id not in seen:
            seen.add(media_id)
            wanted.append(media_id)

    rows = session.scalars(select(MediaAsset).where(MediaAsset.id.in_(wanted))).all()
    by_id = {row.id: row for row in rows}

    assets: list[MediaAsset] = []
    for media_id in wanted:
        asset = by_id.get(media_id)
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
                f"Attachments of kind {asset.kind.value!r} cannot be added to a post.",
            )
        assets.append(asset)
    return assets


def _author_out(author: User, session: Session, is_self: bool) -> PostAuthorOut:
    """Build §9.2's ``author``.

    ``verified`` is a literal ``False``. §9.2: it "**must default to `false``** and
    require a real signal. The client renders a badge from this field and nothing
    else, so a wrong `true`` is a false credential claim in production." V1 has no
    verification signal of any kind, so the only honest value is the default one.
    Writing ``False`` here rather than leaving the field to a default means a
    future reviewer looking for a verification lookup will not find one and will
    know to add the signal rather than flip a constant.

    **The three identity fields come from three different places**, which is the
    trap this function exists to make visible. ``name`` is a ``users`` column;
    ``headline`` is on ``profiles``; ``avatar_url`` is not a column *anywhere* — it
    is the ``served_at`` path of the asset ``users.avatar_media_id`` points at.
    Reading ``author.headline`` or ``author.avatar_url`` off the ``User`` row looks
    right and raises ``AttributeError`` on the first post anyone reads, so the
    resolution is spelled out here instead.

    ``avatar_url`` goes through ``media.avatar_url_for`` rather than a hand-rolled
    lookup, so the feed returns the same relative path ``GET /users/me`` returns
    (§14.11) and the two cannot drift apart.

    A missing profile row is not an error: a post is publishable before onboarding
    finishes, and the card then shows no headline, which is the truth.
    """
    from app.models.profile import Profile
    from app.services.media import avatar_url_for

    headline = session.scalar(
        select(Profile.headline).where(Profile.user_id == author.id)
    )
    return PostAuthorOut(
        name=author.name,
        headline=headline,
        avatar_url=avatar_url_for(author, session),
        verified=False,
        is_self=is_self,
    )


def _to_wire(post: Post, viewer_id: uuid.UUID, session: Session) -> WirePost:
    """Serialise one loaded ``Post`` for one viewer.

    ``post.media`` is already ordered by ``position`` by the relationship, and
    ``post.author`` is already loaded (`lazy="joined"`), so the post itself costs
    no extra queries — which matters because this runs once per row in a page of
    up to 200. The author projection costs one headline lookup and one avatar
    lookup per row, both index-backed lookups on a primary key.

    ``deleted_at`` is deliberately absent: §9.3's soft delete is a storage
    decision, and the queries that call this all exclude tombstones anyway.
    """
    return WirePost(
        id=post.id,
        kind=post.kind,
        category=post.category,
        title=post.title,
        body=post.body,
        media=[
            PostMediaOut(
                id=link.asset.id,
                kind=link.asset.kind,
                mime_type=link.asset.mime_type,
                width=link.asset.width,
                height=link.asset.height,
                duration_ms=link.asset.duration_ms,
                size_bytes=link.asset.size_bytes,
                # Phase 7's `served_at` — already the relative path the client
                # expects, so it is passed through untouched.
                uri=link.asset.served_at,
                position=link.position,
            )
            for link in post.media
        ],
        project=post.project,
        achievement=post.achievement,
        tags=list(post.tags or []),
        created_at=post.created_at,
        updated_at=post.updated_at,
        author=_author_out(post.author, session, post.author_id == viewer_id),
    )


def create_post(session: Session, principal: User, payload: PostCreate) -> WirePost:
    """``POST /posts`` — §9.1's "Returns the stored `WirePost`".

    §9.2's derivation happens *before* the row is built, from media kinds that
    have already been ownership-checked. There is no code path that stores the
    client's ``kind``.

    The commit is here, once, at the end. A failure anywhere above — a
    non-owned attachment, a payload-less post — leaves the session untouched, so
    no partial post and no orphaned ``post_media`` row can survive.
    """
    assets = _load_media(session, payload.media_ids, principal.id)

    if not payload.has_payload(len(assets)):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            ErrorCode.VALIDATION_ERROR,
            "A post needs at least one of body, media, project or achievement.",
            [error_detail("body", "Add text, an attachment, or a payload.")],
        )

    kind = payload.derive_kind([asset.kind for asset in assets])

    post = Post(
        author_id=principal.id,
        kind=kind,
        category=payload.category,
        title=payload.title,
        body=payload.body,
        project=payload.project.model_dump(exclude_none=True)
        if payload.project
        else None,
        achievement=payload.achievement.model_dump(exclude_none=True)
        if payload.achievement
        else None,
        tags=list(payload.tags),
    )
    session.add(post)
    session.flush()

    for position, asset in enumerate(assets):
        session.add(PostMedia(post_id=post.id, media_id=asset.id, position=position))

    session.commit()
    # `expire_on_commit` is on, so the instance is stale after commit: server
    # defaults (created_at/updated_at) and the `post_media` rows just inserted are
    # not populated on it. Re-reading is what makes the 201 body the *stored* post
    # §9.1 promises rather than the in-memory one that was just built.
    session.refresh(post)
    session.refresh(post, attribute_names=["media", "author"])
    return _to_wire(post, principal.id, session)


def _load_live_post(session: Session, raw_id: str | uuid.UUID) -> Post:
    """Fetch one post that has not been soft-deleted.

    Takes the **raw** path value and parses it through ``ownership.parse_id``,
    rather than declaring the parameter as ``uuid.UUID`` in the route signature.
    That is the project's settled rule (``services/ownership.py``): a malformed id
    is a **404**, not a 422. Annotating the path as ``UUID`` would make FastAPI
    reject the shape before the route runs, which turns every typo into a
    validation error and makes the endpoint a UUID-format oracle — a 422 says
    "that string is not a UUID", a 404 says "no such post", and only the second
    tells a caller nothing they did not already know. Phase 6 and Phase 7 both
    assert this behaviour for their own routes.

    The ``deleted_at IS NULL`` predicate is in the **query**, not the service
    check, for the same reason Phase 7's media reads are owner-scoped in SQL: a
    deleted post must be indistinguishable from one that never existed, and a
    check that ran after the row was fetched would let a caller distinguish them
    by timing or by error message.
    """
    post_id = parse_id(raw_id, "post")
    post = session.scalars(
        select(Post)
        .options(selectinload(Post.media).joinedload(PostMedia.asset))
        .where(Post.id == post_id, Post.deleted_at.is_(None))
    ).first()
    if post is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "That post was not found."
        )
    return post


def _assert_owner(post: Post, principal: User) -> None:
    """§9.3: "``PATCH``/``DELETE`` answer 403 or 404 — never success."

    This project has settled on **404**, and that is the correct choice here rather
    than 403. A 403 confirms the post exists and belongs to someone else, which
    makes ``/posts/{id}`` an oracle for probing ids; 404 tells the caller nothing
    they did not already know. §9.3 permits either, and the harder-to-misuse one
    is chosen.

    It is also why §9.3 says "Excluding a post from a private profile is better
    than returning it with hidden fields" — the post simply does not exist as far
    as this caller is concerned.
    """
    if post.author_id != principal.id:
        raise ApiError(
            status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "That post was not found."
        )


def update_post(
    session: Session, principal: User, raw_id: str, payload: PostUpdate
) -> WirePost:
    """``PATCH /posts/{id}`` — §9.1: "Owner only; ``{body?, title?}``".

    ``payload.model_fields_set`` distinguishes "absent" from "explicitly null", so
    a client can clear a title with ``{"title": null}`` without that being
    confused with a patch that simply did not mention it. A blind ``if
    payload.title is not None`` would make a title impossible to remove.

    ``kind`` is not re-derived. Editing the text of a project post must not turn
    it into a text post, and §9.2 reserves derivation for creation where the
    payload set is what determines the block. Nothing ``PostUpdate`` can change
    removes a payload, so the stored value stays true.
    """
    post = _load_live_post(session, raw_id)
    _assert_owner(post, principal)

    for field in payload.model_fields_set:
        setattr(post, field, getattr(payload, field))

    session.commit()
    session.refresh(post)
    return _to_wire(post, principal.id, session)


def delete_post(session: Session, principal: User, raw_id: str) -> None:
    """``DELETE /posts/{id}`` — §9.3's **soft delete**.

    ``deleted_at`` is stamped; the row stays. §9.3's reason is that "a published
    post's position and its comments survive", and §14.9's partial index takes the
    row out of the feed's scan the moment this commits.

    Re-deleting is a 404 rather than an idempotent success. §18 covers keyed
    retries, and this is not one; answering 204 for a post that is already gone
    would report a delete that never happened at that time.

    The ``post_media`` rows are left in place on purpose: they are what makes a
    future undelete or moderation read possible, and the FK is CASCADE so they go
    if the post row ever does.
    """
    post = _load_live_post(session, raw_id)
    _assert_owner(post, principal)

    post.deleted_at = datetime.now(UTC)
    session.commit()


def _feed_filters(category: PostCategory | None, author_id: uuid.UUID | None):
    """The one filter pair both feed routes build from.

    ``category`` and ``author_id`` are two independent optional predicates over the
    same live-row base, which lets ``GET /posts`` and ``GET /posts/mine`` share the
    clauses that matter — ``deleted_at IS NULL`` and the total ordering — and differ
    only in the extra filter. Two hand-written queries would eventually drift on
    exactly those two clauses.

    Ordering is ``(created_at DESC, id DESC)`` and it is **not optional**: the
    ``id`` tiebreak is what makes an offset feed deterministic. Without it, two
    posts sharing a ``created_at`` can appear on page 1 and page 2, or on neither.
    """
    stmt = select(Post).where(Post.deleted_at.is_(None))
    count = select(func.count()).select_from(Post).where(Post.deleted_at.is_(None))
    if category is not None:
        stmt = stmt.where(Post.category == category)
        count = count.where(Post.category == category)
    if author_id is not None:
        stmt = stmt.where(Post.author_id == author_id)
        count = count.where(Post.author_id == author_id)
    return stmt, count


def list_posts(
    session: Session,
    principal: User,
    *,
    category: PostCategory | None,
    author_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> Page[WirePost]:
    """One page of the feed, newest first.

    §9.3: "no ranking" — `docs/feed-api-contract.md` is explicit that there must
    be no "``for_you`` parameter while no ranking exists", so the only ordering is
    chronological and no parameter can request anything else.

    The ``COUNT`` and the page share :func:`_feed_filters`, so they cannot
    disagree. §9.1 is explicit that "`total` must be a real count, not a page
    length", and ``build_page`` derives ``has_more`` from it — a count taken over
    a *different* predicate than the rows would make the pager lie.
    """
    stmt, count = _feed_filters(category, author_id)
    total = session.scalar(count)
    rows = (
        session.scalars(
            stmt.options(selectinload(Post.media).joinedload(PostMedia.asset))
            .order_by(Post.created_at.desc(), Post.id.desc())
            .limit(limit)
            .offset(offset)
        )
        .unique()
        .all()
    )
    return build_page(
        [_to_wire(post, principal.id, session) for post in rows],
        total,
        limit,
        offset,
    )


def get_post(session: Session, principal: User, raw_id: str) -> WirePost:
    """``GET /posts/{id}`` — §9.1 marks it [M] but notes the client does not call it.

    Implemented anyway because the route is specified and a deep link will need it;
    today's client not calling a documented route is not a reason to omit it.
    There is no ownership requirement on reading, only on writing, so this differs
    from :func:`update_post` deliberately and returns another author's post — a
    soft-deleted one still 404s, because `_load_live_post` filters tombstones.
    """
    post = _load_live_post(session, raw_id)
    return _to_wire(post, principal.id, session)
