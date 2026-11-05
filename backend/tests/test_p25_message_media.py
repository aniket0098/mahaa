"""Message attachments — a photo or video carried by a message (Phase 25).

**The attachment is a media asset, fetched through the same private route.** A
message does not embed bytes; it points at a ``media_assets`` row by id, and the
client fetches the image or video through ``GET /media/{id}`` with its bearer —
the exact path a post image uses. So the security property under test is the one
that matters: the bytes reach the two people in the thread and **nobody else**.

**Why the A/B/C triangle is load-bearing here.** A suite with one account cannot
tell a working recipient-read from a missing one, because there is nobody else to
read to. So C is present throughout: C must be refused on every attachment byte
read even when C is a member of the platform, which is the whole reason a message
attachment is *not* folded into ``media._is_member_readable`` (the "any member"
rule a post image uses).

**A deleted message reveals neither its text nor its photo.** The tombstone keeps
its slot (§14.6), and once the message is deleted the attachment stops being
fetchable — a soft delete is "gone", not "hidden in this one client".
"""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import register
from tests.test_p5_messaging import _connect, _open, _send
from tests.test_p7_media import (
    PNG,
    mp4_bytes,
    pdf_bytes,
    _fetch,
    _seed_asset,
)


def _send_with_media(api_client, account, conversation_id, media_id, body=None):
    payload = {"media_id": media_id}
    if body is not None:
        payload["body"] = body
    response = api_client.post(
        f"/api/v1/conversations/{conversation_id}/messages",
        json=payload,
        headers=account.headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


# --- fixtures ----------------------------------------------------------------


@pytest.fixture()
def thread(api_client, candidate, other_candidate):
    _connect(api_client, candidate, other_candidate)
    return _open(api_client, candidate, other_candidate)


@pytest.fixture()
def stranger(api_client):
    """User C: a platform member with no relationship to the thread."""

    return register(api_client, f"stranger.{uuid.uuid4().hex[:12]}@example.com")


# --- sending an attachment ---------------------------------------------------


def test_a_photo_can_be_attached_with_a_caption(api_client, thread, candidate):
    asset = _seed_asset(api_client, candidate)

    sent = _send_with_media(
        api_client, candidate, thread["id"], asset["id"], body="look at this"
    )

    assert sent["body"] == "look at this"
    assert sent["media"] is not None
    assert sent["media"]["id"] == asset["id"]
    assert sent["media"]["kind"] == "image"
    # The attachment is served through the same private route, by relative path.
    assert sent["media"]["served_at"] == f"/api/v1/media/{asset['id']}"


def test_a_photo_with_no_caption_is_a_real_message(api_client, thread, candidate):
    """A bare image is not an empty message — body is null, media is present."""

    asset = _seed_asset(api_client, candidate)

    sent = _send_with_media(api_client, candidate, thread["id"], asset["id"])

    assert sent["body"] is None
    assert sent["media"]["id"] == asset["id"]


def test_a_video_can_be_attached(api_client, thread, candidate):
    asset = _seed_asset(
        api_client, candidate, mp4_bytes(), mime="video/mp4", kind="video"
    )

    sent = _send_with_media(api_client, candidate, thread["id"], asset["id"], body="clip")

    assert sent["media"]["kind"] == "video"
    assert sent["media"]["mime_type"] == "video/mp4"


def test_a_text_only_message_has_no_attachment(api_client, thread, candidate):
    sent = _send(api_client, candidate, thread["id"], "just words")
    assert sent["media"] is None


def test_an_empty_message_with_no_attachment_is_still_422(api_client, thread, candidate):
    """Neither body nor media is the blank bubble the schema always refused."""

    response = api_client.post(
        f"/api/v1/conversations/{thread['id']}/messages",
        json={},
        headers=candidate.headers,
    )
    assert response.status_code == 422


# --- attachment authorization (who may attach what) --------------------------


def test_a_strangers_asset_cannot_be_attached(api_client, thread, candidate, stranger):
    """You may only attach your own upload — the rule media.find_owned enforces."""

    theirs = _seed_asset(api_client, stranger)

    response = api_client.post(
        f"/api/v1/conversations/{thread['id']}/messages",
        json={"media_id": theirs["id"]},
        headers=candidate.headers,
    )
    # 422, not 404: "exists but is not yours" is indistinguishable from "not an
    # image/video" and from "no such id" — refused without leaking which ids exist.
    assert response.status_code == 422


def test_a_document_cannot_be_attached(api_client, thread, candidate):
    """A PDF is private and owner-only (§11.5); it is never a message attachment."""

    document = _seed_asset(
        api_client, candidate, pdf_bytes(), mime="application/pdf", kind="document"
    )

    response = api_client.post(
        f"/api/v1/conversations/{thread['id']}/messages",
        json={"media_id": document["id"]},
        headers=candidate.headers,
    )
    assert response.status_code == 422


def test_an_unknown_media_id_cannot_be_attached(api_client, thread, candidate):
    response = api_client.post(
        f"/api/v1/conversations/{thread['id']}/messages",
        json={"media_id": str(uuid.uuid4())},
        headers=candidate.headers,
    )
    assert response.status_code == 422


# --- reading the attachment bytes (the security property) --------------------


def test_both_participants_can_fetch_the_attachment_bytes(
    api_client, thread, candidate, other_candidate
):
    asset = _seed_asset(api_client, candidate)
    _send_with_media(api_client, candidate, thread["id"], asset["id"])

    # The sender, and the recipient the message was sent to.
    assert _fetch(api_client, candidate, asset["id"]).status_code == 200
    assert _fetch(api_client, other_candidate, asset["id"]).content == PNG


def test_a_stranger_cannot_fetch_the_attachment_bytes(
    api_client, thread, candidate, stranger
):
    """The whole point: a message photo is NOT any-member-readable like a post image."""

    asset = _seed_asset(api_client, candidate)
    _send_with_media(api_client, candidate, thread["id"], asset["id"])

    # A platform member with no relationship to the thread gets the same 404 a
    # missing asset gives — so the route is not an existence oracle.
    assert _fetch(api_client, stranger, asset["id"]).status_code == 404


def test_a_deleted_messages_attachment_is_no_longer_fetchable(
    api_client, thread, candidate, other_candidate
):
    """Soft delete is "gone": the recipient can no longer pull the bytes."""

    asset = _seed_asset(api_client, candidate)
    sent = _send_with_media(api_client, candidate, thread["id"], asset["id"])

    # Reachable before the delete.
    assert _fetch(api_client, other_candidate, asset["id"]).status_code == 200

    deleted = api_client.delete(
        f"/api/v1/messages/{sent['id']}", headers=candidate.headers
    )
    assert deleted.status_code == 204

    # The message is a tombstone, and the attachment stops being fetchable.
    assert _fetch(api_client, other_candidate, asset["id"]).status_code == 404
    # The tombstone carries neither text nor attachment.
    page = api_client.get(
        f"/api/v1/conversations/{thread['id']}/messages", headers=candidate.headers
    ).json()
    assert page["items"][0]["body"] is None
    assert page["items"][0]["media"] is None


# --- deletion reference guard -------------------------------------------------


def test_an_attached_asset_cannot_be_deleted(api_client, thread, candidate):
    """Deleting the bytes out from under a live message would orphan its image."""

    asset = _seed_asset(api_client, candidate)
    _send_with_media(api_client, candidate, thread["id"], asset["id"])

    response = api_client.delete(f"/api/v1/media/{asset['id']}", headers=candidate.headers)
    assert response.status_code == 409


def test_an_unattached_asset_can_still_be_deleted(api_client, thread, candidate):
    """The guard is reference-scoped, so an unused upload is still reclaimable."""

    asset = _seed_asset(api_client, candidate)

    response = api_client.delete(f"/api/v1/media/{asset['id']}", headers=candidate.headers)
    assert response.status_code == 204

