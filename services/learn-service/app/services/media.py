"""Media service layer for the Learn microservice.

V1 stores uploaded bytes on the shared ``media_assets`` row and returns the
metadata record. Later stages move bytes to S3/R2 object storage.
"""

from __future__ import annotations

import asyncio
from app.core.config import get_settings
from app.services.storage import get_storage_provider, StorageProvider
from app.models import MediaAsset
from app.schemas.media import MediaRead


def serve(db, current_user, kind: str, payload: bytes) -> MediaRead:
    """``POST /media`` — store one raw-body upload and return its metadata."""
    storage: StorageProvider = get_storage_provider()
    result = asyncio.run(storage.upload_object(
        bucket="",  # bucket not used in local mode
        key=f"media/{current_user.id}",
        body=payload,
        content_type=kind,
    ))
    media = MediaAsset(
        owner_id=current_user.id,
        kind=kind,
        mime_type="application/octet-stream",
        size_bytes=len(payload),
        storage_kind="s3" if get_settings().video_storage_kind == "s3" else "local",
        storage_key=f"media/{current_user.id}",
        served_at="",
        data=None,  # bytes stored in object storage, not PostgreSQL
    )
    db.add(media)
    db.commit()
    db.refresh(media)
    return MediaRead(
        id=media.id,
        owner_id=media.owner_id,
        kind=media.kind.value if hasattr(media.kind, "value") else str(media.kind),
        mime_type=media.mime_type,
        size_bytes=media.size_bytes,
        width=media.width,
        height=media.height,
        duration_ms=media.duration_ms,
        storage_kind=media.storage_kind,
        storage_key=media.storage_key,
        served_at=media.served_at,
        data=None,
    )
