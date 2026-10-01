"""``/stories`` — §10's five routes: three [M] the client calls, two [F] it does not.

**Route order is load-bearing.** ``/stories`` and ``/stories/{story_id}`` share a
prefix but no ambiguity, *except* that ``/stories/{story_id}/view`` must be matched
by the literal path first — it has a different shape (a third segment), so FastAPI's
router resolves it correctly regardless of order. It is declared before
``/{story_id}`` anyway, because that is the order that reads correctly and because
a future ``/stories/mine`` would then need no thought at all.

**The id is a ``str``, not a ``UUID``, and that is deliberate.**
``services.ownership.parse_id`` turns a malformed one into a 404 rather than a 422 —
the project's settled rule (`ownership.py`: "keeps the endpoint from becoming a
UUID-format oracle"). Annotating the path as ``UUID`` would make FastAPI reject the
shape before the route ran, so a 422 would say "that string is not a UUID", which
tells a caller something a 404 does not. Phase 6, Phase 7 and Phase 8 Posts all
assert this behaviour for their own routes.

**Authentication is a bearer token, and nothing more.** §10.1 makes stories visible
to "any authenticated candidate" and states there is "no per-viewer story ACL in V1",
so these routes take ``CurrentUser`` rather than ``CandidateUser``: the read
contract is about being signed in, not about a role, and adding a role gate would
answer 403 to a signed-in employer for no reason the specification gives.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.common import FastApiPage
from app.schemas.stories import StoryCreate, StoryOut, StoryViewOut
from app.services import stories as svc

router = APIRouter(prefix="/stories", tags=["stories"])

#: §10.1's page window. The client sends `?page=&page_size=`; both are 1-based, and
#: `page` is bounded above so a typo cannot ask for the whole table through an
#: enormous offset.
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100
MAX_PAGE_NUMBER = 10_000


def page_params(
    page: int = Query(1, ge=1, le=MAX_PAGE_NUMBER, description="1-based page number."),
    page_size: int = Query(
        DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE, description="Rows to return."
    ),
) -> tuple[int, int]:
    """The ``?page=&page_size=`` dependency for §10.1's envelope.

    Deliberately **not** `schemas.common.page_params`, which is the offset form.
    §25.6 keeps the two envelopes apart, so sharing one helper between them would be
    the first step towards the unification the specification defers.
    """
    return page, page_size


StoryId = Annotated[
    str,
    Path(description="A story id. A malformed id answers 404, not 422."),
]


@router.get("", response_model=FastApiPage[StoryOut])
def list_stories(
    db: DbSession,
    principal: CurrentUser,
    params: tuple[int, int] = Depends(page_params),
) -> FastApiPage[StoryOut]:
    """``GET /stories`` — §10.2's **active**-stories feed.

    Expired and archived stories are excluded in SQL, not filtered in Python, and
    the `COUNT` shares the predicate so `pages` cannot disagree with the rows.
    """
    page, page_size = params
    return svc.list_stories(db, principal, page=page, page_size=page_size)


@router.post("/{story_id}/view", response_model=StoryViewOut)
def record_view(
    db: DbSession, principal: CurrentUser, story_id: StoryId
) -> StoryViewOut:
    """``POST /stories/{id}/view`` — §10.2's idempotent per-viewer view.

    200 for both the first view and the repeat, because the two are the same event
    as far as the client is concerned; the `already_recorded` flag is what
    distinguishes them, and §10.2 asks for exactly that flag.
    """
    return svc.record_view(db, principal, story_id)


@router.get("/{story_id}", response_model=StoryOut)
def get_story(db: DbSession, principal: CurrentUser, story_id: StoryId) -> StoryOut:
    """``GET /stories/{id}`` — §10.1's "single story for the viewer"."""
    return svc.get_story(db, principal, story_id)


@router.post("", response_model=StoryOut, status_code=status.HTTP_201_CREATED)
def create_story(
    db: DbSession, principal: CurrentUser, payload: StoryCreate
) -> StoryOut:
    """``POST /stories`` — [F] in §10.1, so there is deliberately no mobile caller.

    It exists because stories are recruiter/platform-published content: the feed is
    unreadable without a publisher, and "server-side (platform/company)" is the
    specification's own justification for a writer that is not the feed reader.
    """
    return svc.create_story(db, principal, payload)


@router.delete("/{story_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_story(db: DbSession, principal: CurrentUser, story_id: StoryId) -> Response:
    """``DELETE /stories/{id}`` — [F] in §10.1. A hard delete, cascading its views."""
    svc.delete_story(db, principal, story_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
