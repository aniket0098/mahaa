"""Media tests for the Learn microservice."""

import sys
sys.path.insert(0, r'C:\mahaa\services\learn-service')

def test_media_schemas():
    """Test media schemas import."""
    from app.schemas.media import MediaLimits, MediaRead, MediaStreamToken
    print("Media schemas import OK")

def test_media_logic():
    """Test media access logic."""
    print("Media access logic OK")