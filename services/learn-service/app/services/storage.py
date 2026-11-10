"""Storage service layer for the Learn microservice.

Supports S3/R2-compatible object storage with multipart upload support.
Uses aiobotocore for async S3/R2 operations.
"""

from __future__ import annotations

import uuid
from typing import Optional, BinaryIO, Tuple
from datetime import datetime, timedelta

import aiobotocore.session

from app.core.config import get_settings

Settings = get_settings()


class S3Error(Exception):
    """Storage operation failed."""

    pass


class StorageProvider:
    """Abstract S3/R2 storage provider."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    async def _get_client(self):
        """Create an aiobotocore S3 client."""
        session = aiobotocore.session.get_session()
        async with session.create_client(
            "s3",
            region_name=self.settings.s3_region or "us-east-1",
            endpoint_url=self.settings.s3_endpoint,
            aws_access_key_id=self.settings.s3_access_key_id,
            aws_secret_access_key=self.settings.s3_secret_access_key,
        ) as client:
            yield client

    async def upload_object(self, bucket: str, key: str, body: bytes, content_type: str) -> dict:
        """Upload an object to S3/R2."""
        async with self._get_client() as client:
            try:
                await client.put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type)
                return {"etag": str(uuid.uuid4())[:12], "size": len(body)}
            except Exception as e:
                raise S3Error(f"Upload failed: {e}") from e

    async def download_object(self, bucket: str, key: str) -> bytes:
        """Download an object from S3/R2."""
        async with self._get_client() as client:
            try:
                response = await client.get_object(Bucket=bucket, Key=key)
                return response["Body"].read()
            except Exception as e:
                raise S3Error(f"Download failed: {e}") from e

    async def delete_object(self, bucket: str, key: str) -> None:
        """Delete an object from S3/R2."""
        async with self._get_client() as client:
            try:
                await client.delete_object(Bucket=bucket, Key=key)
            except Exception as e:
                raise S3Error(f"Delete failed: {e}") from e

    async def object_exists(self, bucket: str, key: str) -> bool:
        """Check if an object exists in S3/R2."""
        async with self._get_client() as client:
            try:
                await client.head_object(Bucket=bucket, Key=key)
                return True
            except Exception:
                return False

    async def get_object_metadata(self, bucket: str, key: str) -> dict:
        """Get object metadata from S3/R2."""
        async with self._get_client() as client:
            try:
                response = await client.head_object(Bucket=bucket, Key=key)
                return {
                    "etag": response.get("ETag", ""),
                    "content_type": response.get("ContentType", ""),
                    "content_length": response.get("ContentLength"),
                }
            except Exception as e:
                raise S3Error(f"Metadata fetch failed: {e}") from e

    async def presigned_get_url(self, bucket: str, key: str, expires_in: int = 300) -> str:
        """Generate a presigned GET URL for S3/R2 object."""
        async with self._get_client() as client:
            try:
                return await client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": bucket, "Key": key},
                    ExpiresIn=expires_in,
                )
            except Exception as e:
                raise S3Error(f"Presigned GET URL generation failed: {e}") from e

    async def presigned_put_url(self, bucket: str, key: str, expires_in: int = 300) -> str:
        """Generate a presigned PUT URL for S3/R2 object upload."""
        async with self._get_client() as client:
            try:
                return await client.generate_presigned_url(
                    "put_object",
                    Params={"Bucket": bucket, "Key": key},
                    ExpiresIn=expires_in,
                )
            except Exception as e:
                raise S3Error(f"Presigned PUT URL generation failed: {e}") from e

    async def init_multipart_upload(self, bucket: str, key: str) -> dict:
        """Initialize a multipart upload in S3/R2."""
        async with self._get_client() as client:
            try:
                response = await client.create_multipart_upload(Bucket=bucket, Key=key)
                return {"upload_id": response["UploadId"]}
            except Exception as e:
                raise S3Error(f"Multipart upload init failed: {e}") from e

    async def upload_part(self, bucket: str, key: str, upload_id: str, part_number: int, body: bytes) -> dict:
        """Upload a part to a multipart upload in S3/R2."""
        async with self._get_client() as client:
            try:
                await client.upload_part(Bucket=bucket, Key=key, UploadId=upload_id, PartNumber=part_number, Body=body)
                return {"ETag": str(uuid.uuid4())[:12], "PartNumber": part_number, "Size": len(body)}
            except Exception as e:
                raise S3Error(f"Part upload failed: {e}") from e

    async def complete_multipart_upload(self, bucket: str, key: str, upload_id: str, parts: list) -> dict:
        """Complete a multipart upload in S3/R2."""
        async with self._get_client() as client:
            try:
                sorted_parts = sorted(parts, key=lambda p: p["PartNumber"])
                formatted_parts = [{"PartNumber": p["PartNumber"], "ETag": p["ETag"]} for p in sorted_parts]
                response = await client.complete_multipart_upload(
                    Bucket=bucket,
                    Key=key,
                    UploadId=upload_id,
                    MultipartUpload={"Parts": formatted_parts},
                )
                return response
            except Exception as e:
                raise S3Error(f"Multipart upload completion failed: {e}") from e

    async def abort_multipart_upload(self, bucket: str, key: str, upload_id: str) -> None:
        """Abort a multipart upload in S3/R2."""
        async with self._get_client() as client:
            try:
                await client.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)
            except Exception as e:
                raise S3Error(f"Multipart upload abort failed: {e}") from e


def get_storage_provider() -> StorageProvider:
    settings = get_settings()
    if settings.video_storage_kind == "s3":
        return StorageProvider(settings)
    elif settings.video_storage_kind == "local":
        return LocalStorageProvider(settings)
    raise S3Error(f"Unsupported video storage kind: {settings.video_storage_kind}")

class LocalStorageProvider:
    def __init__(self, settings):
        self.settings = settings
        self.base_dir = settings.video_storage_dir or "video_work"

    async def upload_object(self, bucket, key, body, content_type):
        import os
        os.makedirs(self.base_dir, exist_ok=True)
        filepath = os.path.join(self.base_dir, key.lstrip("/"))
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, "wb") as f:
            f.write(body)
        return {"etag": "local", "size": len(body)}

    async def download_object(self, bucket, key):
        import os
        filepath = os.path.join(self.base_dir, key.lstrip("/"))
        with open(filepath, "rb") as f:
            return f.read()

    async def delete_object(self, bucket, key):
        import os
        filepath = os.path.join(self.base_dir, key.lstrip("/"))
        if os.path.exists(filepath):
            os.remove(filepath)

    async def object_exists(self, bucket, key):
        import os
        return os.path.exists(os.path.join(self.base_dir, key.lstrip("/")))

    async def get_object_metadata(self, bucket, key):
        import os
        filepath = os.path.join(self.base_dir, key.lstrip("/"))
        if os.path.exists(filepath):
            s = os.stat(filepath)
            return {"etag": "local", "content_length": s.st_size}
        raise S3Error("File not found")

    async def presigned_get_url(self, bucket, key, expires_in=300):
        return f"/static/video/{key}"

    async def presigned_put_url(self, bucket, key, expires_in=300):
        return f"/upload/video/{key}"

    async def init_multipart_upload(self, bucket, key):
        return {"upload_id": "local-upload-id"}

    async def upload_part(self, bucket, key, upload_id, part_number, body):
        return {"ETag": "local-etag", "PartNumber": part_number, "Size": len(body)}

    async def complete_multipart_upload(self, bucket, key, upload_id, parts):
        return {"Location": f"/video/{key}"}

    async def abort_multipart_upload(self, bucket, key, upload_id):
        pass
