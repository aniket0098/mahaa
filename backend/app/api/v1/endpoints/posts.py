"""The ``/posts`` router — §9.1's six [M] routes.

**Only the [M] routes exist.** §9.1 marks likes, bookmarks, comments and report
**[F]** — "No mobile caller" — and there is a documented reason for each: stage 2,
a device-local like state, an honest empty `CommentsSheet`, and "no moderation
queue exists". A router with routes the client never calls, returning counts the
client never reads, would be surface the specification explicitly declined.

**Every route requires authentication, including the feed.** §9.1 marks all six
[M], and `docs/feed-api-contract.md` says "`GET /posts` is [M]" — a member-visible
community feed, not a public one. `CurrentUser`, not `CandidateUser`: the
specification does not restrict posting to one role, and inventing a role
restriction would break an employer who legitimately has something to say.

**``/posts/mine`` is declared before ``/posts/{post_id}``.** Starlette matches in
declaration order, so the parameterised route would otherwise capture "mine" and
bind it to a UUID parser, producing a 422 that reads like a client bug. The same
trap Phase 7 documents for `/users/me/photo` versus `/media/{media_id}`.

**There is no ``GET /posts/{id}/comments``** even though a comment table is
specified in §14.9, because §9.1 lists its routes as [F] and no table exists for
comments in this phase.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.models.enums import PostCategory
from app.schemas.common import Page, page_params
from app.schemas.posts import PostCreate, PostUpdate, WirePost
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
