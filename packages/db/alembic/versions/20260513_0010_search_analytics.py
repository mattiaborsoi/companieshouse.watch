"""Search analytics: log every search query for product insight

Self-hosted, privacy-first: raw query text + result counts so we can see what
people look for (especially zero-result searches — those are the highest signal
for what to build next). No cookies, no fingerprinting. IPs are SHA-256 hashed
with a salt for dedup only, never stored raw.

Partitioned by searched_at month, matching the audit.events / audit.llm_calls
convention.

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-13
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS audit")

    op.execute("""
        CREATE TABLE audit.searches (
            id                  bigserial,
            query               text NOT NULL,
            query_type          text NOT NULL,
            result_count_local  int  NOT NULL DEFAULT 0,
            result_count_remote int  NOT NULL DEFAULT 0,
            had_results         boolean NOT NULL,
            ip_hash             text,
            searched_at         timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (id, searched_at)
        ) PARTITION BY RANGE (searched_at)
    """)

    # Current month + next two
    op.execute("""
        CREATE TABLE audit.searches_2026_05
            PARTITION OF audit.searches
            FOR VALUES FROM ('2026-05-01') TO ('2026-06-01')
    """)
    op.execute("""
        CREATE TABLE audit.searches_2026_06
            PARTITION OF audit.searches
            FOR VALUES FROM ('2026-06-01') TO ('2026-07-01')
    """)
    op.execute("""
        CREATE TABLE audit.searches_2026_07
            PARTITION OF audit.searches
            FOR VALUES FROM ('2026-07-01') TO ('2026-08-01')
    """)

    op.execute("""
        CREATE INDEX searches_type_time_idx
            ON audit.searches (query_type, searched_at DESC)
    """)
    op.execute("""
        CREATE INDEX searches_results_time_idx
            ON audit.searches (had_results, searched_at DESC)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit.searches CASCADE")
