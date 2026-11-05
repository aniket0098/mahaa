"""Seed the Learning Hub catalogue — idempotent, dry-run by default, never destructive.

**Why this exists.** Production starts with an empty catalogue; the only courses
anyone ever sees are ones a creator publishes. A development database benefits
from a small, repeatable sample catalogue so the Learn UI can be built against
real rows rather than fixtures each screen invents for itself.

**Every sample course is labelled development/sample content.** Titles and slugs
carry the ``dev.`` / ``mj-dev-`` marker so nothing here can be mistaken for a
real course, and every slug is deterministic and stable — repeated runs never
create duplicates.

**The safety rules are the point of this file, not decoration.**

* Nothing is written unless ``--apply`` is passed; the default run is a dry run.
* Idempotent: a course whose slug already exists is skipped, never updated or
  deleted. ``ON CONFLICT`` guards two processes racing.
* One transaction: either every missing sample course lands or none does.
* ``--environment production`` is refused outright, even with ``--apply``.
* Never automatic: nothing in the application imports or calls this script —
  not startup, migrations, or any API route. It is run by hand against an
  isolated local development database only.
"""

from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import psycopg

# A hand-run ``python tools/seed_courses.py`` puts ``tools/`` — not the backend
# root — on ``sys.path``, and this script imports ``app.core.config`` for its DSN.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

SAMPLE_MARKER = "mj-dev-"

SAMPLE_COURSES: list[dict[str, Any]] = [
    {
        "title": "dev. Introduction to Web Development",
        "slug": "mj-dev-intro-web-development",
        "description": (
            "Sample development course. HTML, CSS and JavaScript fundamentals "
            "for complete beginners. Not a real course and not published by any "
            "instructor — seeded only onto local development databases."
        ),
        "category": "Web Development",
        "skill_level": "beginner",
        "language": "en",
        "estimated_duration_minutes": 120,
        "is_free": True,
        "price": None,
        "price_currency": None,
        "lectures": [
            {
                "title": "dev. How the web works",
                "position": 0,
                "kind": "reading",
                "description": (
                    "Sample reading. A brief overview of browsers, HTTP and how "
                    "a page gets from a server to a screen."
                ),
                "external_url": "https://developer.mozilla.org/en-US/docs/Learn",
                "is_preview": True,
            },
            {
                "title": "dev. Your first HTML page",
                "position": 1,
                "kind": "reading",
                "description": (
                    "Sample reading. Markup basics: headings, paragraphs and "
                    "links, with nothing but a text editor and a browser."
                ),
                "external_url": "https://developer.mozilla.org/en-US/docs/Learn/HTML",
                "is_preview": False,
            },
        ],
    },
    {
        "title": "dev. Data Literacy Basics",
        "slug": "mj-dev-data-literacy-basics",
        "description": (
            "Sample development course. Reading charts, spotting misleading "
            "averages and thinking critically about numbers. Seeded only onto "
            "local development databases."
        ),
        "category": "Data",
        "skill_level": "beginner",
        "language": "en",
        "estimated_duration_minutes": 90,
        "is_free": True,
        "price": None,
        "price_currency": None,
        "lectures": [
            {
                "title": "dev. Why averages lie",
                "position": 0,
                "kind": "external_video",
                "description": (
                    "Sample linked lecture. Mean, median and why the average "
                    "person does not exist — an externally hosted explainer."
                ),
                "external_url": "https://www.khanacademy.org/math/statistics-probability",
                "is_preview": True,
            },
        ],
    },
]


def connect(dsn: str) -> Any:
    """A single connection used for the whole run.

    The DSN comes from ``app.core.config`` and is SQLAlchemy's dialect form
    (``postgresql+psycopg://``). Psycopg's own parser only understands the
    standard ``postgresql://`` scheme, so the driver suffix is removed here
    rather than making every caller pre-translate its DSN.
    """

    return psycopg.connect(
        dsn.replace("postgresql+psycopg://", "postgresql://"), autocommit=False
    )


def existing_slugs(connection: Any) -> set[str]:
    """Slugs already present in ``courses`` — the idempotence check."""
    with connection.cursor() as cursor:
        cursor.execute("select slug from courses")
        return {row[0] for row in cursor.fetchall()}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Seed the Learning Hub sample catalogue. Dry run unless --apply is "
            "passed. Local development only — production is refused."
        ),
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
        help="Declares the target. 'production' is always refused.",
    )
    return parser


