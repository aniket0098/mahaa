"""Create a disposable, empty test database and run `alembic upgrade head` on it.

The suite's fixtures never create or drop schema, and several tests assume a feed
with no posts in it (`assert feed(...)["total"] == 0`). The development database
on this machine holds real seeded accounts and posts, so those assertions collide
with that data and fail for a reason that has nothing to do with the code under
test.

**This builds a separate database rather than cleaning the existing one.** The
brief forbids deleting user or test data to force a green run, and so does common
sense: the development data belongs to whoever is using the machine. `CREATE
DATABASE` is additive, and dropping it afterwards removes only what this script
created.

    python tools/make_test_db.py            # create + migrate
    python tools/make_test_db.py --drop     # drop it again

The name defaults to `mahaa_test` and can be overridden with `TEST_DB_NAME`. The
DSN is built from the same ``DATABASE_URL`` as everything else, with only the
database name replaced, so credentials are never written down here.
"""

from __future__ import annotations

import os
import sys

import psycopg
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

DEFAULT_NAME = "mahaa_test"


def dsn_parts() -> tuple[str, str]:
    """The ``user:password@host:port`` part of ``DATABASE_URL``, and its host.

    **The driver suffix is stripped and empty userinfo is preserved.** The URL is
    written for SQLAlchemy as ``postgresql+psycopg://...``; only what follows
    ``://`` is an authority, so the scheme is discarded rather than parsed. And
    this project's URL carries no credentials at all (``@localhost``), which is a
    legitimate form — dropping the empty ``@`` would make the host look like a
    role name and fail authentication with a confusing message.
    """
    load_dotenv()
    url = os.environ.get("DATABASE_URL", "")
    if "://" not in url or "/" not in url.split("://", 1)[1]:
        raise SystemExit("DATABASE_URL is missing or not in the expected form.")

    _scheme, rest = url.split("://", 1)
    # Only the FIRST `@` separates userinfo from the host; a password may contain
    # one, so splitting from the right would corrupt it.
    userinfo, _, hostport = rest.rpartition("@")
    hostport = hostport.split("/", 1)[0]

    authority = f"{userinfo}@{hostport}" if userinfo else hostport
    host = hostport.partition(":")[0]
    return authority, host


def drop(name: str, admin: str) -> None:
    """Drop the database if it exists.

    ``AUTOCOMMIT`` is required: a ``CREATE``/``DROP DATABASE`` cannot run inside a
    transaction block, and psycopg opens one implicitly by default.
    """
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = %s AND pid <> pg_backend_pid()",
            (name,),
        )
        conn.execute(f'DROP DATABASE IF EXISTS "{name}"')


def create(name: str, admin: str) -> None:
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{name}"')


def migrate(dsn: str) -> None:
    """Bring the new database to `head`.

    Run through Alembic's own API rather than shelling out, so the revision is
    whatever the checked-out code says it is and not a hard-coded copy.

    **The probe connection is closed before Alembic runs.** `create_engine` pools
    lazily, so a bare `create_engine` opens nothing — but the `with` block here
    used to keep a connection checked out for the rest of the process, and a
    freshly created database that still has a client attached makes some
    `CREATE`/`DROP` operations fail. Explicitly disposing removes the doubt.
    """
    from alembic.config import Config

    from alembic import command

    engine = create_engine(dsn, poolclass=NullPool)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    finally:
        engine.dispose()

    config = Config("alembic.ini")
    # `%` is the interpolation character in an alembic.ini URL, so any literal one
    # has to be escaped or the config parser rejects the value.
    config.set_main_option("sqlalchemy.url", dsn.replace("%", "%%"))
    command.upgrade(config, "head")


def main(argv: list[str]) -> int:
    authority, _host = dsn_parts()
    name = os.environ.get("TEST_DB_NAME", DEFAULT_NAME)
    admin = f"postgresql://{authority}/postgres"
    target = f"postgresql://{authority}/{name}"

    if "--drop" in argv:
        drop(name, admin)
        print(f"dropped {name}")
        return 0

    drop(name, admin)
    create(name, admin)
    # Alembic reads a SQLAlchemy URL, so the driver suffix goes back on here.
    migrate(f"postgresql+psycopg://{authority}/{name}")

    print(f"TEST_DATABASE_URL={target}")
    print(f"ready: {name} created and migrated to head")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
