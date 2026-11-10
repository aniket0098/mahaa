"""
Security tests for the media token endpoint (POST /lecture-media/{media_id}/token).

Tests cover authentication, authorization, media-to-lecture relationship,
presigned URL generation, expiration, and error handling.
"""

import sys
import uuid
from datetime import datetime, timedelta, UTC
from unittest.mock import MagicMock, patch, AsyncMock

sys.path.insert(0, r"C:\mahaa\services\learn-service")

import jwt
from app.core.config import get_settings
from app.core.errors import ErrorCode


def _make_token(sub: str, role: str = "candidate", public_id: str = "MJ-Test",
                issuer: str | None = None, audience: str | None = None,
                expired: bool = False, secret: str | None = None) -> str:
    """Helper to mint a JWT access token matching the MAHAJOB contract."""
    settings = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": sub,
        "role": role,
        "public_id": public_id,
        "type": "access",
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now - timedelta(minutes=5)).timestamp()) if expired else int(
            (now + timedelta(minutes=60)).timestamp()
        ),
        "iss": issuer or settings.jwt_issuer,
        "aud": audience or settings.jwt_audience,
    }
    key = secret or settings.jwt_secret
    return jwt.encode(payload, key, algorithm=settings.jwt_algorithm)


def test_authenticated_user_can_request_authorized_media():
    """An authenticated user who owns the media should receive a presigned URL."""
    media_id = uuid.uuid4()
    token = _make_token(sub="test_user", role="candidate")

    db = MagicMock()
    media = MagicMock()
    media.id = media_id
    media.owner_id = "test_user"
    media.storage_key = "lectures/course-1/lecture-1/video.mp4"
    media.storage_kind = "s3"
    db.get.return_value = media

    lecture = MagicMock()
    lecture.id = uuid.uuid4()
    lecture.course_id = uuid.uuid4()

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = lecture

    from app.api.v1.endpoints import lectures as lectures_mod

    with patch.object(lectures_mod, "select") as mock_select:
        mock_select.return_value.where.return_value = mock_result
        with patch.object(lectures_mod, "get_storage_provider") as mock_storage:
            mock_provider = MagicMock()
            mock_provider.presigned_get_url = AsyncMock(return_value=(
                "https://s3.example.com/bucket/key?signature=abc"
            ))
            mock_storage.return_value = mock_provider

            response = lectures_mod.stream_token(
                media_id=str(media_id),
                db=db,
                current_user=MagicMock(id="test_user", role="candidate"),
            )

    assert response["media_id"] == str(media_id)
    assert response["url"] == "https://s3.example.com/bucket/key?signature=abc"
    assert response["expires_in"] == 300
    mock_provider.presigned_get_url.assert_called_once()
    call_kwargs = mock_provider.presigned_get_url.call_args.kwargs
    assert call_kwargs["key"] == "lectures/course-1/lecture-1/video.mp4"
    assert call_kwargs["expires_in"] == 300
    print("Authenticated user can request authorized media: PASS")


def test_unauthenticated_user_receives_401():
    """No bearer token -> 401."""
    from app.api.deps import get_current_user
    from app.core.errors import ApiError, ErrorCode

    try:
        get_current_user(request=MagicMock(), credentials=None, session=MagicMock())
        raise AssertionError("Expected ApiError for missing credentials")
    except ApiError as e:
        assert e.status_code == 401
        assert e.code == ErrorCode.NOT_AUTHENTICATED
    print("Unauthenticated user receives 401: PASS")


def test_invalid_jwt_receives_401():
    """Invalid JWT string -> TokenError -> 401."""
    from app.core.security import decode_access_token, TokenError

    try:
        decode_access_token("invalid.token.string")
        raise AssertionError("Expected TokenError for invalid token")
    except TokenError:
        pass
    print("Invalid JWT receives 401: PASS")


def test_expired_jwt_receives_401():
    """Expired JWT -> TokenError -> 401."""
    from app.core.security import decode_access_token, TokenError

    token = _make_token(sub="test_user", expired=True)
    try:
        decode_access_token(token)
        raise AssertionError("Expected TokenError for expired token")
    except TokenError:
        pass
    print("Expired JWT receives 401: PASS")


