"""Phase C: decoupled hydration pipeline

When a stream event arrives for a company we don't yet have, the event
processor used to retry up to 3 times waiting for the company to appear,
blocking a worker slot for up to 5 minutes per try. Under any backlog,
slots filled up and the queue grew unbounded.

New approach: events for unknown companies go to meta.deferred_events
instead of retrying. A separate cron hydrates the missing companies
from CH REST in a controlled, rate-limit-aware way, then drains the
deferred queue.

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-01
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS meta")

    op.execute("""
        CREATE TABLE meta.deferred_events (
            id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_number  text NOT NULL,
            resource_kind   text NOT NULL,
            resource_id     text NOT NULL,
            payload         jsonb NOT NULL,
            deferred_at     timestamptz NOT NULL DEFAULT now(),
            attempts        int NOT NULL DEFAULT 0,
            last_attempt_at timestamptz,
            last_error      text,
            UNIQUE (resource_kind, resource_id)
        )
    """)
    op.execute("""
        CREATE INDEX deferred_events_company_idx
            ON meta.deferred_events (company_number)
    """)
    op.execute("""
        CREATE INDEX deferred_events_age_idx
            ON meta.deferred_events (deferred_at)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS meta.deferred_events CASCADE")
