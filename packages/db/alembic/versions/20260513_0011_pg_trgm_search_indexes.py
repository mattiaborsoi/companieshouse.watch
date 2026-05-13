"""Speed up /search: GIN trigram indexes on companies.name and officers.name_full

Search was doing a parallel sequential scan of ~500K rows (~1 GB) on every
ILIKE query, costing 2-4 seconds per search. With a GIN trigram index,
PostgreSQL can use the index for any ILIKE '%term%' pattern and serve the
same query in tens of milliseconds.

Indexes built CONCURRENTLY so the streamer/worker upserts aren't blocked
during the build (expect 2-5 min each on prod-size data).

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-13
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pg_trgm is a "trusted" extension on PG ≥13 — non-superusers can create
    # it. Provides the gin_trgm_ops operator class used below.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # CONCURRENTLY can't run inside a transaction — alembic's
    # autocommit_block opens a separate connection that bypasses the
    # implicit transaction wrapping.
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS companies_name_trgm_idx "
            "ON public.companies USING gin (name gin_trgm_ops)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS officers_name_full_trgm_idx "
            "ON public.officers USING gin (name_full gin_trgm_ops)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS public.companies_name_trgm_idx")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS public.officers_name_full_trgm_idx")