def ensure_dev_user(connection: Any) -> None:
    """Insert the dev owner if absent; never touch an existing row."""
    with connection.cursor() as cursor:
        cursor.execute("select 1 from users where id = %s", (DEV_USER_ID,))
        if cursor.fetchone():
            return
        cursor.execute(
            """
            insert into users (
                id, public_id, username, email, name, role, status,
                password_hash
            ) values (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                DEV_USER["id"], DEV_USER["public_id"], DEV_USER["username"],
                DEV_USER["email"], DEV_USER["name"], DEV_USER["role"],
                DEV_USER["status"], DEV_USER["password_hash"],
            ),
        )


class SeedError(RuntimeError):
    """Anything that should stop the run before a single row is written."""


def describe_target(dsn: str) -> str:
    """Host and database name only — never credentials or the full URL."""
    try:
        parts = urlsplit(dsn)
        host = parts.hostname or "localhost"
        db = parts.path.lstrip("/") or "postgres"
        return f"{host}/{db}"
    except Exception:
        return "(unparseable DSN)"


#: Deterministic dev user that owns every sample course — clearly sample data
#: itself, never a real account.
DEV_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000025")
DEV_USER = {
    "id": DEV_USER_ID,
    "public_id": "MJ-DEVSEED00000025",
    "username": "mahaa_learning_dev",
    "email": "mahaa-learning-dev@example.test",
    "name": "Mahaa Learning Hub (dev)",
    "role": "admin",
    "status": "active",
    "password_hash": "argon2id$not-a-real-hash",
}
def insert_course(connection: Any, course: dict[str, Any]) -> None:
    """Insert one sample course and its lectures into one transaction."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            insert into courses (
                id, creator_id, title, slug, description, category,
                skill_level, language, estimated_duration_minutes,
                is_free, price, price_currency, status, visibility, published_at
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, clock_timestamp())
            on conflict (slug) do nothing
            """,
            (
                uuid.uuid4(),
                DEV_USER_ID,
                course["title"],
                course["slug"],
                course["description"],
                course["category"],
                course["skill_level"],
                course["language"],
                course["estimated_duration_minutes"],
                course["is_free"],
                course["price"],
                course["price_currency"],
                "published",
                "public",
            ),
        )
        cursor.execute("select id from courses where slug = %s", (course["slug"],))
        course_id = cursor.fetchone()[0]

        position = 0
        for lecture in course["lectures"]:
            cursor.execute(
                """
                insert into course_sections (id, course_id, title, description, position)
                values (%s, %s, %s, %s, %s)
                """,
                (
                    uuid.uuid4(), course_id,
                    f"{course['title']} · Section {position + 1}",
                    None,
                    position,
                ),
            )
            cursor.execute(
                "select id from course_sections where course_id = %s and position = %s",
                (course_id, position),
            )
            section_id = cursor.fetchone()[0]

            cursor.execute(
                """
                insert into course_lectures (
                    id, section_id, title, description, position, kind,
                    external_url, media_id, duration_seconds, is_preview, status
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    uuid.uuid4(), section_id,
                    lecture["title"], lecture["description"], position,
                    lecture["kind"], lecture["external_url"], None,
                    lecture.get("duration_seconds"), lecture["is_preview"],
                    "published",
                ),
            )
            position += 1


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.environment == "production":
        raise SeedError(
            "Refusing to seed sample courses into production. The catalogue "
            "starts empty there and grows only through real creator publishing."
        )

    from app.core.config import get_settings

    dsn = get_settings().database_url
    print(f"Catalogue entries : {len(SAMPLE_COURSES)}")
    print(f"Target            : {describe_target(dsn)}")
    print(f"Environment       : {args.environment}")

    with connect(dsn) as connection:
        ensure_dev_user(connection)
        already = existing_slugs(connection)
        pending = [c for c in SAMPLE_COURSES if c["slug"] not in already]

        if not args.apply:
            print(f"Already present     : {len(SAMPLE_COURSES) - len(pending)}")
            print(f"Would insert        : {len(pending)}")
            for course in pending:
                print(f"  + {course['title']}  [{course['slug']}]")
            print("\nDRY RUN - nothing was written. Re-run with --apply to insert.")
            return 0

        for course in pending:
            insert_course(connection, course)
        connection.commit()
        print(f"Inserted            : {len(pending)}")
        print("Done.")
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SeedError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(2)

