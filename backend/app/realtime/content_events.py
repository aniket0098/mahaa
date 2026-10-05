"""Publish content realtime events — posts and stories.

This is the Phase 12 counterpart of ``notification_events``: it announces that a
row *already committed* so other members' feeds learn about it without polling.

Three invariants are enforced here rather than trusted, and each of them is a
rule the brief states as non-negotiable:

**Publish after commit, never before.** Every function is called from the
service *after* ``session.commit()`` has returned. The services stage the row and
publish outside the transaction precisely because an event published first would
tell every connected member about content a rollback then erased — the one
failure no client can reconcile.

**The payload is a notification, never a carrier.** It holds the row id, the
author id and a timestamp. No media bytes, no JWT, no email, no profile fields.
The client is expected to answer an event by re-fetching the authoritative row
over REST, which is why PostgreSQL stays the source of truth and the socket is
only an optimisation.

**A delivery failure is never a request failure.** The row is committed and REST
has already answered; losing realtime degrades the product, while raising here
would fail a request that in fact succeeded. Every publish is wrapped and logged
with an exception class name only.
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.realtime.events import EventType, RealtimeEvent
from app.realtime.runtime import get_runtime

logger = get_logger("mahaa.realtime.content")


def _publish(event: RealtimeEvent) -> None:
    """Hand one event to the runtime bus, swallowing delivery failures.

    ``publish_nowait`` rather than ``await``: the posts and stories services are
    synchronous, exactly like every other service in this project. The publish is
    handed to the event loop so an unreachable Redis cannot add its latency to a
    request whose database work has already succeeded.

    A missing runtime is a supported state — realtime failed to boot — so this
    returns quietly. The caller has already committed.
    """
    runtime = get_runtime()
    if runtime is None:
        return
    try:
        runtime.publish_nowait(event)
    except Exception as exc:  # noqa: BLE001 - never fail a committed request
        logger.warning(
            "realtime content publish failed",
            extra={"event_type": event.event_type, "reason": type(exc).__name__},
        )


def _content_event(event_type: str, payload: dict[str, Any]) -> None:
    """Stamp the shared envelope onto one broadcast content event.

    Every publisher below funnels through here so the "no recipient, because the
    audience is every member" decision is made in exactly one place and a future
    per-viewer content rule has one function to change.
    """
    _publish(RealtimeEvent(event_type=event_type, payload=payload))


def post_created(*, post_id: str, author_id: str, created_at: str) -> None:
    """Announce a committed post.

    Call this **after** ``session.commit()``.

    ``post_id`` is the row the client must fetch; ``author_id`` lets a client
    that already holds a post's card recognise its own author without a second
    request. Neither is derived from anything the client sent — the service
    writes ``principal.id`` into the column and reads it back here.
    """
    _content_event(
        EventType.POST_CREATED,
        {"post_id": post_id, "author_id": author_id, "created_at": created_at},
    )


def post_updated(*, post_id: str, author_id: str) -> None:
    """Announce that an edited post must be re-read.

    Call this **after** ``session.commit()``. There is no diff in the payload on
    purpose: a client cannot patch a card from a partial description of an edit,
    so it re-fetches, exactly as for creation.
    """
    _content_event(
        EventType.POST_UPDATED,
        {"post_id": post_id, "author_id": author_id},
    )


def post_deleted(*, post_id: str, author_id: str) -> None:
    """Announce a soft-deleted post.

    Call this **after** ``session.commit()**. Without this, a reader keeps
    rendering a card for a post that no longer exists in any REST read until they
    pull to refresh — the row is a tombstone, and only an event says so.
    """
    _content_event(
        EventType.POST_DELETED,
        {"post_id": post_id, "author_id": author_id},
    )


def story_created(*, story_id: str, author_id: str, created_at: str) -> None:
    """Announce a committed story.

    Call this **after** ``session.commit()**.

    §10.2 gives stories no per-viewer ACL, so the audience is the same as the
    feed's: every authenticated member. No caption, no publisher name and no
    media id ride along — the client fetches the story and renders the server's
    own fields, which is what keeps this an invalidation signal rather than a
    second, weaker rendering path.
    """
    _content_event(
        EventType.STORY_CREATED,
        {"story_id": story_id, "author_id": author_id, "created_at": created_at},
    )
