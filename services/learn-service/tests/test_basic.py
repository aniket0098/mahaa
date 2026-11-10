"""Learn service startup test."""
import sys
sys.path.insert(0, r'C:\mahaa\services\learn-service')

from app.core.config import get_settings
from app.core.errors import ErrorCode
from app.core.security import create_access_token, decode_access_token
from app.db.session import get_db, ping_database

def test_config():
    s = get_settings()
    assert s.app_name == "Mahaa Learn Service"
    assert s.is_production == (s.app_env == "production")
    print("  PASS: config test")

def test_error_codes():
    assert ErrorCode.NOT_FOUND == "not_found"
    assert ErrorCode.FORBIDDEN == "forbidden"
    print("  PASS: error codes test")

def test_jwt():
    token = create_access_token(user_id='test-uuid', role='candidate', public_id='MJ-Test')
    decoded = decode_access_token(token.token)
    assert decoded['sub'] == 'test-uuid'
    assert decoded['role'] == 'candidate'
    assert decoded['aud'] == 'mahaa-mobile'
    assert decoded['iss'] == 'mahaa-api'
    print("  PASS: JWT test")

# Run tests
test_config()
test_error_codes()
test_jwt()
print("All verification tests passed!")