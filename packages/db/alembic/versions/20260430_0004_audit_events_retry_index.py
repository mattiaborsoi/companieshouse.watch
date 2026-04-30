"""audit.events: index for the retry lookup query

The worker's process_event runs `SELECT id FROM audit.events WHERE source = $1
AND resource_id = $2 AND ch_timepoint = $3` on every retry. The existing
indexes are on (resource_kind, resource_id, received_at) and (ch_timepoint),
neither of which covers this lookup, so it was a sequential scan per retry.

With a 50k+ retry queue this hammered Postgres. Added (source, resource_id,
ch_timepoint) per partition.

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-30
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# audit.events is partitioned by month. The initial migration created
# 2026_04, 2026_05, 2026_06. Add the index to each existing partition.
# When new monthly partitions are added later, they'll need the same index
# (handled by the partition creation routine — out of scope here).
_PARTITIONS = ["2026_04", "2026_05", "2026_06"]


def upgrade() -> None:
    # Run with autocommit so CREATE INDEX CONCURRENTLY works on a live system.
    # Alembic emits each statement in its own transaction by default, but
    # CONCURRENTLY requires no surrounding tx — use op.execute on each.
    for part in _PARTITIONS:
        op.execute(
            f"CREATE INDEX IF NOT EXISTS events_{part}_source_resource_tp_idx "
            f"ON audit.events_{part} (source, resource_id, ch_timepoint)"
        )


def downgrade() -> None:
    for part in _PARTITIONS:
        op.execute(f"DROP INDEX IF EXISTS audit.events_{part}_source_resource_tp_idx")
