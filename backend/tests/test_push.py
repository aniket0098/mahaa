"""Phase 4 — push: ``user_devices`` and Expo delivery.

Two things are worth stating about what these tests do and do not prove.

**No provider is contacted.** Every test either intercepts ``services.push._post``
or leaves it uncalled, so the suite needs no credential and no network. A test
that reached Expo would be one that fails when Expo is down, and would put a real
token anywhere near a test log.

**The privacy assertions are the point.** §13.5's real content is a negative: a
push may carry identifiers and nothing else. So the payload is asserted field by
field *and* the serialized bytes are searched for message text and for the
project's secrets — a payload test that only checked the four expected keys would
pass just as happily if a fifth had been added.
"""

from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Notification, NotificationType, User, UserDevice
from app.schemas.notifications import DeviceRegistration
from app.services import devices as device_svc
from app.services import notifications as notify_svc
from app.services import push

#: A syntactically plausible Expo token. Nothing in the suite treats it as real.
TOKEN = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]"
#: A second, distinct token so multi-device behaviour can be exercised.
OTHER_TOKEN = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb]"
#: A never-real credential, used to switch delivery *on* without contacting anyone.
FAKE_CREDENTIAL = "test-credential-not-real"


def user_for(db_session, account) -> User:
    """The ORM ``User`` behind an ``Account``.

    Service-level assertions need a real model instance; the ``Account`` fixture
    holds only the JSON representation, and its ``id`` is a *string*. Resolving it
    through the session means a test compares uuids with uuids rather than
    relying on a driver-specific string coercion.
    """

    return db_session.get(User, uuid.UUID(account.id))


def register(db_session, account, token: str = TOKEN, name: str | None = None):
    """Register a device through the real service layer."""

    return device_svc.register(
        db_session,
        user_for(db_session, account),
        DeviceRegistration(push_token=token, platform="android", device_name=name),
    )


def make_notification(db_session, recipient, **overrides: Any) -> Notification:
    """A committed notification row, built directly so the test owns its type."""

    row = Notification(
        user_id=recipient.id,
        type=overrides.pop("type", NotificationType.MESSAGE),
        actor_id=None,
        target_type=overrides.pop("target_type", "conversation"),
        target_id=overrides.pop("target_id", uuid.uuid4()),
        title=overrides.pop("title", "New message"),
        body=overrides.pop("body", "hey, are you free tomorrow?"),
        data=overrides.pop("data", {"conversation_id": str(uuid.uuid4())}),
    )
    db_session.add(row)
    db_session.commit()
    return row


def record_posts(monkeypatch) -> list[dict[str, Any]]:
    """Intercept the provider call, capturing what would have been sent."""

    sent: list[dict[str, Any]] = []
    monkeypatch.setattr(
        push, "_post", lambda message, token: (sent.append(message), (True, False))[1]
    )
    return sent


@contextmanager
def enable_push():
    """Turn delivery on with a fake credential, so nothing real is contacted.

    Mutates the cached ``Settings`` object rather than the environment, because
    ``get_settings`` is ``lru_cache``d — a ``setenv`` after the first call would
    never be read. This is the same approach ``test_realtime.py`` uses for
    ``redis_url``, and the previous value is restored on exit.
    """

    from app.core.config import get_settings

    settings = get_settings()
    previous = settings.expo_access_token
    settings.expo_access_token = FAKE_CREDENTIAL
    try:
        yield
    finally:
        settings.expo_access_token = previous


@contextmanager
def disable_push():
    """The unconfigured state: no credential, which must be a safe no-op."""

    from app.core.config import get_settings

    settings = get_settings()
    previous = settings.expo_access_token
    settings.expo_access_token = ""
    try:
        yield
    finally:
        settings.expo_access_token = previous


def stage_message(db_session, recipient):
    """``emit`` a message notification without committing — as the domain does."""

    return notify_svc.emit(
        db_session,
        recipient_id=recipient.id,
        notification_type=NotificationType.MESSAGE,
        target_type="conversation",
        target_id=uuid.uuid4(),
        title="New message",
        body="text that must never be pushed",
        data={},
    )


