"""Ad-hoc read-only verification of the Phase 1 schema (not part of the suite).

Run with an explicit local DSN:
    set MAHAA_VERIFY_URL=postgresql+psycopg://postgres@localhost:5432/mahaa
    .\\.venv\\Scripts\\python.exe tools\\verify_schema.py
"""

from __future__ import annotations

import os
import sys

from sqlalchemy import create_engine, inspect, text

EXPECTED_TABLES = {
    "achievements",
    "certifications",
    "education",
    "experience",
    "profile_links",
    "profile_preferences",
    "profile_privacy",
    "profiles",
    "project_skills",
    "projects",
    "skills",
    "user_skills",
    "users",
}

url = os.environ.get("MAHAA_VERIFY_URL")
if not url:
    sys.exit("Set MAHAA_VERIFY_URL to the LOCAL database DSN.")

engine = create_engine(url)
insp = inspect(engine)

found = {t for t in insp.get_table_names() if t != "alembic_version"}
print("tables:", len(found), "| expected:", len(EXPECTED_TABLES))
print("missing:", sorted(EXPECTED_TABLES - found) or "none")
print("unexpected:", sorted(found - EXPECTED_TABLES) or "none")

with engine.connect() as connection:
    exts = [
        row[0] for row in connection.execute(text("SELECT extname FROM pg_extension"))
    ]
print("citext present:", "citext" in exts, "|", sorted(exts))

for name in sorted(found):
    pk = insp.get_pk_constraint(name)
    uqs = sorted(c["name"] for c in insp.get_unique_constraints(name))
    cks = sorted(c["name"] for c in insp.get_check_constraints(name))
    ixs = sorted(i["name"] for i in insp.get_indexes(name))
    print(f"\n-- {name}")
    print("   pk :", pk["name"], pk["constrained_columns"])
    if uqs:
        print("   uq :", uqs)
    if cks:
        print("   ck :", cks)
    if ixs:
        print("   ix :", ixs)

print("\n=== email column type (must be citext) ===")
for c in insp.get_columns("users"):
    if c["name"] == "email":
        print("  users.email ->", str(c["type"]))

print("\n=== uuid pk + timestamptz spot check ===")
for t, c_ in (("users", "id"), ("users", "created_at"), ("users", "updated_at")):
    col = next(x for x in insp.get_columns(t) if x["name"] == c_)
    print(f"  {t}.{c_} -> {col['type']} nullable={col['nullable']}")

print("\n=== enum CHECK constraint text ===")
for name in (
    "users",
    "user_skills",
    "education",
    "experience",
    "achievements",
    "profile_privacy",
):
    for c in insp.get_check_constraints(name):
        if c["name"].endswith(
            ("_role", "_status", "_level", "_work_mode", "_category", "_visibility")
        ):
            print(f"  {c['name']}: {c['sqltext']}")
