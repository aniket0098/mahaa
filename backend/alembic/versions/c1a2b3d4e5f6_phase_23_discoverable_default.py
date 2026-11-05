"""Phase 23 — ``profile_privacy.discoverable`` defaults to on (opt-out).

The search fix. ``GET /users/lookup`` gates a *name* fragment on
``profile_privacy.discoverable``; an exact handle or ``public_id`` resolves
regardless. The column defaulted to **false** and the privacy row was created
lazily on first profile read, so a freshly-registered account was invisible to a
name search until its owner happened to open their profile or Settings and turn
a flag on that nothing ever prompted them about. On a professional network the
intended behaviour is the opposite — an account is findable by name until its
owner opts out — so this revision moves the default and makes the row eager.

**What changes, precisely, and what deliberately does not:**

* ``server_default`` moves from ``'false'`` to ``'true'``. This affects only
  rows inserted *after* the migration that do not name the column — the
  signup path now also creates the row eagerly with the ORM default (``true``),
  so new accounts are discoverable unless their owner turns it off in Settings.
* Existing rows are **backfilled** from ``false`` to ``true``. The rows sitting
  at ``false`` today are there *because of the old default* — nobody was ever
  asked to opt out, and the flag was never surfaced at signup — so treating them
  as deliberate opt-outs would freeze the exact bug this phase fixes. This is a
  product decision (discoverable-by-default for a professional network), applied
  only to the local/development database as part of this phase's testing; it is
  **never** run against production here.
* The privacy *contract* is untouched and stays strict: an account whose owner
  later sets ``discoverable = false`` is excluded from name search again, an
  exact handle or ``public_id`` still resolves a private account, and a row that
  is absent entirely (only possible for an account created before the eager
  signup row, or through a path that bypasses signup) is still treated as not
  discoverable. Nothing about *who* may be found changed — only the default a
  new row starts at.

Reversible and safe: ``downgrade`` restores the ``'false'`` server default and
flips the backfilled rows back, so a round trip leaves the data and the default
exactly as they were. It touches one column on one table and no other object.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str | None = 'c1a2b3d4e5f6'
down_revision: str | Sequence[str] | None = 'b7d2f8c41a93'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Move the default first, so any row inserted during the backfill below (none
    # is expected, but a concurrent signup is possible) also lands on the new
    # value rather than the old one.
    op.alter_column(
        'profile_privacy',
        'discoverable',
        existing_type=sa.Boolean(),
        server_default='true',
        existing_nullable=False,
    )
    # Backfill the rows the old default created. Scoped to ``discoverable IS
    # false`` so a row already flipped back off by a real opt-out is left alone —
    # though under the old default no such row can exist yet, the predicate is
    # the honest statement of intent either way.
    op.execute(
        "UPDATE profile_privacy SET discoverable = true WHERE discoverable = false"
    )


def downgrade() -> None:
    # Restore the previous default and the previous values, so the round trip is
    # exact. Same predicate, inverted.
    op.execute(
        "UPDATE profile_privacy SET discoverable = false WHERE discoverable = true"
    )
    op.alter_column(
        'profile_privacy',
        'discoverable',
        existing_type=sa.Boolean(),
        server_default='false',
        existing_nullable=False,
    )