@pytest.fixture()
def device(api_client, candidate):
    """One active device owned by ``candidate``, via the real HTTP route."""

    response = api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": "android", "device_name": "Pixel"},
        headers=candidate.headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


# --- table and model (§14.13) ------------------------------------------------


def test_device_belongs_to_user(db_session, candidate) -> None:
    register(db_session, candidate)
    row = db_session.scalar(select(UserDevice))
    assert row is not None
    assert row.user_id == uuid.UUID(candidate.id)


def test_platform_check_constraint_lives_in_the_database(
    db_session, user_factory
) -> None:
    """A CHECK, not merely a Pydantic pattern — the database is the backstop."""

    user = user_factory()
    db_session.add(
        UserDevice(
            user_id=user.id, push_token=TOKEN, platform="windows", is_active=True
        )
    )
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


@pytest.mark.parametrize("platform", ["android", "ios"])
def test_platform_accepts_both_allowed_values(
    db_session, user_factory, platform
) -> None:
    user = user_factory()
    db_session.add(
        UserDevice(user_id=user.id, push_token=TOKEN, platform=platform, is_active=True)
    )
    db_session.commit()
    assert db_session.scalar(select(UserDevice)).platform == platform


def test_unique_user_id_push_token(db_session, candidate) -> None:
    register(db_session, candidate)
    db_session.add(
        UserDevice(
            user_id=uuid.UUID(candidate.id),
            push_token=TOKEN,
            platform="android",
            is_active=True,
        )
    )
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_same_token_is_allowed_for_two_different_users(
    db_session, candidate, other_candidate
) -> None:
    """Uniqueness is scoped to the owner on purpose.

    A device that changes hands would otherwise have its delivery stolen by
    whichever account registered last.
    """

    register(db_session, candidate)
    register(db_session, other_candidate)
    assert len(device_svc.active_for(db_session, uuid.UUID(candidate.id))) == 1
    assert len(device_svc.active_for(db_session, uuid.UUID(other_candidate.id))) == 1


def test_active_index_exists() -> None:
    """The delivery lookup's index is declared under its specified name."""

    from app.db.base import Base

    names = {
        index.name for table in Base.metadata.tables.values() for index in table.indexes
    }
    assert "ix_user_devices_user_id_is_active" in names


def test_device_cascades_with_its_user(db_session, candidate) -> None:
    register(db_session, candidate)
    db_session.delete(user_for(db_session, candidate))
    db_session.commit()
    assert db_session.scalars(select(UserDevice)).all() == []


# --- POST /notifications/devices (§13.6) ------------------------------------


def test_register_requires_authentication(api_client) -> None:
    response = api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": "android"},
    )
    assert response.status_code == 401


def test_register_succeeds(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": "android", "device_name": "Pixel"},
        headers=candidate.headers,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["platform"] == "android"
    assert body["device_name"] == "Pixel"
    assert body["is_active"] is True
    assert body["last_seen_at"] is not None
    assert uuid.UUID(body["id"])


def test_register_never_echoes_the_token(api_client, candidate) -> None:
    """§13.6: the token is write-only. `DeviceRead` has no field for it."""

    response = api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": "android"},
        headers=candidate.headers,
    )
    assert response.status_code == 201, response.text
    assert TOKEN not in response.text
    assert "push_token" not in response.json()


def test_register_requires_a_token(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/notifications/devices",
        json={"platform": "android"},
        headers=candidate.headers,
    )
    assert response.status_code == 422


def test_register_requires_a_platform(api_client, candidate) -> None:
    response = api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN},
        headers=candidate.headers,
    )
    assert response.status_code == 422


@pytest.mark.parametrize("platform", ["windows", "web", "ANDROID", ""])
def test_register_rejects_an_unknown_platform(api_client, candidate, platform) -> None:
    response = api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": platform},
        headers=candidate.headers,
    )
    assert response.status_code == 422


def test_register_rejects_a_client_supplied_user_id(
    api_client, candidate, other_candidate
) -> None:
    """A client cannot name the owner — §13.6, enforced by ``extra="forbid"``."""

    response = api_client.post(
        "/api/v1/notifications/devices",
        json={
            "push_token": TOKEN,
            "platform": "android",
            "user_id": str(other_candidate.id),
        },
        headers=candidate.headers,
    )
    assert response.status_code == 422


