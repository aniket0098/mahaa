"""Phase 12 — post engagement. The ``post_likes`` and ``post_comments`` tables.

The last two of §14.9's five post tables that the feed actually needs. They were
absent while the like button toggled device-local state and ``CommentsSheet``
showed an honest empty state; the client now has a real caller for both, so the
storage follows.

**``post_likes`` has a composite primary key and no ``id`` column.** This is the
line that matters. ``PRIMARY KEY (post_id, user_id)`` makes a duplicate like
*unrepresentable* — the second INSERT from a double-tapped heart collides with
the key instead of creating a second row. A surrogate id plus a separate unique
constraint would express the same rule, but the key already is the rule, so adding
an id would be a second thing to keep consistent.

**``post_comments`` has a surrogate id**, unlike the like table. A comment has a
body, an author and a timestamp and is addressed individually by the delete route,
so it needs an identity of its own — that is the whole difference between the two
tables.

**``btrim(body) <> ''`` is a CHECK, not only a schema rule.** Whitespace-only text
passes a naive ``min_length`` and renders as an empty bubble that can never be
edited or unsent. The service refuses it too; this is the last line of defence.

**Both ``post_id`` columns are CASCADE.** A like or a comment is meaningless
without its post, and posts are *soft* deleted — so these rows only actually go
when the post row does. That is what keeps §9.3's promise that a post's position
and its comments survive a delete.

**``deleted_at`` on comments, filtered in the service rather than the index.**
A soft-deleted comment must vanish from every read without losing the row, which
is also what a moderation trail needs. The listing is never long enough for a
partial index to earn its maintenance cost.

Reversible: ``downgrade`` drops both tables. ``post_likes`` first, since nothing
else references it; ``post_comments`` has no dependents either. Touches no object
any earlier revision created.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str | None = 'f4c7a2e91b06'
down_revision: str | Sequence[str] | None = 'a1c94f7b2e08'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'post_likes',
        sa.Column('post_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['post_id'], ['posts.id'], name=op.f('fk_post_likes_post_id_posts'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_post_likes_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('post_id', 'user_id', name=op.f('pk_post_likes')),
        comment='One row per (post, account); duplicates are unrepresentable.',
    )
    op.create_index('ix_post_likes_post_id', 'post_likes', ['post_id'], unique=False)
    op.create_index('ix_post_likes_user_id', 'post_likes', ['user_id'], unique=False)

    op.create_table(
        'post_comments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('post_id', sa.UUID(), nullable=False),
        sa.Column('author_id', sa.UUID(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("btrim(body) <> ''", name=op.f('ck_post_comments_body_not_blank')),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], name=op.f('fk_post_comments_author_id_users'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['post_id'], ['posts.id'], name=op.f('fk_post_comments_post_id_posts'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_post_comments')),
    )
    op.create_index(
        'ix_post_comments_post_id_created_at_id',
        'post_comments',
        ['post_id', sa.literal_column('created_at DESC'), sa.literal_column('id DESC')],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_post_comments_post_id_created_at_id', table_name='post_comments')
    op.drop_table('post_comments')
    op.drop_index('ix_post_likes_user_id', table_name='post_likes')
    op.drop_index('ix_post_likes_post_id', table_name='post_likes')
    op.drop_table('post_likes')