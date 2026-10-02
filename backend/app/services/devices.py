"""``user_devices`` persistence — registration, reactivation, removal (§13.6).

**This module knows nothing about Expo.** It stores and forgets tokens; what to
do with one is `services/push.py`'s business. Keeping them apart is what lets the
provider be replaced (§13.5) without touching a single row of registration logic,
and it is why no HTTP client is imported here.

**Every function takes the caller explicitly and never looks for a "current
user".** Ownership is the JWT subject, so the only safe way to write this layer is
to make a caller-supplied id *required* rather than something a helper could
infer — an inferred user is how a registration ends up on the wrong account.

**Registration is idempotent by construction** (§13.6): the same user presenting
the same token gets the same row back, updated rather than duplicated. The
database enforces it too (`uq_user_devices_user_id_push_token`), so a concurrent
double-registration loses the race rather than creating a twin.

**An inactive device is reactivated, not duplicated.** §13.5 disables a token the
provider rejects; a client that later presents it again is a real client, and a
second row would leave the dead one to be rediscovered on the next delivery.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ApiError, ErrorCode
from app.models import User, UserDevice
from app.schemas.notifications import DeviceRead, DeviceRegistration
from app.services.ownership import parse_id


def _device_not_found() -> ApiError:
    """404 for a missing device *and* for another account's.

    §16's rule, and the same reasoning as ``notifications/{id}/read``: a distinct
    "not yours" answer would confirm that somebody else's device id exists, and a
    device id is an opaque uuid the client cannot legitimately guess — so the
    disclosure would be free.
    """

    return ApiError(
        status_code=404,
        code=ErrorCode.NOT_FOUND,
        message="That device is not registered.",
    )


def _read(row: UserDevice) -> DeviceRead:
    """Build the read model.

    Note what is absent: ``push_token`` has no field to go into (§13.6). This is
    why the token cannot be echoed even by accident.
    """

    return DeviceRead(
        id=str(row.id),
        platform=row.platform,
        device_name=row.device_name,
        is_active=row.is_active,
        created_at=row.created_at.isoformat(),
        last_seen_at=row.last_seen_at.isoformat() if row.last_seen_at else None,
    )


def _now() -> datetime:
    return datetime.now(UTC)


def register(session: Session, viewer: User, payload: DeviceRegistration) -> DeviceRead:
    """Register or refresh one push device for ``viewer``.

    Idempotent, per §13.6: "same authenticated user + same push token = same
    device registration". An existing row is updated — ``last_seen_at`` always,
    ``device_name`` when supplied — and an inactive row is reactivated, because a
    client presenting a token again is evidence the device is live.
    """
    existing = session.scalar(
        select(UserDevice).where(
            UserDevice.user_id == viewer.id,
            UserDevice.push_token == payload.push_token,
        )
    )
    if existing is not None:
        existing.last_seen_at = _now()
        if payload.device_name is not None:
            existing.device_name = payload.device_name
        # Reactivated, not shadowed: leaving it inactive would keep the addressee
        # off the very device that just proved it works.
        existing.is_active = True
        session.add(existing)
        session.commit()
        return _read(existing)

    row = UserDevice(
        user_id=viewer.id,
        push_token=payload.push_token,
        platform=payload.platform,
        device_name=payload.device_name,
        is_active=True,
        last_seen_at=_now(),
    )
    session.add(row)
    try:
        session.commit()
    except IntegrityError:
        # Two concurrent registrations of the same token. The unique constraint
        # did its job; the loser re-reads the winner's row rather than surfacing a
        # 500 for something the client retried by accident.
        session.rollback()
        winner = session.scalar(
            select(UserDevice).where(
                UserDevice.user_id == viewer.id,
                UserDevice.push_token == payload.push_token,
            )
        )
        if winner is None:
            raise
        return _read(winner)
    return _read(row)


def remove(session: Session, viewer: User, raw_id: str) -> None:
    """``DELETE /notifications/devices/{device_id}``.

    Owner-only, and a device belonging to another account is the **same 404** as
    one that does not exist (§13.6, §16), so the response cannot be used to
    confirm that another user's device id is real.

    **A repeated removal is also a 404, deliberately** — the row is gone, so there
    is nothing left to prove ownership of, and a 204 would claim the API removed
    something it did not. §18's target-state pattern covers a *state transition*
    (marking read), not a deletion, so it does not apply here. A client that
    unregisters twice — which §13.5 anticipates, since logout is a fire-and-forget
    best-effort call — treats 404 as success on its side; see
    ``unregisterForPush`` in ``src/notifications/push.ts``.
    """
    device_id = parse_id(raw_id, "device")
    device = session.scalar(
        select(UserDevice).where(
            UserDevice.id == device_id,
            UserDevice.user_id == viewer.id,
        )
    )
    if device is None:
        raise _device_not_found()
    session.delete(device)
    session.commit()


def active_for(session: Session, user_id: uuid.UUID) -> list[UserDevice]:
    """Every device currently receiving pushes for ``user_id``.

    The only read the push service needs, and deliberately the only one: it must
    not be able to reach an inactive row, so there is no "include inactive"
    parameter for a caller to get wrong.
    """

    return list(
        session.scalars(
            select(UserDevice).where(
                UserDevice.user_id == user_id,
                UserDevice.is_active.is_(True),
            )
        )
    )


def deactivate(session: Session, device: UserDevice) -> None:
    """Mark one device inactive rather than deleting it (§13.5).

    Kept rather than dropped because provider errors are frequently transient: a
    token that is invalid now may be valid again, and destroying the row would
    turn a delivery hiccup into a device the user has to re-add by hand.
    """

    device.is_active = False
    session.add(device)
    session.commit()
