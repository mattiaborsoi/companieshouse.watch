"""Phase 3: filing-pattern badges

Materialised per-company badges ("First filing in 4 years", "Long dormant",
"Address changed 3× in 12 months", etc.). Each pattern is deterministic and
recomputed by a worker cron. Patterns that no longer apply are marked
is_currently_active = false rather than deleted, so we keep history.

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-30
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.company_patterns (
            id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_number      text NOT NULL
                                REFERENCES public.companies(company_number)
                                ON DELETE CASCADE,
            pattern_kind        text NOT NULL,
            pattern_label       text NOT NULL,
            detail              jsonb NOT NULL DEFAULT '{}'::jsonb,
            detected_at         timestamptz NOT NULL DEFAULT now(),
            last_seen_at        timestamptz NOT NULL DEFAULT now(),
            is_currently_active boolean NOT NULL DEFAULT true,
            UNIQUE (company_number, pattern_kind)
        )
    """)
    op.execute("""
        CREATE INDEX company_patterns_active_company_idx
            ON public.company_patterns (company_number)
            WHERE is_currently_active = true
    """)
    op.execute("""
        CREATE INDEX company_patterns_kind_idx
            ON public.company_patterns (pattern_kind)
            WHERE is_currently_active = true
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.company_patterns CASCADE")
