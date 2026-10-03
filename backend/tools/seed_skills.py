"""Seed the ``skills`` catalogue â€” idempotent, dry-run by default, never destructive.

**Why this exists.** ``skills`` is a catalogue *table* (Â§14.3), not a constant shipped
with the client: ``GET /skills/catalog`` reads it directly. The Phase 1 migration makes
the table and inserts nothing, so a fresh database serves an empty catalogue.
catalogue and the picker has nothing to offer. This script fills it.

**The safety rules are the point of this file, not decoration.**

* **Nothing is written unless ``--apply`` is passed.** The default run is a dry run.
* **Insert-only.** A skill that already exists is counted and skipped; its row is
  never updated and never deleted. ``user_skills.skill_id`` is ``ON DELETE RESTRICT``,
  so deleting a claimed skill is not merely unwanted, it is refused by the database.
* **One transaction.** Either every missing catalogue row lands or none does, so a
  failure halfway through cannot leave a half-seeded catalogue.
* **Idempotent.** A second run inserts 0 rows. That is asserted by the local test, and
  it is what makes the script safe to re-run after adding to the catalogue file.
* **``--environment production`` refuses an example catalogue.** Seeding the demo
  names into production would be a silent, permanent mistake, so it is a hard error.

**No secrets are ever printed.** The DSN is read from the environment and only its host
and database name are reported; the password, the full URL and any query parameters
never reach stdout, a log, or an exception message.

Usage::

    python tools/seed_skills.py --catalog tools/skills_catalog.json --dry-run
    python tools/seed_skills.py --catalog tools/skills_catalog.json --apply

    # production, deliberately and audibly:
    python tools/seed_skills.py --catalog tools/skills_catalog.json \\
        --apply --environment production
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

#: Mirrors ``models.skills.Skill``: ``name`` is String(120) NOT NULL UNIQUE and
#: ``category`` is String(80) NULL. ``category`` carries no CHECK and no enum, so it is
#: free text â€” this script validates length only and invents no vocabulary.
MAX_NAME = 120
MAX_CATEGORY = 80

#: A safety marker the script refuses to seed into production.
EXAMPLE_MARKER = ".example."


class SeedError(RuntimeError):
    """Anything that should stop the run before a single row is written."""


# --------------------------------------------------------------------------- #
# Catalogue file
# --------------------------------------------------------------------------- #


def load_catalogue(path: Path) -> list[tuple[str, str | None]]:
    """Read and validate the catalogue file.

    The expected shape is a JSON array of ``{"name": ..., "category": ...}``. Returns
    ``(name, category)`` pairs de-duplicated case-insensitively, so a file that lists
    "Python" twice cannot turn into two attempts at the same row.
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SeedError(f"Catalogue file not found: {path}") from None
    except json.JSONDecodeError as exc:
        raise SeedError(f"Catalogue file is not valid JSON: {exc}") from None

    if not isinstance(raw, list):
        raise SeedError("Catalogue must be a JSON array of {name, category} objects.")

    seen: dict[str, tuple[str, str | None]] = {}
    for index, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise SeedError(f"Entry {index} is not an object.")
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            raise SeedError(f"Entry {index} has no usable 'name'.")
        name = name.strip()
        if len(name) > MAX_NAME:
            raise SeedError(
                f"Entry {index} name exceeds {MAX_NAME} characters: {name!r}"
            )

        category = entry.get("category")
        if category is not None:
            if not isinstance(category, str):
                raise SeedError(f"Entry {index} 'category' must be a string or null.")
            category = category.strip() or None
            if category and len(category) > MAX_CATEGORY:
                raise SeedError(
                    f"Entry {index} category exceeds {MAX_CATEGORY} characters."
                )
        seen.setdefault(name.casefold(), (name, category))
    return list(seen.values())


# --------------------------------------------------------------------------- #
# Database
# --------------------------------------------------------------------------- #