def test_a_supplied_user_id_registers_nothing(
    db_session, api_client, candidate, other_candidate
) -> None:
    """The rejected request must leave no row behind on either account."""

    api_client.post(
        "/api/v1/notifications/devices",
        json={
            "push_token": TOKEN,
            "platform": "android",
            "user_id": str(other_candidate.id),
        },
        headers=candidate.headers,
    )
    assert device_svc.active_for(db_session, uuid.UUID(other_candidate.id)) == []
    assert device_svc.active_for(db_session, uuid.UUID(candidate.id)) == []


def test_owner_is_the_jwt_subject(db_session, api_client, candidate) -> None:
    api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": "android"},
        headers=candidate.headers,
    )
    devices = device_svc.active_for(db_session, uuid.UUID(candidate.id))
    assert len(devices) == 1
    assert devices[0].user_id == uuid.UUID(candidate.id)


def test_registration_is_idempotent(db_session, api_client, candidate) -> None:
    """§13.6: same user + same token = same device, on every authenticated start."""

    first = api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": "android"},
        headers=candidate.headers,
    )
    second = api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": "android"},
        headers=candidate.headers,
    )
    assert first.status_code == second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert len(device_svc.active_for(db_session, uuid.UUID(candidate.id))) == 1


def test_registration_does_not_accumulate_rows(
    db_session, api_client, candidate
) -> None:
    for _ in range(3):
        api_client.post(
            "/api/v1/notifications/devices",
            json={"push_token": TOKEN, "platform": "android"},
            headers=candidate.headers,
        )
    assert db_session.query(UserDevice).count() == 1


def test_registration_refreshes_last_seen(api_client, candidate) -> None:
    first = api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": "android"},
        headers=candidate.headers,
    )
    second = api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": "android"},
        headers=candidate.headers,
    )
    assert second.json()["last_seen_at"] >= first.json()["last_seen_at"]


def test_registration_reactivates_an_inactive_device(
    db_session, api_client, candidate
) -> None:
    """A token the provider rejected comes back when a real client presents it."""

    existing = register(db_session, candidate)
    row = db_session.get(UserDevice, uuid.UUID(existing.id))
    device_svc.deactivate(db_session, row)
    assert row.is_active is False

    response = api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": "android"},
        headers=candidate.headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["is_active"] is True
    assert response.json()["id"] == existing.id


def test_reactivation_reuses_the_row_rather_than_adding_one(
    db_session, api_client, candidate
) -> None:
    existing = register(db_session, candidate)
    device_svc.deactivate(
        db_session, db_session.get(UserDevice, uuid.UUID(existing.id))
    )
    api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": "android"},
        headers=candidate.headers,
    )
    assert db_session.query(UserDevice).count() == 1


def test_registration_updates_device_name(db_session, api_client, candidate) -> None:
    register(db_session, candidate, name="Old")
    response = api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": "android", "device_name": "New"},
        headers=candidate.headers,
    )
    assert response.json()["device_name"] == "New"


def test_registration_keeps_the_name_when_none_is_supplied(
    db_session, api_client, candidate
) -> None:
    """An omitted optional field must not silently erase a known one."""

    register(db_session, candidate, name="Pixel")
    response = api_client.post(
        "/api/v1/notifications/devices",
        json={"push_token": TOKEN, "platform": "android"},
        headers=candidate.headers,
    )
    assert response.json()["device_name"] == "Pixel"


def test_a_second_token_is_a_second_device(db_session, candidate) -> None:
    """A user with a phone and a tablet registers two rows."""

    register(db_session, candidate, token=TOKEN, name="Phone")
    register(db_session, candidate, token=OTHER_TOKEN, name="Tablet")
    devices = device_svc.active_for(db_session, uuid.UUID(candidate.id))
    assert len(devices) == 2
    assert {d.device_name for d in devices} == {"Phone", "Tablet"}


# --- DELETE /notifications/devices/{device_id} (§13.6, §16) ------------------


