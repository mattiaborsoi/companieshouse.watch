"""public.company_identity: resolved website + favicon + description per company

Phase 1 — Company identity. Stores the result of resolving a company's real-world
identity (website URL, page title, meta description, favicon URL) using the Brave
Search API + a homepage fetch + name/number verification.

Resolution is async: the worker fills this table on a schedule for active companies
that don't yet have a row, plus on-demand for company profile views.

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-30
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.company_identity (
            company_number          text PRIMARY KEY
                                    REFERENCES public.companies(company_number)
                                    ON DELETE CASCADE,

            website_url             text,
            website_title           text,
            website_description     text,
            favicon_url             text,

            -- 'search' = via Brave; 'ch_field' = from CH record (rare); 'manual' = override; 'none' = nothing found
            resolution_method       text NOT NULL,
            -- 'high' (name + number found on page), 'medium' (name only), 'low' (domain heuristic only), 'none'
            resolution_confidence   text NOT NULL,

            resolved_at             timestamptz NOT NULL DEFAULT now(),
            next_check_at           timestamptz NOT NULL,

            last_failure_at         timestamptz,
            failure_count           int NOT NULL DEFAULT 0,

            -- Support manual override / takedown
            override_locked         boolean NOT NULL DEFAULT false,
            notes                   text
        )
    """)

    # For the resolver cron: find active companies without identity, ordered by need
    op.execute("""
        CREATE INDEX company_identity_next_check_idx
            ON public.company_identity (next_check_at)
            WHERE override_locked = false
    """)

    # For the UI: which companies have a resolved identity
    op.execute("""
        CREATE INDEX company_identity_resolved_idx
            ON public.company_identity (resolution_method)
            WHERE website_url IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.company_identity CASCADE")