def database_url() -> str:
    """The DSN from the environment, rewritten to a scheme psycopg accepts.

    The project stores ``postgresql+psycopg://`` because that is the SQLAlchemy
    dialect name. Raw psycopg has no such dialect and rejects it, so the ``+driver``
    suffix is stripped here rather than being handed over and refused.

    ``core.config`` performs the equivalent rewrite, but this script deliberately does
    not import the application settings: importing them would run the production
    fail-closed validators, and a maintenance script should fail for its own reasons.
    """
    raw = os.environ.get("DATABASE_URL", "").strip()
    if not raw:
        raise SeedError("DATABASE_URL is not set.")
    return raw.replace("postgresql+psycopg2://", "postgresql://", 1).replace(
        "postgresql+psycopg://", "postgresql://", 1
    )


def connect(dsn: str) -> Any:
    """Open a connection, reporting any failure **without** echoing the DSN.

    psycopg's own ``ProgrammingError`` and ``OperationalError`` both quote the
    connection string in their message, and that string contains the password. Letting
    one propagate would put a production credential in a terminal, a CI log or a crash
    report, so only the exception class name survives.
    """
    import psycopg

    try:
        return psycopg.connect(dsn)
    except psycopg.Error as exc:
        raise SeedError(
            f"Could not connect to {describe_target(dsn)}: {type(exc).__name__}."
        ) from None


def describe_target(dsn: str) -> str:
    """A safe, printable description of the target â€” never the DSN itself."""
    parsed = urlsplit(dsn.replace("postgresql+psycopg://", "postgresql://", 1))
    database = (parsed.path or "/").lstrip("/") or "?"
    return f"{parsed.hostname or '?'}:{parsed.port or 5432}/{database}"


def missing_skills(
    connection: Any, catalogue: list[tuple[str, str | None]]
) -> list[tuple[str, str | None]]:
    """Catalogue entries with no row yet, matched case-insensitively.

    ``name`` is UNIQUE and is not a ``citext`` column, so the comparison is done in
    Python rather than trusting a database collation to decide what "the same" means.
    """
    with connection.cursor() as cursor:
        cursor.execute("select name from skills")
        existing = {row[0].casefold() for row in cursor.fetchall()}
    return [entry for entry in catalogue if entry[0].casefold() not in existing]


def insert_skills(connection: Any, rows: list[tuple[str, str | None]]) -> None:
    """Insert the missing rows and commit once.

    ``ON CONFLICT DO NOTHING`` is belt and braces: between the existence check above
    and this statement another process could have inserted the same name, and a
    unique violation would otherwise roll back the whole batch.
    """
    with connection.cursor() as cursor:
        for name, category in rows:
            cursor.execute(
                "insert into skills (id, name, category) values (%s, %s, %s)"
                " on conflict (name) do nothing",
                (uuid.uuid4(), name, category),
            )
    connection.commit()


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Seed the skills catalogue. Dry run unless --apply is passed.",
    )
    parser.add_argument(
        "--catalog",
        type=Path,
        required=True,
        help="JSON array of {name, category} objects.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write. Omit for a dry run.",
    )
    parser.add_argument(
        "--environment",
        choices=("local", "production"),
        default="local",
        help="Declares the target. 'production' refuses an example catalogue.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    catalogue = load_catalogue(args.catalog)
    print(f"Catalogue file : {args.catalog}")
    print(f"Entries        : {len(catalogue)}")

    if args.environment == "production" and EXAMPLE_MARKER in args.catalog.name:
        raise SeedError(
            "Refusing to seed an example catalogue into production. Copy it to "
            "skills_catalog.json, replace its contents with the agreed list, and "
            "re-run."
        )

    dsn = database_url()
    print(f"Target         : {describe_target(dsn)}")

    import psycopg  # noqa: F401  (imported here so --help works without the driver)

    with connect(dsn) as connection:
        pending = missing_skills(connection, catalogue)
        existing = len(catalogue) - len(pending)

        if not args.apply:
            print(f"Already present: {existing}")
            print(f"Would insert   : {len(pending)}")
            for name, category in pending:
                print(f"  + {name}" + (f"  [{category}]" if category else ""))
            print("\nDRY RUN - nothing was written. Re-run with --apply to insert.")
            return 0

        insert_skills(connection, pending)
        print(f"Already present: {existing}")
        print(f"Inserted       : {len(pending)}")
        print("Done.")
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SeedError as error:
        # The message never contains a DSN, so this is safe to surface as-is.
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(2)