def test_remove_requires_authentication(api_client, device) -> None:
    response = api_client.delete(f"/api/v1/notifications/devices/{device['id']}")
    assert response.status_code == 401


def test_owner_can_remove(api_client, candidate, device) -> None:
    response = api_client.delete(
        f"/api/v1/notifications/devices/{device['id']}", headers=candidate.headers
    )
    assert response.status_code == 204, response.text
    assert response.content == b""


def test_removal_actually_removes_the_row(
    db_session, api_client, candidate, device
) -> None:
    api_client.delete(
        f"/api/v1/notifications/devices/{device['id']}", headers=candidate.headers
    )
    assert device_svc.active_for(db_session, uuid.UUID(candidate.id)) == []


def _error_envelope(response) -> dict:
    """The error body minus ``request_id``.

    Every response carries a correlation id, and it differs between two requests
    by design — comparing whole bodies would fail for a reason that has nothing to
    do with the guarantee under test. What must be identical is everything a
    caller could act on: the code, the message, and the details.
    """

    body = response.json().get("error", {})
    return {key: body.get(key) for key in ("code", "message", "details")}


def test_another_user_cannot_remove(api_client, other_candidate, device) -> None:
    """Another account's device is a 404, not a 403 — §16's disclosure rule."""

    response = api_client.delete(
        f"/api/v1/notifications/devices/{device['id']}", headers=other_candidate.headers
    )
    assert response.status_code == 404


def test_another_users_device_is_indistinguishable_from_a_missing_one(
    api_client, other_candidate, device
) -> None:
    """The anti-enumeration guarantee itself, as a test.

    A distinct answer for "exists but not yours" would turn the endpoint into an
    oracle: the caller learns that somebody else's device id is real, which is
    precisely the information §16 forbids disclosing.
    """

    foreign = api_client.delete(
        f"/api/v1/notifications/devices/{device['id']}", headers=other_candidate.headers
    )
    missing = api_client.delete(
        f"/api/v1/notifications/devices/{uuid.uuid4()}", headers=other_candidate.headers
    )
    assert foreign.status_code == missing.status_code == 404
    assert _error_envelope(foreign) == _error_envelope(missing)


def test_another_users_failed_removal_leaves_the_registration(
    db_session, api_client, other_candidate, device
) -> None:
    api_client.delete(
        f"/api/v1/notifications/devices/{device['id']}", headers=other_candidate.headers
    )
    assert len(db_session.query(UserDevice).filter_by(is_active=True).all()) == 1


def test_removing_an_unknown_device_is_404(api_client, candidate) -> None:
    response = api_client.delete(
        f"/api/v1/notifications/devices/{uuid.uuid4()}", headers=candidate.headers
    )
    assert response.status_code == 404


def test_removing_a_malformed_id_is_404(api_client, candidate) -> None:
    """``parse_id`` answers 404, not 422 — an id-format oracle is its own leak."""

    response = api_client.delete(
        "/api/v1/notifications/devices/not-a-uuid", headers=candidate.headers
    )
    assert response.status_code == 404


def test_a_repeated_removal_is_indistinguishable_from_a_never_existing_one(
    api_client, candidate, device
) -> None:
    """§16 again, for the owner's own second attempt.

    The first removal legitimately answers 204 — it really did delete a row. The
    guarantee is about every attempt *after* that: a caller who repeats a logout's
    unregister must get the same 404 a stranger's id gets, not a distinct "already
    removed" answer. The two bodies have to match, or the endpoint leaks that the
    id was once real.
    """

    first = api_client.delete(
        f"/api/v1/notifications/devices/{device['id']}", headers=candidate.headers
    )
    assert first.status_code == 204, first.text

    repeated = api_client.delete(
        f"/api/v1/notifications/devices/{device['id']}", headers=candidate.headers
    )
    unknown = api_client.delete(
        f"/api/v1/notifications/devices/{uuid.uuid4()}", headers=candidate.headers
    )
    assert repeated.status_code == unknown.status_code == 404
    assert _error_envelope(repeated) == _error_envelope(unknown)


