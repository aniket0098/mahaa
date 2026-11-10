import sys
import os

# Add the service directory to the path
service_dir = r'C:\mahaa\services\learn-service'
app_dir = os.path.join(service_dir, 'app')
sys.path.insert(0, service_dir)
sys.path.insert(0, app_dir)

# Test critical imports
try:
    from app.core.config import get_settings
    print("  config: OK")
except Exception as e:
    print(f"  config: FAIL - {e}")

try:
    from app.core.errors import ErrorCode
    print("  errors: OK")
except Exception as e:
    print(f"  errors: FAIL - {e}")

try:
    from app.core.security import create_access_token, decode_access_token
    print("  security: OK")
except Exception as e:
    print(f"  security: FAIL - {e}")

try:
    from app.db.session import get_db, ping_database
    print("  db.session: OK")
except Exception as e:
    print(f"  db.session: FAIL - {e}")

try:
    from app.models.enums import CourseStatus, LectureStatus, MediaKind
    print("  models.enums: OK")
except Exception as e:
    print(f"  models.enums: FAIL - {e}")

try:
    from app.api.deps import get_current_user, CurrentUser, DbSession, require_roles
    print("  api.deps: OK")
except Exception as e:
    print(f"  api.deps: FAIL - {e}")

print()
print("Import verification complete.")