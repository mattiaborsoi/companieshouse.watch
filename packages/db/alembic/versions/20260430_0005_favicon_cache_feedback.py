"""favicon cache + identity feedback tables

Phase 1 closeout:
- public.company_favicons: cache the actual favicon bytes so we serve them
  from our own domain (no third-party tracking, validation enforced).
- meta.identity_feedback: store user-reported "incorrect website" submissions.

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-30
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS meta")

    op.execute("""
        CREATE TABLE public.company_favicons (
            company_number   text PRIMARY KEY
                             REFERENCES public.companies(company_number)
                             ON DELETE CASCADE,
            content_type     text NOT NULL,
            bytes            bytea NOT NULL,
            byte_length      int NOT NULL,
            source_url       text NOT NULL,
            fetched_at       timestamptz NOT NULL DEFAULT now(),
            CHECK (byte_length > 0 AND byte_length <= 200000)
        )
    """)

    op.execute("""
        CREATE TABLE meta.identity_feedback (
            id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_number  text NOT NULL,
            kind            text NOT NULL,
            reported_url    text,
            notes           text,
            ip_hash         text,
            submitted_at    timestamptz NOT NULL DEFAULT now(),
            reviewed_at     timestamptz,
            applied         boolean NOT NULL DEFAULT false
        )
    """)
    op.execute("""
        CREATE INDEX identity_feedback_unreviewed_idx
            ON meta.identity_feedback (submitted_at DESC)
            WHERE reviewed_at IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS meta.identity_feedback CASCADE")
    op.execute("DROP TABLE IF EXISTS public.company_favicons CASCADE")
