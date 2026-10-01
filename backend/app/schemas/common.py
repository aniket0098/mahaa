"""Schemas shared across domains: the pagination envelope and its parameters.

``Page<T>`` is the envelope the profile sections, the skill catalogue and the feed
all use: ``{items, total, limit, offset, has_more}``. It is *not* FastAPI's
``FastApiPage`` (``page``/``page_size``/``pages``) — the two coexist in the
specification because the client's return types encode both, and Phase 3 uses the
offset form. See spec §25.6.

``FastApiPage[T]`` is that second form, added with Phase 8 for ``/stories``. Its
docstring says why the divergence is deliberate rather than an oversight.
"""

from __future__ import annotations

from fastapi import Query
from pydantic import BaseModel

#: The section screens ask for 100 rows and the catalogue for 25. The ceiling is
#: 200 because a larger page is never what a phone wants and an unbounded
#: ``limit`` is an easy way to be handed the whole table.
DEFAULT_PAGE_LIMIT = 100
MAX_PAGE_LIMIT = 200


class Page[T](BaseModel):
    """One page of results, plus enough metadata to render a pager."""

    items: list[T]
    total: int
    limit: int
    offset: int
    has_more: bool


class FastApiPage[T](BaseModel):
    """The **other** envelope — ``{items, total, page, page_size, pages}``.

    §17 and §25.6 both name this divergence and both say to keep it in V1: the two
    forms "coexist across `/posts` and `/stories`" because "both are already encoded
    in the client's return types, and unifying them is a breaking change across two
    API modules and several screens for no user-visible gain".

    It exists here for the same reason `Page` does — `src/types/story.ts` declares
    `FastApiPage<T>` with exactly these five fields, and `src/api/stories.ts` reads
    `raw.page_size` and `raw.pages` off the response. A server that answered the
    offset shape instead would give the client `undefined` for all three.

    **``page`` is 1-based.** §10.1 says the client sends `?page=&page_size=`, and
    `pages` is then ``ceil(total / page_size)``. A 0-based page would make
    `pages == 0` for an empty feed, which reads as "no pages exist" rather than
    "no stories yet" — and the client renders that distinction as an honest empty
    state.
    """

    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


def build_fastapi_page[T](
    items: list[T], total: int, page: int, page_size: int
) -> FastApiPage[T]:
    """Assemble the second envelope.

    ``pages`` is ``ceil(total / page_size)``, computed from the **unfiltered**
    total so a full final page is reported as the last one rather than adding a
    phantom empty page — the same reasoning as :func:`build_page`.

    An empty result is **zero** pages, not one: with 1-based paging, page 1 of a
    0-page set is a request that does not exist, and the client shows its empty
    state instead of an empty page.
    """
    pages = -(-total // page_size) if page_size else 0
    return FastApiPage[T](
        items=items, total=total, page=page, page_size=page_size, pages=pages
    )


def page_params(
    limit: int = Query(
        DEFAULT_PAGE_LIMIT, ge=1, le=MAX_PAGE_LIMIT, description="Rows to return."
    ),
    offset: int = Query(0, ge=0, description="Rows to skip."),
) -> tuple[int, int]:
    """The shared ``?limit=&offset=`` dependency.

    One function rather than four copies of the same two ``Query`` declarations,
    so the bounds cannot drift between the section endpoints.
    """

    return limit, offset


def build_page[T](items: list[T], total: int, limit: int, offset: int) -> Page[T]:
    """Assemble the envelope.

    ``has_more`` is computed from the *unfiltered* total, not from ``len(items)``,
    so a full final page is correctly reported as the last one.
    """

    return Page[T](
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < total,
    )
