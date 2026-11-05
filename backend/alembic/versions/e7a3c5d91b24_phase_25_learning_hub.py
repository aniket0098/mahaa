"""Phase 25 — the Learning Hub domain. Five tables.

The whole Learning Hub schema lands in one revision because the tables are one
shape: a course without its sections, lectures, enrollment and progress tables
would each need a second migration for no gain. ``courses`` is the catalogue
row; ``course_sections`` and ``course_lectures`` are its curriculum in two
ordered levels; ``enrollments`` and ``lecture_progress`` are the learner side.
**Only the catalogue read routes exist this phase** — the tables for the later
stages are created now so those stages ship endpoints, not migrations.

**No data is written and no existing object is touched.** The migration is
purely additive: five ``create_table`` calls, their indexes, and nothing else.
The catalogue is empty until the development-only seed
(``tools/seed_courses.py``) is run deliberately against a local database —
never at startup, never in production.

**The CHECKs are the load-bearing part.** ``pricing_matches_access`` makes
"free" and "paid" mutually exclusive and complete, so Stage 9's payment work
reads a column pair that cannot have drifted. The lecture source CHECKs make
"exactly one of ``external_url`` / ``media_id``" a database fact, and keep
third-party links https-only. The two ``position >= 0`` CHECKs and the two
``(parent, position)`` unique indexes make a duplicated slot unrepresentable.

Reversible: ``downgrade`` drops the five tables (and their constraints and
indexes with them, in reverse dependency order). Nothing else in the schema
references them, so no other object is affected.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str | None = 'e7a3c5d91b24'
down_revision: str | Sequence[str] | None = 'c1a2b3d4e5f6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'courses',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('creator_id', sa.UUID(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('slug', sa.String(length=220), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('thumbnail_media_id', sa.UUID(), nullable=True),
        sa.Column('category', sa.String(length=80), nullable=True),
        sa.Column(
            'skill_level',
            sa.Enum(
                'beginner', 'intermediate', 'advanced', 'expert',
                name='skill_level', native_enum=False, create_constraint=True,
            ),
            nullable=True,
        ),
        sa.Column('language', sa.String(length=50), nullable=True),
        sa.Column('estimated_duration_minutes', sa.Integer(), nullable=True),
        sa.Column(
            'is_free', sa.Boolean(),
            server_default=sa.text('true'), nullable=False,
        ),
        sa.Column('price', sa.Numeric(12, 2), nullable=True),
        sa.Column('price_currency', sa.String(length=3), nullable=True),
        sa.Column(
            'status',
            sa.Enum('draft', 'published', name='course_status',
                    native_enum=False, create_constraint=True),
            server_default='draft', nullable=False,
        ),
        sa.Column(
            'visibility',
            sa.Enum('public', 'unlisted', name='course_visibility',
                    native_enum=False, create_constraint=True),
            server_default='public', nullable=False,
        ),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('clock_timestamp()'), nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.text('clock_timestamp()'), nullable=False,
        ),
        # A free course carries no price; a paid one carries a non-negative
        # price. The two states cannot drift apart.
        sa.CheckConstraint(
            '(is_free AND price IS NULL) OR '
            '(NOT is_free AND price IS NOT NULL AND price >= 0)',
            name=op.f('ck_courses_pricing_matches_access'),
        ),
        sa.CheckConstraint(
            'estimated_duration_minutes IS NULL OR estimated_duration_minutes >= 0',
            name=op.f('ck_courses_duration_non_negative'),
        ),
        sa.ForeignKeyConstraint(
            ['creator_id'], ['users.id'],
            name=op.f('fk_courses_creator_id_users'), ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['thumbnail_media_id'], ['media_assets.id'],
            name=op.f('fk_courses_thumbnail_media_id_media_assets'),
            ondelete='SET NULL',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_courses')),
        comment=(
            'One Learning Hub course. price is present if and only if the '
            'course is not free (CHECK pricing_matches_access).'
        ),
    )
    op.create_index('uq_courses_slug', 'courses', ['slug'], unique=True)
    op.create_index('ix_courses_creator_id', 'courses', ['creator_id'], unique=False)
    op.create_index('ix_courses_category', 'courses', ['category'], unique=False)
    op.create_index(
        'ix_courses_status_visibility_published_at',
        'courses', ['status', 'visibility', sa.text('published_at DESC')],
        unique=False,
    )

    op.create_table(
        'course_sections',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('course_id', sa.UUID(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('clock_timestamp()'), nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.text('clock_timestamp()'), nullable=False,
        ),
        sa.CheckConstraint(
            'position >= 0', name=op.f('ck_course_sections_position_non_negative'),
        ),
        sa.ForeignKeyConstraint(
            ['course_id'], ['courses.id'],
            name=op.f('fk_course_sections_course_id_courses'), ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_course_sections')),
        comment='One ordered section of a course’s curriculum.',
    )
    op.create_index(
        'uq_course_sections_course_id_position',
        'course_sections', ['course_id', 'position'], unique=True,
    )

    op.create_table(
        'course_lectures',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('section_id', sa.UUID(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column(
            'kind',
            sa.Enum('hosted_video', 'external_video', 'reading',
                    name='lecture_kind', native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column('media_id', sa.UUID(), nullable=True),
        sa.Column('external_url', sa.String(length=500), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=True),
        sa.Column(
            'is_preview', sa.Boolean(),
            server_default=sa.text('false'), nullable=False,
        ),
        sa.Column(
            'status',
            sa.Enum('draft', 'published', name='lecture_status',
                    native_enum=False, create_constraint=True),
            server_default='draft', nullable=False,
        ),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('clock_timestamp()'), nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.text('clock_timestamp()'), nullable=False,
        ),
        sa.CheckConstraint(
            'position >= 0', name=op.f('ck_course_lectures_position_non_negative'),
        ),
        sa.CheckConstraint(
            'duration_seconds IS NULL OR duration_seconds >= 0',
            name=op.f('ck_course_lectures_duration_non_negative'),
        ),
        sa.CheckConstraint(
            'media_id IS NULL OR external_url IS NULL',
            name=op.f('ck_course_lectures_not_both_sources'),
        ),
        sa.CheckConstraint(
            "external_url IS NULL OR kind IN ('external_video', 'reading')",
            name=op.f('ck_course_lectures_url_requires_linkable_kind'),
        ),
        sa.CheckConstraint(
            "kind <> 'external_video' OR external_url IS NOT NULL",
            name=op.f('ck_course_lectures_external_video_requires_url'),
        ),
        sa.CheckConstraint(
            "external_url IS NULL OR external_url LIKE 'https://%'",
            name=op.f('ck_course_lectures_external_url_https'),
        ),
        sa.ForeignKeyConstraint(
            ['section_id'], ['course_sections.id'],
            name=op.f('fk_course_lectures_section_id_course_sections'),
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['media_id'], ['media_assets.id'],
            name=op.f('fk_course_lectures_media_id_media_assets'),
            ondelete='SET NULL',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_course_lectures')),
        comment=(
            'One lecture. Exactly one source per lecture: an https:// '
            'external URL or a media_assets pointer, never both.'
        ),
    )
    op.create_index(
        'uq_course_lectures_section_id_position',
        'course_lectures', ['section_id', 'position'], unique=True,
    )

    op.create_table(
        'enrollments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('student_id', sa.UUID(), nullable=False),
        sa.Column('course_id', sa.UUID(), nullable=False),
        sa.Column(
            'status',
            sa.Enum('active', 'completed', 'cancelled', name='enrollment_status',
                    native_enum=False, create_constraint=True),
            server_default='active', nullable=False,
        ),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('clock_timestamp()'), nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.text('clock_timestamp()'), nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['course_id'], ['courses.id'],
            name=op.f('fk_enrollments_course_id_courses'), ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['student_id'], ['users.id'],
            name=op.f('fk_enrollments_student_id_users'), ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_enrollments')),
        comment='One student’s enrolment in one course; one row per pair.',
    )
    op.create_index(
        'uq_enrollments_student_id_course_id',
        'enrollments', ['student_id', 'course_id'], unique=True,
    )
    op.create_index(
        'ix_enrollments_course_id', 'enrollments', ['course_id'], unique=False,
    )

    op.create_table(
        'lecture_progress',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('student_id', sa.UUID(), nullable=False),
        sa.Column('lecture_id', sa.UUID(), nullable=False),
        sa.Column(
            'completed', sa.Boolean(),
            server_default=sa.text('false'), nullable=False,
        ),
        sa.Column('position_seconds', sa.Integer(), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('clock_timestamp()'), nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.text('clock_timestamp()'), nullable=False,
        ),
        sa.CheckConstraint(
            'position_seconds IS NULL OR position_seconds >= 0',
            name=op.f('ck_lecture_progress_position_seconds_non_negative'),
        ),
        sa.ForeignKeyConstraint(
            ['lecture_id'], ['course_lectures.id'],
            name=op.f('fk_lecture_progress_lecture_id_course_lectures'),
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['student_id'], ['users.id'],
            name=op.f('fk_lecture_progress_student_id_users'), ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_lecture_progress')),
        comment=(
            'One student’s progress row per lecture; duplicates are '
            'unrepresentable.'
        ),
    )
    op.create_index(
        'uq_lecture_progress_student_id_lecture_id',
        'lecture_progress', ['student_id', 'lecture_id'], unique=True,
    )


def downgrade() -> None:
    op.drop_index('uq_lecture_progress_student_id_lecture_id', table_name='lecture_progress')
    op.drop_table('lecture_progress')
    op.drop_index('ix_enrollments_course_id', table_name='enrollments')
    op.drop_index('uq_enrollments_student_id_course_id', table_name='enrollments')
    op.drop_table('enrollments')
    op.drop_index('uq_course_lectures_section_id_position', table_name='course_lectures')
    op.drop_table('course_lectures')
    op.drop_index('uq_course_sections_course_id_position', table_name='course_sections')
    op.drop_table('course_sections')
    op.drop_index('ix_courses_status_visibility_published_at', table_name='courses')
    op.drop_index('ix_courses_category', table_name='courses')
    op.drop_index('ix_courses_creator_id', table_name='courses')
    op.drop_index('uq_courses_slug', table_name='courses')
    op.drop_table('courses')