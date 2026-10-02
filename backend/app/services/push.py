"""Push delivery — Expo Push Service, and nothing else (§13.5).

**This module delivers; it never creates.** It accepts an already-committed
`Notification` and the devices that should receive it, and it makes no decision
about whether a notification ought to exist. That boundary is the whole reason it
is a separate file from `services/notifications.py`: a push failure must not be
able to affect the row, and the only structural way to guarantee that is for
nothing here to be able to write one.

**Provider: Expo Push Service.** §13.5 chose it over direct FCM because the app
is already Expo, so no Firebase native configuration or service-account JSON is
needed anywhere. The URL is a module constant rather than configuration, because
it is public; only the access token is secret, and that comes from the
environment.

**Nothing here raises into a request.** Every provider call is wrapped: the
notification is already committed and already delivered over the WebSocket, so a
push that fails is logged and dropped. Losing a push loses nothing the user
cannot get from REST.

**`EXPO_ACCESS_TOKEN` is optional configuration, and its absence is not an
error.** A deployment without it logs a sanitised warning and skips delivery —
the app still works, notifications still land over the socket, and nothing
crashes. That is what makes "optional" true rather than aspirational.
"""

from __future__ import annotations

import json
import urllib.request
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models import Notification, UserDevice
from app.models.enums import NotificationType
from app.services import devices as device_service

logger = get_logger("mahaa.push")

#: Expo's documented endpoint. Public by design — the credential is the access
#: token, not the address.
PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send"

#: §13.5: a payload is a pointer, never a copy of server state. Four fields, and
#: the client resolves the rest over authenticated REST using `notification_id`.
PUSH_DATA_FIELDS = ("notification_id", "type", "target_type", "target_id")

#: §13.5 forbids message text in a push payload, because a notification is
#: rendered on a lock screen. This is the generic wording the tray shows instead.
GENERIC_MESSAGE_TITLE = "New message"

#: Expo's own vocabulary for "this token will never work again".
INVALID_TOKEN_CODES = frozenset({"DeviceNotRegistered"})

#: Short enough that a background request does not hold a worker, long enough
#: that the provider is not treated as unreachable by a transient blip.
REQUEST_TIMEOUT_SECONDS = 10


def push_data(notification: Notification) -> dict[str, Any]:
    """The push payload for one notification — identifiers only (§13.5).

    Asserted by test to contain nothing else: no title, no body, no message text,
    no actor, no credential. A payload that grew would be a disclosure on a locked
    screen, so this is built from four fields rather than from a filtered copy of
    the notification.
    """

    return {
        "notification_id": str(notification.id),
        "type": (
            notification.type.value
            if hasattr(notification.type, "value")
            else str(notification.type)
        ),
        "target_type": notification.target_type,
        "target_id": str(notification.target_id) if notification.target_id else None,
    }


def push_message(notification: Notification, push_token: str) -> dict[str, Any]:
    """One Expo send request.

    The visible text is the §13.5 generic wording for a message and the stored
    ``title``/``body`` otherwise. The stored title is server-rendered copy ("New
    connection request"), never user content, so it is safe on a lock screen where
    a message body would not be.
    """

    is_message = (
        notification.type is NotificationType.MESSAGE
        or notification.type == NotificationType.MESSAGE.value
    )
    title = GENERIC_MESSAGE_TITLE if is_message else notification.title
    return {
        # `data` is what the app reads on tap; `title`/`body` are what the tray
        # renders when the app is dead.
        "to": push_token,
        "title": title,
        # Empty rather than absent for a message: §13.5 wants nothing but the
        # generic title on the lock screen.
        "body": "" if is_message else (notification.body or ""),
        "data": push_data(notification),
        # §13.5: the WebSocket is authoritative while the app runs, so a push that
        # arrives in the foreground must not raise a second banner.
        "_contentAvailable": True,
    }


def _access_token() -> str | None:
    """``EXPO_ACCESS_TOKEN`` from the environment, or ``None``.

    Never logged and never returned — not even lengthened or truncated in a log
    line. The only evidence of a misconfiguration is a message with no value in
    it.
    """

    token = get_settings().expo_access_token.strip()
    return token or None


def deliver(
    session: Session, notification: Notification, targets: list[UserDevice]
) -> int:
    """Push one notification to ``targets``.

    Returns how many the provider accepted. **Never raises**: §13.5 makes push
    best-effort, and the notification behind it is already committed and already
    delivered over the WebSocket.
    """
    if not targets:
        return 0

    token = _access_token()
    if token is None:
        # Reported without any value, and once per call rather than once per
        # device, so an unconfigured deployment is quiet rather than noisy.
        logger.warning(
            "push delivery skipped: no provider credential configured",
            extra={"event_type": "push.skipped"},
        )
        return 0

    delivered = 0
    for device in targets:
        # One device at a time, on purpose: a single bad token must not prevent
        # delivery to the rest, and a batched request would make that impossible
        # to guarantee without inspecting every result.
        try:
            accepted, invalid = _post(
                push_message(notification, device.push_token), token
            )
        except Exception as exc:  # noqa: BLE001 - delivery is best-effort
            # Class name only. A provider message can echo the token back, and
            # the token is a credential.
            logger.warning(
                "push delivery failed",
                extra={"reason": type(exc).__name__},
            )
            continue
        if invalid:
            # §13.5: disabled, never deleted, and only this device.
            try:
                device_service.deactivate(session, device)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "push token deactivation failed",
                    extra={"reason": type(exc).__name__},
                )
        elif accepted:
            delivered += 1
    return delivered


def dispatch(session: Session, notification: Notification) -> int:
    """Deliver a committed notification to every active device of its recipient.

    **Call this only after ``session.commit()`` has returned** — the same
    placement rule ``realtime/notification_events.publish_for`` obeys, and for the
    same reason: a push sent for a row a rollback erases is a notification the
    user can act on but never retrieve. Ordering within the three side effects is
    WebSocket first, then push, because the socket is authoritative while the app
    runs and the push is the background fallback.

    **Never raises.** The row is durable and the REST response is already owed to
    the caller; a provider outage must not convert a successful operation into a
    500. The exception class is logged, never the message, because provider
    errors can echo a token back.
    """

    try:
        targets = device_service.active_for(session, notification.user_id)
    except Exception as exc:  # noqa: BLE001 - never fail a committed request
        logger.warning(
            "push device lookup failed",
            extra={"reason": type(exc).__name__},
        )
        return 0
    try:
        return deliver(session, notification, targets)
    except Exception as exc:  # noqa: BLE001 - never fail a committed request
        logger.warning("push dispatch failed", extra={"reason": type(exc).__name__})
        return 0


def _post(message: dict[str, Any], access_token: str) -> tuple[bool, bool]:

    request = urllib.request.Request(  # noqa: S310 - fixed https endpoint above
        PUSH_ENDPOINT,
        data=json.dumps(message).encode(),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        body = json.loads(response.read().decode() or "{}")
    data = body.get("data") or {}
    if str(data.get("status", "")) == "ok":
        return True, False
    # A rejected token is a fact about *this device*, not about the notification.
    details = data.get("details") or {}
    if details.get("error") in INVALID_TOKEN_CODES:
        return False, True
    return False, False