def test_remove_never_returns_the_token(api_client, candidate, device) -> None:
    response = api_client.delete(
        f"/api/v1/notifications/devices/{device['id']}", headers=candidate.headers
    )
    assert response.status_code == 204
    assert TOKEN not in response.text


def test_second_removal_is_404(api_client, candidate, device) -> None:
    """The row is gone, so there is nothing left to own.

    A client unregistering twice during logout is ordinary, so the mobile helper
    treats this as success — but the API must not pretend the second call removed
    something.
    """

    api_client.delete(
        f"/api/v1/notifications/devices/{device['id']}", headers=candidate.headers
    )
    again = api_client.delete(
        f"/api/v1/notifications/devices/{device['id']}", headers=candidate.headers
    )
    assert again.status_code == 404


def test_removing_one_device_leaves_the_others(
    db_session, api_client, candidate
) -> None:
    """Logout cleanup must not disable the user's second device."""

    phone = register(db_session, candidate, token=TOKEN, name="Phone")
    register(db_session, candidate, token=OTHER_TOKEN, name="Tablet")
    api_client.delete(
        f"/api/v1/notifications/devices/{phone.id}", headers=candidate.headers
    )
    remaining = device_svc.active_for(db_session, uuid.UUID(candidate.id))
    assert [d.device_name for d in remaining] == ["Tablet"]


# --- push payload and privacy (§13.5) ----------------------------------------


def test_push_payload_is_identifiers_only(db_session, candidate) -> None:
    notification = make_notification(db_session, user_for(db_session, candidate))
    assert set(push.push_data(notification)) == set(push.PUSH_DATA_FIELDS)


def test_push_payload_carries_the_notification_identity(db_session, candidate) -> None:
    notification = make_notification(db_session, user_for(db_session, candidate))
    data = push.push_data(notification)
    assert data["notification_id"] == str(notification.id)
    assert data["type"] == NotificationType.MESSAGE.value
    assert data["target_type"] == "conversation"
    assert data["target_id"] == str(notification.target_id)


def test_push_payload_tolerates_a_notification_with_no_target(
    db_session, candidate
) -> None:
    """A system notification has no target; the fields are still present."""

    notification = make_notification(
        db_session, user_for(db_session, candidate), target_type=None, target_id=None
    )
    data = push.push_data(notification)
    assert data["target_type"] is None
    assert data["target_id"] is None


def test_message_push_title_is_generic(db_session, candidate) -> None:
    notification = make_notification(
        db_session, user_for(db_session, candidate), type=NotificationType.MESSAGE
    )
    assert push.push_message(notification, TOKEN)["title"] == "New message"


def test_message_push_contains_no_message_text(db_session, candidate) -> None:
    """The lock-screen assertion of §13.5, made byte-level."""

    secret = "are you free tomorrow? CONFIDENTIAL"
    notification = make_notification(
        db_session, user_for(db_session, candidate), body=secret
    )
    message = push.push_message(notification, TOKEN)
    assert secret not in json.dumps(message)
    assert message["body"] == ""


def test_message_push_excludes_the_stored_title_and_body(db_session, candidate) -> None:
    """Even the stored fields are not copied for a message."""

    notification = make_notification(
        db_session,
        user_for(db_session, candidate),
        type=NotificationType.MESSAGE,
        title="secret title",
        body="secret body",
    )
    message = push.push_message(notification, TOKEN)
    assert message["title"] == "New message"
    assert "secret title" not in json.dumps(message)
    assert "secret body" not in json.dumps(message)


def test_non_message_push_keeps_server_rendered_copy(db_session, candidate) -> None:
    """A connection request's title is server copy, not user content, so it is safe."""

    notification = make_notification(
        db_session,
        user_for(db_session, candidate),
        type=NotificationType.CONNECTION_REQUEST,
        title="New connection request",
        body="Wants to connect",
        target_type="connection",
    )
    message = push.push_message(notification, TOKEN)
    assert message["title"] == "New connection request"
    assert message["body"] == "Wants to connect"


