# Seeding the skills catalogue

`skills` is a catalogue **table** (§14.3), not a constant shipped with the client.
`GET /skills/catalog` reads it directly. The Phase 1 migration creates the table and
inserts nothing, so a freshly migrated database serves an empty catalogue and the
skill picker has nothing to offer.

`tools/seed_skills.py` fills it.

## There is no canonical catalogue yet

No seed data, no `INSERT INTO skills`, and no catalogue definition exists anywhere in
this repository. Choosing the production vocabulary is a product decision and has
**not** been made here.

`tools/skills_catalog.example.json` documents the file format. Its four entries are
the only skill names that already appear anywhere in this repo — from the test
fixtures in `tests/test_p3_skills.py` and `tests/test_models.py` — and they are **not**
a proposed production list.

## Required fields

From `app/models/skills.py` and §14.3:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Application-generated primary key (`UUIDPrimaryKeyMixin`) |
| `name` | `String(120)` | **NOT NULL**, **UNIQUE**. Not `citext`, so the script compares case-insensitively in Python |
| `category` | `String(80)` | **Nullable**. Free text — no CHECK, no enum. The script validates length only and imposes no vocabulary |
| `created_at` / `updated_at` | `timestamptz` | Server defaults |

`SkillCatalogItem` returns exactly `{id, name, category}`.

## File format

A JSON array of objects:

```json
[
  { "name": "Python", "category": "language" },
  { "name": "Some Skill Without One", "category": null }
]
```

Duplicates (case-insensitive) inside one file are collapsed before any query runs.

## Usage

```powershell
# 1. Dry run (default — writes nothing, prints exactly what would be inserted)
.\.venv\Scripts\python.exe tools\seed_skills.py --catalog tools\skills_catalog.json

# 2. Apply against local
.\.venv\Scripts\python.exe tools\seed_skills.py --catalog tools\skills_catalog.json --apply

# 3. Production — only after the list is agreed and reviewed
.\.venv\Scripts\python.exe tools\seed_skills.py --catalog tools\skills_catalog.json `
    --apply --environment production
```

`DATABASE_URL` is read from the environment. **The script never prints it** — only
`host:port/database` is reported. The password and any query parameters never reach
stdout or an exception message.

## Safety properties

| Property | How |
|---|---|
| Dry run by default | Nothing is written unless `--apply` is passed |
| Idempotent | Existing names are skipped; a second run inserts 0 rows |
| Insert-only | Never updates, never deletes. `user_skills.skill_id` is `ON DELETE RESTRICT`, so deleting a claimed skill is refused by the database anyway |
| Transactional | One commit for the whole batch — no half-seeded catalogue |
| Race-safe | `ON CONFLICT (name) DO NOTHING` guards a concurrent insert |
| Production-guarded | `--environment production` refuses any catalogue whose filename contains `.example.` |

## Production command (NOT run)

```powershell
.\.venv\Scripts\python.exe tools\seed_skills.py --catalog tools\skills_catalog.json `
    --apply --environment production
```

Do not run until `skills_catalog.json` contains the agreed list and that list has been
reviewed.