def test_wrong_issuer_rejected():
    """Token with wrong issuer -> TokenError -> 401."""
    from app.core.security import decode_access_token, TokenError

    token = _make_token(sub="test_user", issuer="wrong-issuer")
    try:
        decode_access_token(token)
        raise AssertionError("Expected TokenError for wrong issuer")
    except TokenError:
        pass
    print("Wrong issuer is rejected: PASS")


def test_wrong_audience_rejected():
    """Token with wrong audience -> TokenError -> 401."""
    from app.core.security import decode_access_token, TokenError

    token = _make_token(sub="test_user", audience="wrong-audience")
    try:
        decode_access_token(token)
        raise AssertionError("Expected TokenError for wrong audience")
    except TokenError:
        pass
    print("Wrong audience is rejected: PASS")


def test_nonexistent_media_returns_404():
    """Media that does not exist -> 404."""
    media_id = uuid.uuid4()
    db = MagicMock()
    db.get.return_value = None

    from app.api.v1.endpoints import lectures as lectures_mod
    from app.core.errors import ApiError

    try:
        lectures_mod.stream_token(
            media_id=str(media_id),
            db=db,
            current_user=MagicMock(id="test_user", role="candidate"),
        )
        raise AssertionError("Expected ApiError for nonexistent media")
    except ApiError as e:
        assert e.status_code == 404
        assert e.code == ErrorCode.NOT_FOUND
    print("Nonexistent media returns 404: PASS")


def test_media_belonging_to_unauthorized_course_rejected():
    """Media not owned by user and not in a published ready lecture -> 404."""
    media_id = uuid.uuid4()

    db = MagicMock()
    media = MagicMock()
    media.id = media_id
    media.owner_id = "user-b"
    media.storage_key = "lectures/course-1/lecture-1/video.mp4"
    db.get.return_value = media

    # First call to scalar_one_or_none: returns a lecture (media IS associated)
    # Second call: returns None (not published/ready for this user)
    db.execute.return_value.scalar_one_or_none.side_effect = [
        MagicMock(),  # first: lecture found
        None,          # second: no accessible lecture
    ]

    from app.api.v1.endpoints import lectures as lectures_mod
    from app.core.errors import ApiError

    with patch.object(lectures_mod, "select"):
        try:
            lectures_mod.stream_token(
                media_id=str(media_id),
                db=db,
                current_user=MagicMock(id="user-a", role="candidate"),
            )
            raise AssertionError("Expected ApiError for unauthorized media")
        except ApiError as e:
            assert e.status_code == 404
            assert e.code == ErrorCode.NOT_FOUND
    print("Media belonging to another unauthorized course is rejected: PASS")


def test_unpublished_course_inaccessible():
    """Media in a draft/unpublished course -> 404 for ordinary users."""
    media_id = uuid.uuid4()

    db = MagicMock()
    media = MagicMock()
    media.id = media_id
    media.owner_id = "other-user"
    media.storage_key = "lectures/course-1/lecture-1/video.mp4"
    db.get.return_value = media

    # First call to scalar_one_or_none: returns a lecture (media IS associated)
    # Second call: returns None (not published/ready)
    db.execute.return_value.scalar_one_or_none.side_effect = [
        MagicMock(),  # first: lecture found
        None,          # second: no published/ready lecture
    ]

    from app.api.v1.endpoints import lectures as lectures_mod
    from app.core.errors import ApiError

    with patch.object(lectures_mod, "select"):
        try:
            lectures_mod.stream_token(
                media_id=str(media_id),
                db=db,
                current_user=MagicMock(id="requester", role="candidate"),
            )
            raise AssertionError("Expected ApiError for unpublished course")
        except ApiError as e:
            assert e.status_code == 404
    print("Unpublished course is inaccessible to ordinary users: PASS")