def test_notification_data_json_is_not_forwarded(db_session, candidate) -> None:
    """``Notification.data`` is server-chosen, but push is identifiers only anyway."""

    notification = make_notification(
        db_session,
        user_for(db_session, candidate),
        data={"conversation_id": "leak-me-not"},
    )
    assert "leak-me-not" not in json.dumps(push.push_message(notification, TOKEN))


@pytest.mark.parametrize(
    "secret",
    [
        "eyJhbGciOiJIUzI1NiJ9.a-real-looking-jwt",
        "postgresql://user:hunter2@db.host:5432/mahaa",
        "redis://:hunter2@cache.internal:6379/0",
        "livekit-api-secret-abc123",
        "DATABASE_URL",
    ],
)
def test_push_payload_carries_no_ambient_credential(
    db_session, candidate, monkeypatch, secret
) -> None:
    """No configured secret may ride along in a payload.

    The payload is *built* from four fields, so there is no path for ambient
    configuration to reach it — this test is what would catch someone adding one.
    """

    for name in (
        "DATABASE_URL",
        "REDIS_URL",
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
        "SECRET_KEY",
    ):
        monkeypatch.setenv(name, secret)
    notification = make_notification(db_session, user_for(db_session, candidate))
    assert secret not in json.dumps(push.push_message(notification, TOKEN))


def test_push_message_addresses_the_token(db_session, candidate) -> None:
    """The token is the address — present here is correct, not a disclosure."""

    notification = make_notification(db_session, user_for(db_session, candidate))
    assert push.push_message(notification, TOKEN)["to"] == TOKEN


def test_push_message_requests_background_content(db_session, candidate) -> None:
    """§13.6: the payload exists so a backgrounded app can invalidate its queries."""

    notification = make_notification(db_session, user_for(db_session, candidate))
    assert push.push_message(notification, TOKEN)["_contentAvailable"] is True


# --- delivery, failure and invalidation (§13.5) ------------------------------


def active_for(db_session, account):
    """The devices delivery would reach for ``account``."""

    return device_svc.active_for(db_session, uuid.UUID(account.id))


def test_deliver_without_a_credential_is_a_safe_no_op(
    db_session, candidate, monkeypatch
) -> None:
    """No credential must skip delivery quietly, never raise."""

    sent = record_posts(monkeypatch)
    with disable_push():
        notification = make_notification(db_session, user_for(db_session, candidate))
        register(db_session, candidate)
        delivered = push.deliver(
            db_session, notification, active_for(db_session, candidate)
        )
    assert delivered == 0
    assert sent == []


def test_deliver_without_a_credential_leaves_the_device_active(
    db_session, candidate, monkeypatch
) -> None:
    """A misconfigured server is not a reason to disable every device."""

    record_posts(monkeypatch)
    with disable_push():
        notification = make_notification(db_session, user_for(db_session, candidate))
        register(db_session, candidate)
        push.deliver(db_session, notification, active_for(db_session, candidate))
    assert len(active_for(db_session, candidate)) == 1


def test_deliver_sends_once_per_device(db_session, candidate, monkeypatch) -> None:
    sent = record_posts(monkeypatch)
    with enable_push():
        notification = make_notification(db_session, user_for(db_session, candidate))
        register(db_session, candidate)
        delivered = push.deliver(
            db_session, notification, active_for(db_session, candidate)
        )
    assert delivered == 1
    assert [m["to"] for m in sent] == [TOKEN]


def test_deliver_sends_to_every_active_device(
    db_session, candidate, monkeypatch
) -> None:
    sent = record_posts(monkeypatch)
    with enable_push():
        notification = make_notification(db_session, user_for(db_session, candidate))
        register(db_session, candidate, token=TOKEN)
        register(db_session, candidate, token=OTHER_TOKEN)
        delivered = push.deliver(
            db_session, notification, active_for(db_session, candidate)
        )
    assert delivered == 2
    assert {m["to"] for m in sent} == {TOKEN, OTHER_TOKEN}


