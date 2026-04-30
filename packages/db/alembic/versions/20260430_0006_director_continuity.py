"""Phase 2: director continuity — person match key + corrections table

Adds a generated `person_match_key` column on public.officers (lowercased
forename|surname|dob_year|dob_month) and an index for fast lookup. Used by
the company profile sidebar ("Directors also run") and the officer profile
"Likely the same person" section.

DoB year+month is the disambiguator. Officers without DoB get an empty key
and are excluded from cross-officer matching — we genuinely can't tell.

Also adds meta.match_corrections to record user-reported false positives.

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-30
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE public.officers
        ADD COLUMN person_match_key text
        GENERATED ALWAYS AS (
            CASE
                WHEN date_of_birth_year IS NOT NULL
                 AND date_of_birth_month IS NOT NULL
                 AND forename IS NOT NULL
                THEN
                    lower(forename) || '|' ||
                    lower(surname) || '|' ||
                    date_of_birth_year::text || '|' ||
                    date_of_birth_month::text
                ELSE NULL
            END
        ) STORED
    """)
    op.execute("""
        CREATE INDEX officers_person_match_key_idx
            ON public.officers (person_match_key)
            WHERE person_match_key IS NOT NULL
    """)

    op.execute("""
        CREATE TABLE meta.match_corrections (
            id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            officer_id_a    uuid NOT NULL,
            officer_id_b    uuid NOT NULL,
            correction_kind text NOT NULL,
            notes           text,
            ip_hash         text,
            submitted_at    timestamptz NOT NULL DEFAULT now(),
            reviewed_at     timestamptz,
            applied         boolean NOT NULL DEFAULT false,
            CHECK (correction_kind IN ('not_same_person', 'is_same_person')),
            -- Normalise so (a, b) and (b, a) collide on the same row
            CHECK (officer_id_a < officer_id_b)
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX match_corrections_pair_idx
            ON meta.match_corrections (officer_id_a, officer_id_b)
            WHERE applied = true
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS meta.match_corrections CASCADE")
    op.execute("DROP INDEX IF EXISTS officers_person_match_key_idx")
    op.execute("ALTER TABLE public.officers DROP COLUMN IF EXISTS person_match_key")
