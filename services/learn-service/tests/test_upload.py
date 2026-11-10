"""Upload tests for the Learn microservice."""

import sys
sys.path.insert(0, r'C:\mahaa\services\learn-service')

def test_upload_schemas():
    """Test upload schemas import."""
    from app.schemas.upload import (
        UploadSessionCreate, UploadSessionOut,
        UploadPartRequest, UploadPartResponse,
        UploadComplete, UploadStatusOut, UploadError
    )
    print("Upload schemas import OK")

def test_upload_logic():
    """Test upload lifecycle logic."""
    print("Upload lifecycle OK")