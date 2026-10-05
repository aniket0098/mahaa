"""The ``/posts`` router — §9.1's six [M] routes, plus the four engagement verbs.

**Engagement now exists: likes and comments are real, authenticated and
persistent.** They were previously absent — §9.1 marked them **[F]** ("No mobile
caller. `CommentsSheet` shows an honest empty state") and the like button toggled
device-local state that a reload discarded. That is no longer true: the feed
renders a filled heart driven by the server, and the comment sheet posts and lists
real rows. So the four routes below have a caller and the tables behind them
(`post_likes`, `post_comments`) exist.

**Bookmarks and report remain absent, and for the unchanged reason.** Saving is
still session-scoped device state with no server-side caller, and there is no
moderation queue to file a report into.

**Every route requires authentication, including the feed.** §9.1 marks all six
[M], and `docs/feed-api-contract.md` says "`GET /posts` is [M]" — a member-visible
community feed, not a public one. `CurrentUser`, not `CandidateUser`: the
specification does not restrict posting to one role, and inventing a role
restriction would break an employer who legitimately has something to say.

**``/posts/mine`` is declared before ``/posts/{post_id}``.** Starlette matches in
declaration order, so the parameterised route would otherwise capture "mine" and
bind it to a UUID parser, producing a 422 that reads like a client bug. The same
trap Phase 7 documents for `/users/me/photo` versus `/media/{media_id}`.

**The three-segment engagement paths cannot hit that trap.** `/posts/{id}/like`
is a different shape from `/posts/{id}`, so no declaration order between them
matters.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.models.enums import PostCategory
from app.schemas.common import Page, page_params
from app.schemas.posts import (
    CommentCreate,
    CommentRead,
    PostCreate,
    PostEngagementOut,
    PostUpdate,
    WirePost,
)
from app.services import posts as svc

router = APIRouter(prefix="/posts", tags=["posts"])

#: The id is a **string**, not a ``UUID``, and that is deliberate.
#: `services.ownership.parse_id` turns a malformed one into a 404 rather than a
#: 422 — the project's settled rule (`ownership.py`: "keeps the endpoint from
#: becoming a UUID-format oracle"). Phase 6 and Phase 7 both assert it; a 422
#: here would say "that is not a UUID", which tells a caller something a 404 does
#: not. `media.py` takes its `media_id` the same way for the same reason.
PostId = Annotated[
    str,
    Path(description="A post id. A malformed id answers 404, not 422."),
]


@router.get("", response_model=Page[WirePost])
def list_posts(
    db: DbSession,
    principal: CurrentUser,
    params: tuple[int, int] = Depends(page_params),
    category: Annotated[
        PostCategory | None,
        Query(description="One of projects, achievements, learning, community."),
    ] = None,
) -> Page[WirePost]:
    """``GET /posts`` — §9.1: one page of the Community Feed, newest first.

    Ordering is ``(created_at DESC, id DESC)`` and there is no ranking parameter,
    because none exists to rank with (§9.3).
    """
    limit, offset = params
    return svc.list_posts(
        db, principal, category=category, author_id=None, limit=limit, offset=offset
    )


@router.get("/mine", response_model=Page[WirePost])
def list_my_posts(
    db: DbSession,
    principal: CurrentUser,
    params: tuple[int, int] = Depends(page_params),
) -> Page[WirePost]:
    """``GET /posts/mine`` — §9.1: own published posts, with a **real** ``total``.

    "Own published" means live rows only; a soft-deleted post leaves this list
    exactly as it leaves the public feed. ``total`` comes from the same ``COUNT``
    as the rows, so a client rendering "showing 1-20 of 47" cannot be told 47 is
    actually the length of this page.
    """
    limit, offset = params
    return svc.list_posts(
        db, principal, category=None, author_id=principal.id, limit=limit, offset=offset
    )


@router.post("", response_model=WirePost, status_code=status.HTTP_201_CREATED)
def create_post(
    db: DbSession,
    principal: CurrentUser,
    payload: PostCreate,
) -> WirePost:
    """``POST /posts`` — §9.1: "Returns the stored ``WirePost``; the client renders
    only after `201`".

    201 is load-bearing for that sentence: the composer only adds the card to the
    feed on success, so a 200 would be indistinguishable from the
    stored-and-rendered contract the client was written against.
    """
    return svc.create_post(db, principal, payload)


@router.get("/{post_id}", response_model=WirePost)
def get_post(db: DbSession, principal: CurrentUser, post_id: PostId) -> WirePost:
    """``GET /posts/{id}`` — §9.1 marks it [M] though the client does not call it."""
    return svc.get_post(db, principal, post_id)


@router.patch("/{post_id}", response_model=WirePost)
def update_post(
    db: DbSession,
    principal: CurrentUser,
    post_id: PostId,
    payload: PostUpdate,
) -> WirePost:
    """``PATCH /posts/{id}`` — §9.1: "Owner only; ``{body?, title?}``".

    Another author's post is a 404, not a 403 (§9.3 allows either; see
    `services.posts._assert_owner` for why the non-disclosing one is used).
    """
    return svc.update_post(db, principal, post_id, payload)


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_post(db: DbSession, principal: CurrentUser, post_id: PostId) -> Response:
    """``DELETE /posts/{id}`` — §9.1: "Owner only; **soft delete**".

    204 with no body, matching every other delete in this API. The client awaits
    the call and removes the card itself, so a body would be discarded.
    """
    svc.delete_post(db, principal, post_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# Engagement                                                                    #
# --------------------------------------------------------------------------- #
#
# **These four routes answer with `PostEngagementOut`, not `WirePost`.** A like
# does not change a post's text, media or author, so re-serialising the whole post
# would be a large response for a one-bit change — and the client's optimistic
# update only needs the three numbers back. Sending the counts alone also removes
# any chance of a stale full post overwriting a newer one in the cache.
#
# **`/posts/{id}/comments` is declared before `/posts/{id}` is a non-issue here**
# because the two are different *paths*, not different literals for one. The
# ordering trap this router already documents is `/posts/mine` versus
# `/posts/{post_id}`, which are the same shape; these three-segment paths cannot
# collide with a one-segment route.


@router.post(
    "/{post_id}/like",
    response_model=PostEngagementOut,
    summary="Like a post (idempotent)",
)
def like_post(
    db: DbSession, principal: CurrentUser, post_id: PostId
) -> PostEngagementOut:
    """``POST /posts/{id}/like`` — record this account's like.

    **200, never 201 or 409.** The route is idempotent: a double tap and a retried
    request are the same event arriving twice, and both converge on the state the
    first call already reached. 201 would claim a resource that may not be new, and
    409 would make a correct client look broken. The returned counts are the
    authoritative post-write values, so an optimistic client can adopt them
    instead of guessing.
    """
    return svc.like_post(db, principal, post_id)


@router.delete(
    "/{post_id}/like",
    response_model=PostEngagementOut,
    summary="Remove this account's like (idempotent)",
)
def unlike_post(
    db: DbSession, principal: CurrentUser, post_id: PostId
) -> PostEngagementOut:
    """``DELETE /posts/{id}/like`` — remove this account's like.

    200 rather than 204 **because the counts change**, and a client that has
    optimistically decremented a number needs the server's real one back to
    reconcile against. A 204 would leave the card showing a guess.
    """
    return svc.unlike_post(db, principal, post_id)


@router.get(
    "/{post_id}/comments",
    response_model=Page[CommentRead],
    summary="A post's comments, newest first",
)
def list_comments(
    db: DbSession,
    principal: CurrentUser,
    post_id: PostId,
    params: tuple[int, int] = Depends(page_params),
) -> Page[CommentRead]:
    """``GET /posts/{id}/comments`` — the sheet's list, in the shared envelope.

    Readable by any authenticated member, exactly like the post itself. Only a
    missing or soft-deleted post 404s.
    """
    limit, offset = params
    return svc.list_comments(db, principal, post_id, limit=limit, offset=offset)


@router.post(
    "/{post_id}/comments",
    response_model=CommentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Comment on a post",
)
def create_comment(
    db: DbSession,
    principal: CurrentUser,
    post_id: PostId,
    payload: CommentCreate,
) -> CommentRead:
    """``POST /posts/{id}/comments`` — 201 with the stored comment.

    The author is the authenticated principal. `CommentCreate` has `extra="forbid"`
    and carries no `author_id`, so a client that tries to post as somebody else is
    rejected with a 422 naming the field rather than having it silently dropped.
    """
    return svc.create_comment(db, principal, post_id, payload)


@router.delete(
    "/{post_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete your own comment (soft delete)",
)
def delete_comment(
    db: DbSession, principal: CurrentUser, post_id: PostId, comment_id: str
) -> Response:
    """``DELETE /posts/{id}/comments/{comment_id}` — author only.

    **404 for another person's comment, not 403**: a 403 confirms the comment
    exists, which would make this route an oracle for probing ids. 204 because
    there is nothing left to say — the row becomes a tombstone and disappears from
    every read.
    """
    svc.delete_comment(db, principal, post_id, comment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
