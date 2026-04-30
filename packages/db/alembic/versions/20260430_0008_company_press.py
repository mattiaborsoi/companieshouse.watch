"""Phase 4: per-company press mentions from GDELT

public.company_press           — one row per (company_number, url)
public.company_press_resolutions — per-company state for the GDELT fetch cron

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-30
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.company_press (
            id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_number  text NOT NULL
                            REFERENCES public.companies(company_number)
                            ON DELETE CASCADE,
            headline        text NOT NULL,
            url             text NOT NULL,
            source_domain   text NOT NULL,
            published_at    timestamptz NOT NULL,
            language        text NOT NULL DEFAULT 'eng',
            raw             jsonb NOT NULL DEFAULT '{}'::jsonb,
            fetched_at      timestamptz NOT NULL DEFAULT now(),
            UNIQUE (company_number, url)
        )
    """)
    op.execute("""
        CREATE INDEX company_press_company_published_idx
            ON public.company_press (company_number, published_at DESC)
    """)

    op.execute("""
        CREATE TABLE public.company_press_resolutions (
            company_number      text PRIMARY KEY
                                REFERENCES public.companies(company_number)
                                ON DELETE CASCADE,
            last_searched_at    timestamptz NOT NULL DEFAULT now(),
            next_search_at      timestamptz NOT NULL DEFAULT now(),
            result_count        int NOT NULL DEFAULT 0,
            consecutive_empties int NOT NULL DEFAULT 0,
            last_error          text
        )
    """)
    op.execute("""
        CREATE INDEX company_press_next_check_idx
            ON public.company_press_resolutions (next_search_at)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.company_press_resolutions CASCADE")
    op.execute("DROP TABLE IF EXISTS public.company_press CASCADE")
