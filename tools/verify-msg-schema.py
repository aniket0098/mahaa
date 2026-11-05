"""Disposable verification helper — read-only schema inspection of mahaa_test.

Not part of the suite. Connects only to the local disposable test database
(localhost, no password in this file) and prints schema facts. Never writes.
"""

import sqlalchemy as sa

DSN = "postgresql+psycopg://postgres@127.0.0.1:5432/mahaa_test"

engine = sa.create_engine(DSN)
with engine.connect() as conn:
    print("== columns ==")
    for row in conn.execute(
        sa.text(
            "SELECT column_name, data_type, is_nullable, "
            "coalesce(column_default, '-') FROM information_schema.columns "
            "WHERE table_name='message_requests' ORDER BY ordinal_position"
        )
    ):
        print(" | ".join(str(v) for v in row))
    print("== constraints ==")
    for row in conn.execute(
        sa.text(
            "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conrelid='message_requests'::regclass ORDER BY conname"
        )
    ):
        print(" | ".join(str(v) for v in row))
    print("== indexes ==")
    for row in conn.execute(
        sa.text(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE tablename='message_requests' ORDER BY indexname"
        )
    ):
        print(" | ".join(str(v) for v in row))
    print("== version tables ==")
    for row in conn.execute(
        sa.text(
            "SELECT 'main', version_num FROM alembic_version "
            "UNION ALL SELECT 'msg', version_num "
            "FROM alembic_version_message_service"
        )
    ):
        print(" | ".join(str(v) for v in row))
    print("== FK targets of message_requests ==")
    for row in conn.execute(
        sa.text(
            "SELECT conname, confrelid::regclass::text FROM pg_constraint "
            "WHERE conrelid='message_requests'::regclass AND contype='f'"
        )
    ):
        print(" | ".join(str(v) for v in row))
