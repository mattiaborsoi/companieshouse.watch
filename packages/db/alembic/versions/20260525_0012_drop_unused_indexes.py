"""Drop three unused indexes to reclaim disk and stop monthly regrowth

Confirmed unused via pg_stat_user_indexes on prod (scan counts since last
stats reset) plus a code audit of every audit.events query path:

  audit.events_resource_idx   (resource_kind, resource_id, received_at DESC)
      2 scans. The recent-events feed (lib/db.ts) drives off published_at DESC
      (events_published_idx); the worker dedup lookup uses source_resource_tp_idx.
      ~520 MB on the current monthly partition alone, recreated every month.

  audit.events_timepoint_idx  (ch_timepoint) WHERE source LIKE 'stream:%'
      0 scans. Stream resume reads timepoints from Redis, not this index;
      the dedup lookup (source, resource_id, ch_timepoint) uses
      source_resource_tp_idx. ~300 MB/partition, recreated every month.

  officers_name_full_trgm_idx (name_full gin_trgm_ops)
      6 scans. Redundant duplicate created by migration 0011 — search queries
      hit officers_name_trgm_idx on name_normalised instead. ~93 MB.

The two audit.events indexes are partitioned (parent) indexes; dropping the
parent cascades to all child partition indexes and stops them being recreated
on future monthly partitions. DROP INDEX CONCURRENTLY is not supported on
partitioned indexes, but a plain DROP is a fast metadata op (no data scan).
The officers GIN index is a regular index on a hot table, so it's dropped
CONCURRENTLY to avoid blocking writes.

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-25
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS audit.events_resource_idx")
    op.execute("DROP INDEX IF EXISTS audit.events_timepoint_idx")

    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS public.officers_name_full_trgm_idx"
        )


def downgrade() -> None:
    # NB: recreating partitioned indexes is non-concurrent and recurses to every
    # partition — it briefly locks audit.events. Acceptable for a rare downgrade.
    op.execute(
        "CREATE INDEX IF NOT EXISTS events_resource_idx ON audit.events "
        "USING btree (resource_kind, resource_id, received_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS events_timepoint_idx ON audit.events "
        "USING btree (ch_timepoint) WHERE (source LIKE 'stream:%')"
    )

    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS officers_name_full_trgm_idx "
            "ON public.officers USING gin (name_full gin_trgm_ops)"
        )