def test_push_failure_leaves_the_notification_intact(
    db_session, candidate, monkeypatch
) -> None:
    """A provider outage must not lose the row — §13.5."""

    def explode(message, token):
        raise OSError("network down")

    monkeypatch.setattr(push, "_post", explode)
    with enable_push():
        notification = make_notification(db_session, user_for(db_session, candidate))
        register(db_session, candidate)
        delivered = push.deliver(
            db_session, notification, active_for(db_session, candidate)
        )
    assert delivered == 0
    assert db_session.get(Notification, notification.id) is not None


def test_push_failure_leaves_the_device_active(
    db_session, candidate, monkeypatch
) -> None:
    """A transport error is not evidence the token is invalid."""

    monkeypatch.setattr(push, "_post", lambda m, t: (_ for _ in ()).throw(OSError()))
    with enable_push():
        notification = make_notification(db_session, user_for(db_session, candidate))
        register(db_session, candidate)
        push.deliver(db_session, notification, active_for(db_session, candidate))
    assert len(active_for(db_session, candidate)) == 1


def test_one_invalid_token_does_not_block_the_others(
    db_session, candidate, monkeypatch
) -> None:
    """A bad address must not starve the good one."""

    sent: list[dict[str, Any]] = []

    def fake_post(message, token):
        sent.append(message)
        return (False, True) if message["to"] == TOKEN else (True, False)

    monkeypatch.setattr(push, "_post", fake_post)
    with enable_push():
        notification = make_notification(db_session, user_for(db_session, candidate))
        register(db_session, candidate, token=TOKEN)
        register(db_session, candidate, token=OTHER_TOKEN)
        delivered = push.deliver(
            db_session, notification, active_for(db_session, candidate)
        )
    assert delivered == 1
    assert len(sent) == 2


def test_invalid_token_is_deactivated_not_deleted(
    db_session, candidate, monkeypatch
) -> None:
    """§13.5: disabled, not destroyed — provider errors are often transient."""

    monkeypatch.setattr(push, "_post", lambda m, t: (False, True))
    with enable_push():
        notification = make_notification(db_session, user_for(db_session, candidate))
        register(db_session, candidate)
        push.deliver(db_session, notification, active_for(db_session, candidate))
    rows = db_session.query(UserDevice).all()
    assert len(rows) == 1
    assert rows[0].is_active is False


def test_deactivated_device_is_excluded_from_the_next_delivery(
    db_session, candidate, monkeypatch
) -> None:
    sent = record_posts(monkeypatch)
    with enable_push():
        notification = make_notification(db_session, user_for(db_session, candidate))
        existing = register(db_session, candidate)
        device_svc.deactivate(
            db_session, db_session.get(UserDevice, uuid.UUID(existing.id))
        )
        push.dispatch(db_session, notification)
    assert sent == []


def test_invalidating_one_device_spares_the_others(
    db_session, candidate, other_candidate, monkeypatch
) -> None:
    """§13.5's "do not delete the user, the notification, or other devices"."""

    monkeypatch.setattr(push, "_post", lambda m, t: (False, True))
    with enable_push():
        register(db_session, candidate, token=TOKEN)
        register(db_session, candidate, token=OTHER_TOKEN)
        register(db_session, other_candidate)
        notification = make_notification(db_session, user_for(db_session, candidate))
        push.deliver(db_session, notification, active_for(db_session, candidate))

    # The other candidate's account and device are untouched.
    assert db_session.get(User, uuid.UUID(other_candidate.id)) is not None
    assert len(active_for(db_session, other_candidate)) == 1
    # And an entirely failed delivery still leaves the notification.
    assert db_session.get(Notification, notification.id) is not None


def test_dispatch_never_raises_into_a_committed_request(
    db_session, candidate, monkeypatch
) -> None:
    monkeypatch.setattr(push, "_post", lambda m, t: (_ for _ in ()).throw(OSError()))
    with enable_push():
        notification = make_notification(db_session, user_for(db_session, candidate))
        register(db_session, candidate)
        assert push.dispatch(db_session, notification) == 0


def test_dispatch_with_no_devices_is_a_no_op(db_session, candidate) -> None:
    notification = make_notification(db_session, user_for(db_session, candidate))
    assert push.dispatch(db_session, notification) == 0


# --- transaction ordering (§13.5) --------------------------------------------