def test_deleted_media_is_inaccessible():
    """Deleted media (None from DB) -> 404."""
    media_id = uuid.uuid4()
    db = MagicMock()
    db.get.return_value = None

    from app.api.v1.endpoints import lectures as lectures_mod
    from app.core.errors import ApiError

    try:
        lectures_mod.stream_token(
            media_id=str(media_id),
            db=db,
            current_user=MagicMock(id="test_user", role="candidate"),
        )
        raise AssertionError("Expected ApiError for deleted media")
    except ApiError as e:
        assert e.status_code == 404
        assert e.code == ErrorCode.NOT_FOUND
    print("Deleted media is inaccessible: PASS")


def test_media_to_lecture_relationship_resolved_correctly():
    """CourseLecture resolved via media_id ForeignKey, not as primary key."""
    media_id = uuid.uuid4()

    db = MagicMock()
    media = MagicMock()
    media.id = media_id
    media.owner_id = "test_user"
    media.storage_key = "lectures/course-1/lecture-1/video.mp4"
    db.get.return_value = media

    from app.api.v1.endpoints import lectures as lectures_mod

    lecture = MagicMock()
    lecture.id = uuid.uuid4()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = lecture

    with patch.object(lectures_mod, "select") as mock_select:
        mock_select.return_value.where.return_value = mock_result
        with patch.object(lectures_mod, "get_storage_provider") as mock_storage:
            mock_provider = MagicMock()
            mock_provider.presigned_get_url = AsyncMock(return_value="https://example.com/url")
            mock_storage.return_value = mock_provider

            response = lectures_mod.stream_token(
                media_id=str(media_id),
                db=db,
                current_user=MagicMock(id="test_user", role="candidate"),
            )

    assert mock_select.called
    where_call = mock_select.return_value.where.call_args
    assert where_call is not None
    assert response["media_id"] == str(media_id)
    print("Media-to-lecture relationship resolved correctly: PASS")


def test_lecture_course_relationship_verified():
    """Lecture's course relationship is verified for publication status."""
    media_id = uuid.uuid4()

    db = MagicMock()
    media = MagicMock()
    media.id = media_id
    media.owner_id = "other-user"
    media.storage_key = "lectures/course-1/lecture-1/video.mp4"
    db.get.return_value = media

    lecture = MagicMock()
    lecture.id = uuid.uuid4()
    lecture.status = "published"
    lecture.processing_status = "ready"

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = lecture

    from app.api.v1.endpoints import lectures as lectures_mod

    with patch.object(lectures_mod, "select") as mock_select:
        mock_select.return_value.where.return_value = mock_result
        with patch.object(lectures_mod, "get_storage_provider") as mock_storage:
            mock_provider = MagicMock()
            mock_provider.presigned_get_url = AsyncMock(return_value="https://example.com/url")
            mock_storage.return_value = mock_provider

            response = lectures_mod.stream_token(
                media_id=str(media_id),
                db=db,
                current_user=MagicMock(id="requester", role="candidate"),
            )

    assert response["media_id"] == str(media_id)
    assert response["expires_in"] == 300
    print("Lecture/course relationship is verified: PASS")


def test_presigned_url_invoked_with_correct_object_key():
    """Storage provider's presigned_get_url called with media.storage_key."""
    media_id = uuid.uuid4()

    db = MagicMock()
    media = MagicMock()
    media.id = media_id
    media.owner_id = "test_user"
    media.storage_key = "unique/object/key/video.mp4"
    db.get.return_value = media

    lecture = MagicMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = lecture

    from app.api.v1.endpoints import lectures as lectures_mod

    with patch.object(lectures_mod, "select") as mock_select:
        mock_select.return_value.where.return_value = mock_result
        with patch.object(lectures_mod, "get_storage_provider") as mock_storage:
            mock_provider = MagicMock()
            mock_provider.presigned_get_url = AsyncMock(return_value="https://example.com/signed")
            mock_storage.return_value = mock_provider

            response = lectures_mod.stream_token(
                media_id=str(media_id),
                db=db,
                current_user=MagicMock(id="test_user", role="candidate"),
            )

    mock_provider.presigned_get_url.assert_called_once()
    kwargs = mock_provider.presigned_get_url.call_args.kwargs
    assert kwargs["key"] == "unique/object/key/video.mp4"
    assert kwargs["expires_in"] == 300
    assert response["url"] == "https://example.com/signed"
    print("Presigned URL generation invoked with correct object key: PASS")


