"""Round-trip check: downgrade to base, then upgrade to head again.

Verifies that the Phase 1 migration is genuinely reversible and that
`alembic check` still reports no drift afterwards. Run against a LOCAL database
only; the script refuses a non-loopback host.

    $env:MAHAA_VERIFY_URL='postgresql+psycopg://postgres@localhost:5432/mahaa'
    .\\.venv\\Scripts\\python.exe tools\\roundtrip.py
"""

from __future__ import annotations

import os
import subprocess
import sys

from sqlalchemy import create_engine, inspect, text

ALLOWED_HOSTS = {"localhost", "127.0.0.1", "::1"}

url = os.environ.get("MAHAA_VERIFY_URL")
if not url:
    sys.exit("Set MAHAA_VERIFY_URL to the LOCAL database DSN.")
host = url.rsplit("@", 1)[-1].split(":", 1)[0].strip("[]").lower()
if host not in ALLOWED_HOSTS:
    sys.exit(f"Refusing to run: {host!r} is not a local host.")


def alembic(*args: str) -> str:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-x", f"db_url={url}", *args],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout[-3000:])
        print(result.stderr[-3000:])
        raise SystemExit(f"alembic {' '.join(args)} failed")
    return result.stdout + result.stderr


def state() -> tuple[list[str], list[str], str]:
    engine = create_engine(url)
    with engine.connect() as conn:
        tables = sorted(
            t for t in inspect(conn).get_table_names() if t != "alembic_version"
        )
        exts = sorted(
            r[0] for r in conn.execute(text("SELECT extname FROM pg_extension"))
        )
        rev = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    engine.dispose()
    return tables, exts, (rev or "EMPTY")


print("== downgrade base ==")
print(alembic("downgrade", "base").strip().splitlines()[-1])
tables, exts, rev = state()
print("tables:", tables or "none")
print("extensions:", exts)
print("alembic_version:", rev)
assert tables == [], f"downgrade left tables behind: {tables}"
assert "citext" not in exts, f"downgrade left the extension behind: {exts}"
assert rev == "EMPTY", f"alembic_version should be empty, got {rev}"

print()
print("== upgrade head ==")
print(alembic("upgrade", "head").strip().splitlines()[-1])
tables, exts, rev = state()
print("tables:", len(tables), tables)
print("extensions:", exts)
print("alembic_version:", rev)
assert len(tables) == 13, f"expected 13 tables, got {len(tables)}"
assert "citext" in exts, "citext was not recreated"
assert rev == "7d162daa433c", f"unexpected head {rev}"

print()
print("== alembic check (no drift after round trip) ==")
out = alembic("check")
line = [ln for ln in out.splitlines() if "No new upgrade operations" in ln]
print(line[0] if line else out.strip().splitlines()[-1])
print()
print("ROUND TRIP OK")