def test_emit_alone_sends_no_push(db_session, candidate, monkeypatch) -> None:
    """``emit`` stages; it neither commits nor notifies the provider."""

    sent = record_posts(monkeypatch)
    with enable_push():
        register(db_session, candidate)
        stage_message(db_session, user_for(db_session, candidate))
    assert sent == []


def test_rollback_sends_no_push(db_session, candidate, monkeypatch) -> None:
    """The ordering rule stated as a test: a rollback leaves nothing sent."""

    sent = record_posts(monkeypatch)
    with enable_push():
        register(db_session, candidate)
        notification = stage_message(db_session, user_for(db_session, candidate))
        db_session.rollback()

    assert sent == []
    rows = db_session.scalars(
        select(Notification).where(Notification.id == notification.id)
    ).all()
    assert rows == []


def test_push_happens_only_after_a_commit(db_session, candidate, monkeypatch) -> None:
    sent = record_posts(monkeypatch)
    with enable_push():
        register(db_session, candidate)
        notification = stage_message(db_session, user_for(db_session, candidate))
        assert sent == []

        db_session.commit()
        assert push.dispatch(db_session, notification) == 1
    assert len(sent) == 1
    assert sent[0]["data"]["notification_id"] == str(notification.id)


def test_push_carries_no_message_text_end_to_end(
    db_session, candidate, monkeypatch
) -> None:
    """The privacy rule at the boundary — what would actually be transmitted."""

    sent = record_posts(monkeypatch)
    with enable_push():
        register(db_session, candidate)
        notification = stage_message(db_session, user_for(db_session, candidate))
        db_session.commit()
        push.dispatch(db_session, notification)
    assert "text that must never be pushed" not in json.dumps(sent[0])


# --- provider configuration (§13.5) ------------------------------------------


def test_the_credential_is_optional_and_defaults_to_empty() -> None:
    from app.core.config import Settings

    assert Settings().expo_access_token == ""


def test_the_endpoint_is_expos_documented_one() -> None:
    assert push.PUSH_ENDPOINT == "https://exp.host/--/api/v2/push/send"


def code_without_prose(path) -> str:
    """The module's code with comments and docstrings removed.

    Lets a module keep *explaining* why an approach was rejected without a
    "this must not appear" test reading its own prose as an import.
    """

    import io
    import tokenize

    source = Path(path).read_text(encoding="utf-8")
    return "".join(
        token.string
        for token in tokenize.generate_tokens(io.StringIO(source).readline)
        if token.type not in (tokenize.COMMENT, tokenize.STRING)
    ).lower()


def test_no_queue_or_fcm_infrastructure_was_added() -> None:
    """§13.5 forbade a job queue and direct FCM; assert the absence stays true."""

    code = code_without_prose(push.__file__)
    for forbidden in (
        "celery",
        "kafka",
        "rabbit",
        "firebase",
        "fcm",
        "google-services",
    ):
        assert forbidden not in code


def test_no_provider_token_is_committed_in_production_code() -> None:
    """No real ``ExponentPushToken[...]`` literal anywhere under ``app/``."""

    app_dir = Path(push.__file__).resolve().parents[1]
    offenders = [
        str(path)
        for path in app_dir.rglob("*")
        if path.is_file()
        and path.suffix in {".py", ".json", ".yaml", ".yml", ".env"}
        and "ExponentPushToken[" in path.read_text(encoding="utf-8", errors="ignore")
    ]
    assert offenders == []


def test_the_credential_is_never_logged() -> None:
    """``deliver`` reports a class name, never a value."""

    for line in Path(push.__file__).read_text(encoding="utf-8").splitlines():
        if "logger." in line:
            assert "access_token" not in line
            assert "push_token" not in line


def test_persistence_and_delivery_are_separate_modules() -> None:
    """``services/devices.py`` must not import a provider."""

    device_code = code_without_prose(device_svc.__file__)
    assert "urllib" not in device_code
    assert "exp.host" not in device_code


def test_push_module_cannot_create_a_notification() -> None:
    """Delivery is structurally incapable of writing a row."""

    code = code_without_prose(push.__file__)
    assert "Notification(" not in code
    assert ".add(" not in code
