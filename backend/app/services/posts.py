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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.errors import ApiError, ErrorCode, error_detail
from app.core.wire import wire_datetime
from app.models.enums import MediaKind, PostCategory
from app.models.media import MediaAsset
from app.models.posts import Post, PostComment, PostLike, PostMedia
from app.models.user import User
from app.realtime import content_events
from app.schemas.common import Page, build_page
from app.schemas.posts import (
    CommentCreate,
    CommentRead,
    PostAuthorOut,
    PostCreate,
    PostEngagementOut,
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

    ``public_id`` and ``username`` are read straight off the ``users`` row, which
    is where they have always lived. They are the two handles a card needs to
    name and link its author, and deriving them here costs nothing — the row is
    already loaded — whereas having the client correlate them would mean a second
    request per post.
    """
    from app.models.profile import Profile
    from app.services.media import avatar_url_for

    headline = session.scalar(
        select(Profile.headline).where(Profile.user_id == author.id)
    )
    return PostAuthorOut(
        name=author.name,
        public_id=author.public_id,
        username=author.username,
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

    **The engagement block defaults to zero, and that default is load-bearing.**
    This function runs once per row, and the counts come from a single grouped
    query over the whole page (:func:`_engagement_map`) rather than from a lookup
    per row. So the caller that has the page passes the real values in — via
    :func:`_wire_with_engagement`, or by rebuilding the list in
    :func:`list_posts` — and only the single-post paths fall through to the zero
    default. A zero is the honest reading of "no likes, no comments" for a post
    that has just been created, which is exactly what those paths are.
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
        engagement=PostEngagementOut(
            like_count=0, comment_count=0, liked_by_me=False
        ),
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

    # Announced **after** the commit above, never before it. Every other member's
    # feed learns about this post from this event and then re-reads it over REST;
    # publishing inside the transaction would announce a row a rollback could
    # still erase, which is the one failure no client can reconcile. `created_at`
    # is read after the refresh because it is a server default, not a Python value.
    # `wire_datetime` renders it with the same serializer the 201 body uses, so
    # the event and the response cannot drift apart character by character.
    content_events.post_created(
        post_id=str(post.id),
        author_id=str(post.author_id),
        created_at=wire_datetime(post.created_at),
    )

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
    # After the commit, for the same reason `create_post` publishes there: a
    # reader holding this card must re-read it, and only a committed edit is
    # worth re-reading.
    content_events.post_updated(post_id=str(post.id), author_id=str(post.author_id))
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
    # Announced after the commit: the row is a tombstone now, and every other
    # member's feed must stop rendering a card that no REST read returns any more.
    content_events.post_deleted(post_id=str(post.id), author_id=str(post.author_id))


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

    **Engagement is resolved for the whole page in one shot.** The rows are loaded
    first, then :func:`_engagement_map` is handed every id on the page at once, so
    the counts cost three queries whether the page holds one post or two hundred.
    Counting inside the serialisation loop would have been the N+1 this file's
    scroll performance depends on not having.
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

    engagement = _engagement_map(session, principal.id, [post.id for post in rows])
    zero = PostEngagementOut(like_count=0, comment_count=0, liked_by_me=False)

    return build_page(
        [
            _wire_with_engagement(
                post, principal.id, session, engagement.get(post.id, zero)
            )
            for post in rows
        ],
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
    return _wire_with_engagement(
        post,
        principal.id,
        session,
        _engagement_for(session, principal.id, post.id),
    )


# --------------------------------------------------------------------------- #
# Engagement — likes and comments                                                #
# --------------------------------------------------------------------------- #


def _engagement_map(
    session: Session, viewer_id: uuid.UUID, post_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, PostEngagementOut]:
    """Like/comment counts for a whole page of posts, in **three** queries.

    **This is the single most important performance decision in the file.** The
    obvious implementation counts per post inside the serialisation loop, which
    turns one page of 50 posts into 1 + 50 + 50 queries. That is the classic N+1,
    and on a feed it is the difference between a scroll that glides and one that
    stutters. Instead the ids of the page are collected first and both aggregates
    are computed with ``GROUP BY ... WHERE post_id IN (...)``.

    Three queries regardless of page size:

    1. one grouped ``COUNT`` over ``post_likes``;
    2. one grouped ``COUNT`` over live ``post_comments``;
    3. one ``SELECT post_id`` for *this* viewer's likes among them.

    The third could be folded into the first with a ``CASE`` aggregate, but keeping
    it separate makes the viewer's ids one small, index-backed lookup rather than a
    conditional count evaluated per row.

    **Tombstoned comments are excluded** by ``deleted_at IS NULL`` so a deleted
    comment never inflates the number the card prints.

    A post absent from the map has zero of everything, which is the correct reading
    of "no rows" — so a caller never distinguishes "no likes" from "not counted".
    """
    if not post_ids:
        return {}

    wanted = list(dict.fromkeys(post_ids))

    like_counts = dict(
        session.execute(
            select(PostLike.post_id, func.count(PostLike.post_id))
            .where(PostLike.post_id.in_(wanted))
            .group_by(PostLike.post_id)
        ).all()
    )

    comment_counts = dict(
        session.execute(
            select(PostComment.post_id, func.count(PostComment.post_id))
            .where(PostComment.post_id.in_(wanted), PostComment.deleted_at.is_(None))
            .group_by(PostComment.post_id)
        ).all()
    )

    mine = set(
        session.scalars(
            select(PostLike.post_id).where(
                PostLike.post_id.in_(wanted),
                PostLike.user_id == viewer_id,
            )
        ).all()
    )

    return {
        post_id: PostEngagementOut(
            like_count=int(like_counts.get(post_id, 0)),
            comment_count=int(comment_counts.get(post_id, 0)),
            liked_by_me=post_id in mine,
        )
        for post_id in wanted
    }


def _engagement_for(
    session: Session, viewer_id: uuid.UUID, post_id: uuid.UUID
) -> PostEngagementOut:
    """The same numbers for exactly one post. Shares :func:`_engagement_map`."""
    return _engagement_map(session, viewer_id, [post_id]).get(
        post_id,
        PostEngagementOut(like_count=0, comment_count=0, liked_by_me=False),
    )


def _wire_with_engagement(
    post: Post, viewer_id: uuid.UUID, session: Session, engagement: PostEngagementOut
) -> WirePost:
    """``_to_wire`` plus the engagement block, for the single-post paths."""
    return _to_wire(post, viewer_id, session).model_copy(
        update={"engagement": engagement}
    )


def _reload_complete(session: Session, post_id: uuid.UUID) -> Post:
    """Re-read a post with its media, because ``expire_on_commit`` left it stale.

    ``create_post`` needed this and so do the like/comment routes: any of them may
    hand the post straight back to the client, and serialising a just-committed
    object would produce a ``WirePost`` whose ``media`` list is empty.
    """
    reloaded = session.scalars(
        select(Post)
        .options(selectinload(Post.media).joinedload(PostMedia.asset))
        .where(Post.id == post_id)
    ).first()
    return reloaded if reloaded is not None else session.get(Post, post_id)


def like_post(session: Session, principal: User, raw_id: str) -> PostEngagementOut:
    """``POST /posts/{id}/like`` — idempotent.

    **Liking twice is a success, not a conflict.** This route is the target of a
    double-tapped heart and of a retried request, and both are the same event
    arriving twice. §18 covers keyed retries, and the second call converges on the
    state the first already reached, so a 409 would make a *correct* client look
    broken.

    **The duplicate is still impossible in the database.** The composite primary
    key ``(post_id, user_id)`` means a racing second ``INSERT`` raises rather than
    creating a second row, so this handles the collision by rolling back and
    re-reading rather than pre-checking. A pre-check would be a TOCTOU bug: two
    clients can both observe "not liked" and both proceed.
    """
    post = _load_live_post(session, raw_id)
    post_id = post.id

    if session.get(PostLike, {"post_id": post_id, "user_id": principal.id}) is None:
        session.add(PostLike(post_id=post_id, user_id=principal.id))
        try:
            session.commit()
        except IntegrityError:
            # Another request for the same pair won the race. That is the expected
            # outcome of a double tap, so it converges rather than erroring.
            session.rollback()
    return _engagement_for(session, principal.id, post_id)


def unlike_post(session: Session, principal: User, raw_id: str) -> PostEngagementOut:
    """``DELETE /posts/{id}/like`` — idempotent.

    **Un-liking something never liked answers 200 with the unchanged counts**
    rather than 404, for the same reason :func:`like_post` does: the caller's
    intent ("I do not like this") already holds, and a not-found would make a
    retry look like a failure. What *is* refused is a post that does not exist,
    because there is no state to report about it.
    """
    post = _load_live_post(session, raw_id)
    post_id = post.id

    row = session.get(PostLike, {"post_id": post_id, "user_id": principal.id})
    if row is not None:
        session.delete(row)
        session.commit()
    return _engagement_for(session, principal.id, post_id)


def list_comments(
    session: Session, principal: User, raw_id: str, *, limit: int, offset: int
) -> Page[CommentRead]:
    """``GET /posts/{id}/comments`` — newest first, in the shared ``Page`` envelope.

    **Any authenticated member may read any post's comments**, exactly as they may
    read the post. Scoping comments to the post's author would make a community
    feed unusable — the whole point is that a reader can respond.

    **Newest first**, matching ``GET /posts`` and ``GET /notifications``. Ascending
    order would read more like a chat log, but the shared envelope is offset-paged
    over a total count, so an ascending first page is the *oldest* comments —
    which is the opposite of what somebody opening the sheet wants. One ordering
    rule across every paged list in the API is worth more than matching a
    messenger's layout.

    **The author is loaded eagerly** (``lazy="joined"``) and the rows are
    ``unique()``-ed, because a joined eager load against a collection would
    otherwise return one row per joined child and silently duplicate comments.
    """
    post = _load_live_post(session, raw_id)

    live = (
        PostComment.post_id == post.id,
        PostComment.deleted_at.is_(None),
    )
    total = session.scalar(select(func.count()).select_from(PostComment).where(*live))
    rows = (
        session.scalars(
            select(PostComment)
            .options(joinedload(PostComment.author))
            .where(*live)
            .order_by(PostComment.created_at.desc(), PostComment.id.desc())
            .limit(limit)
            .offset(offset)
        )
        .unique()
        .all()
    )
    return build_page(
        [
            CommentRead(
                id=row.id,
                post_id=row.post_id,
                body=row.body,
                created_at=row.created_at,
                author=_author_out(row.author, session, row.author_id == principal.id),
            )
            for row in rows
        ],
        int(total or 0),
        limit,
        offset,
    )


def create_comment(
    session: Session, principal: User, raw_id: str, payload: CommentCreate
) -> CommentRead:
    """``POST /posts/{id}/comments`` — the author is the principal, never the body.

    **The comment cannot be written as somebody else.** There is no ``author_id``
    on the write model, and ``extra="forbid"`` rejects one at parse time, so the
    only value that can reach the column is ``principal.id``. This is the same rule
    ``create_post`` follows, for the same reason.
    """
    post = _load_live_post(session, raw_id)

    row = PostComment(post_id=post.id, author_id=principal.id, body=payload.body)
    session.add(row)
    session.commit()
    session.refresh(row)

    return CommentRead(
        id=row.id,
        post_id=row.post_id,
        body=row.body,
        created_at=row.created_at,
        # `is_self=True` without a comparison: the author *is* the principal, and
        # spelling that out means the reader cannot be tricked into rendering
        # somebody else's name on their own comment.
        author=_author_out(principal, session, True),
    )


def delete_comment(
    session: Session, principal: User, raw_id: str, raw_comment_id: str
) -> None:
    """``DELETE /posts/{id}/comments/{comment_id}`` — author only, soft delete.

    **404 for someone else's comment, not 403**, for the reason ``_assert_owner``
    gives: a 403 confirms the comment exists, which turns the route into an oracle
    for probing ids. The comment is also scoped to ``post_id`` in the query, so a
    valid comment id under a different post is simply not found.

    **Soft delete rather than removing the row.** §9.3 promises that a published
    post's position and *its comments* survive, and a moderation trail needs the
    same property. The tombstone is filtered out of every read, so a reader cannot
    tell it ever existed — but the row, and who wrote it, remain for review.

    **Re-deleting answers 404** rather than an idempotent 204, matching
    ``delete_post``: this is not a keyed retry, and reporting a deletion that did
    not happen would be a lie.
    """
    post = _load_live_post(session, raw_id)

    comment_id = parse_id(raw_comment_id, "comment")
    comment = session.scalar(
        select(PostComment).where(
            PostComment.id == comment_id,
            PostComment.post_id == post.id,
            PostComment.deleted_at.is_(None),
        )
    )
    if comment is None or comment.author_id != principal.id:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            ErrorCode.NOT_FOUND,
            "That comment was not found.",
        )

    comment.deleted_at = datetime.now(UTC)
    session.commit()