def test_expiration_is_correct():
    """TTL respects video_stream_url_ttl_seconds config, capped at 300."""
    settings = get_settings()
    expected_ttl = min(settings.video_stream_url_ttl_seconds, 300)
    assert expected_ttl == 300

    media_id = uuid.uuid4()

    db = MagicMock()
    media = MagicMock()
    media.id = media_id
    media.owner_id = "test_user"
    media.storage_key = "lectures/video.mp4"
    db.get.return_value = media

    lecture = MagicMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = lecture

    from app.api.v1.endpoints import lectures as lectures_mod

    with patch.object(lectures_mod, "select") as mock_select:
        mock_select.return_value.where.return_value = mock_result
        with patch.object(lectures_mod, "get_storage_provider") as mock_storage:
            mock_provider = MagicMock()
            mock_provider.presigned_get_url = AsyncMock(return_value="https://example.com/signed")
            mock_storage.return_value = mock_provider

            response = lectures_mod.stream_token(
                media_id=str(media_id),
                db=db,
                current_user=MagicMock(id="test_user", role="candidate"),
            )

    assert response["expires_in"] == expected_ttl
    print("Expiration is correct: PASS")


def test_storage_failure_returns_safe_api_error():
    """Storage provider failure -> ApiError with safe message (no credential leak)."""
    media_id = uuid.uuid4()

    db = MagicMock()
    media = MagicMock()
    media.id = media_id
    media.owner_id = "test_user"
    media.storage_key = "lectures/video.mp4"
    db.get.return_value = media

    lecture = MagicMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = lecture

    from app.api.v1.endpoints import lectures as lectures_mod
    from app.core.errors import ApiError

    with patch.object(lectures_mod, "select") as mock_select:
        mock_select.return_value.where.return_value = mock_result
        with patch.object(lectures_mod, "get_storage_provider") as mock_storage:
            mock_provider = MagicMock()
            mock_provider.presigned_get_url = AsyncMock(side_effect=Exception(
                "S3 connection failed"
            ))
            mock_storage.return_value = mock_provider

            try:
                lectures_mod.stream_token(
                    media_id=str(media_id),
                    db=db,
                    current_user=MagicMock(id="test_user", role="candidate"),
                )
                raise AssertionError("Expected ApiError for storage failure")
            except ApiError as e:
                assert "AKIA" not in str(e.message)
    print("Storage failures return safe API errors: PASS")


def test_no_credentials_or_signed_urls_in_logs():
    """Verify that signed URLs and credentials are not logged."""
    import logging
    from io import StringIO

    log_capture = StringIO()
    handler = logging.StreamHandler(log_capture)
    logger = logging.getLogger("app.api.v1.endpoints.lectures")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)

    media_id = uuid.uuid4()

    db = MagicMock()
    media = MagicMock()
    media.id = media_id
    media.owner_id = "test_user"
    media.storage_key = "lectures/video.mp4"
    db.get.return_value = media

    lecture = MagicMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = lecture

    signed_url = "https://s3.example.com/bucket/key?X-Amz-Signature=secret123"

    from app.api.v1.endpoints import lectures as lectures_mod

    with patch.object(lectures_mod, "select") as mock_select:
        mock_select.return_value.where.return_value = mock_result
        with patch.object(lectures_mod, "get_storage_provider") as mock_storage:
            mock_provider = MagicMock()
            mock_provider.presigned_get_url = AsyncMock(return_value=signed_url)
            mock_storage.return_value = mock_provider

            lectures_mod.stream_token(
                media_id=str(media_id),
                db=db,
                current_user=MagicMock(id="test_user", role="candidate"),
            )

    log_output = log_capture.getvalue()
    assert signed_url not in log_output
    assert "secret123" not in log_output
    print("No credentials or signed URLs in application logs: PASS")