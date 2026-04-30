"""Phase 3: filing-pattern detector.

Recomputes the v1 set of per-company patterns nightly (with a faster pass
over recently-active companies every few hours). Each pattern is a SQL
query that returns rows of (company_number, pattern_label, detail_jsonb).

Patterns:
  1.  first_filing_after_gap   — non-routine filing after >2 yr quiet period
  2.  reactivation             — accounts now non-dormant after dormant
  3.  director_churn           — 3+ appointment-or-resignation events / 12 mo
  4.  address_churn            — 2+ AD01 filings / 12 mo
  5.  director_velocity        — a director of this co. is on appointments
                                  spree elsewhere (3+ in 90 days)
  6.  switched_to_dormant      — latest accounts dormant, previous not
  7.  switched_from_dormant    — latest accounts non-dormant, previous dormant
  8.  recently_incorporated    — incorporated < 90 days ago
  9.  long_dormant             — last 5 accounts all dormant
  10. outstanding_charge       — has_charges = true

For each pattern, we INSERT/UPDATE matching companies as is_currently_active=true
in a transaction, then mark all other rows of that pattern_kind as inactive
(so the table reflects the current truth).

Tone: descriptive, never pejorative. No 'suspicious', 'fraud', 'scam'.
"""
import json
from dataclasses import dataclass

import asyncpg
import structlog

from .db import get_pool

log = structlog.get_logger()


@dataclass
class PatternMatch:
    company_number: str
    pattern_kind: str
    pattern_label: str
    detail: dict


# ── Each detector returns rows of (company_number, label, detail_dict) ──

# 1. First filing after a gap (>2 yr) — looks at non-routine filings only
_FIRST_FILING_AFTER_GAP_SQL = """
WITH non_routine AS (
    SELECT
        company_number,
        filing_date,
        type,
        LAG(filing_date) OVER (PARTITION BY company_number ORDER BY filing_date) AS prev_date
    FROM public.filings
    WHERE filing_date IS NOT NULL
      AND type NOT IN ('CS01', 'GAZ1', 'GAZ2', 'GAZ1(A)', 'GAZ2(A)')
)
SELECT
    company_number,
    EXTRACT(YEAR FROM age(filing_date, prev_date))::int AS gap_years,
    filing_date AS resumed_on
FROM non_routine
WHERE prev_date IS NOT NULL
  AND age(filing_date, prev_date) >= INTERVAL '2 years'
  -- pick the most recent gap-resumption per company
  AND filing_date = (
      SELECT MAX(f2.filing_date) FROM public.filings f2
      WHERE f2.company_number = non_routine.company_number
        AND f2.filing_date IS NOT NULL
  )
"""

# 6. Switched to dormant: latest accounts dormant (AA01), previous non-dormant
_SWITCHED_TO_DORMANT_SQL = """
WITH ranked AS (
    SELECT
        company_number, type, filing_date,
        ROW_NUMBER() OVER (PARTITION BY company_number ORDER BY filing_date DESC) AS rn
    FROM public.filings
    WHERE category = 'accounts' AND filing_date IS NOT NULL
)
SELECT
    a.company_number,
    a.filing_date AS switched_on
FROM ranked a
JOIN ranked b ON b.company_number = a.company_number AND b.rn = 2
WHERE a.rn = 1
  AND a.type = 'AA01'
  AND b.type != 'AA01'
"""

# 7. Switched from dormant: latest non-dormant, previous dormant
_SWITCHED_FROM_DORMANT_SQL = """
WITH ranked AS (
    SELECT
        company_number, type, filing_date,
        ROW_NUMBER() OVER (PARTITION BY company_number ORDER BY filing_date DESC) AS rn
    FROM public.filings
    WHERE category = 'accounts' AND filing_date IS NOT NULL
)
SELECT
    a.company_number,
    a.filing_date AS reactivated_on
FROM ranked a
JOIN ranked b ON b.company_number = a.company_number AND b.rn = 2
WHERE a.rn = 1
  AND a.type != 'AA01'
  AND b.type = 'AA01'
"""

# 9. Long dormant: last 5+ accounts all AA01 (or fewer if all on file are dormant)
_LONG_DORMANT_SQL = """
WITH last_accounts AS (
    SELECT
        company_number, type,
        ROW_NUMBER() OVER (PARTITION BY company_number ORDER BY filing_date DESC) AS rn
    FROM public.filings
    WHERE category = 'accounts' AND filing_date IS NOT NULL
)
SELECT
    company_number,
    COUNT(*) FILTER (WHERE type = 'AA01') AS dormant_count,
    COUNT(*) AS total_count
FROM last_accounts
WHERE rn <= 5
GROUP BY company_number
HAVING COUNT(*) >= 3
   AND COUNT(*) FILTER (WHERE type = 'AA01') = COUNT(*)
"""

# 4. Address churn: 2+ AD01 filings in trailing 12 months
_ADDRESS_CHURN_SQL = """
SELECT
    company_number,
    COUNT(*) AS changes
FROM public.filings
WHERE type = 'AD01'
  AND filing_date >= now() - INTERVAL '12 months'
GROUP BY company_number
HAVING COUNT(*) >= 2
"""

# 3. Director churn: 3+ appointment+resignation events in trailing 12 months
_DIRECTOR_CHURN_SQL = """
SELECT
    company_number,
    SUM(events) AS event_count
FROM (
    SELECT company_number, COUNT(*) AS events
    FROM public.appointments
    WHERE appointed_on >= now() - INTERVAL '12 months'
    GROUP BY company_number
    UNION ALL
    SELECT company_number, COUNT(*) AS events
    FROM public.appointments
    WHERE resigned_on >= now() - INTERVAL '12 months'
    GROUP BY company_number
) ev
GROUP BY company_number
HAVING SUM(events) >= 3
"""

# 5. Director velocity: company has at least one director who's been
# appointed at 3+ different companies in the last 90 days.
_DIRECTOR_VELOCITY_SQL = """
WITH busy_directors AS (
    SELECT officer_id, COUNT(DISTINCT company_number) AS n
    FROM public.appointments
    WHERE appointed_on >= now() - INTERVAL '90 days'
    GROUP BY officer_id
    HAVING COUNT(DISTINCT company_number) >= 3
)
SELECT
    a.company_number,
    MAX(o.name_full) AS officer_name,
    MAX(bd.n) AS recent_appointments
FROM busy_directors bd
JOIN public.appointments a ON a.officer_id = bd.officer_id
JOIN public.officers o ON o.officer_id = bd.officer_id
GROUP BY a.company_number
"""

# 8. Recently incorporated: <90 days ago
_RECENTLY_INCORPORATED_SQL = """
SELECT
    company_number,
    incorporated_on,
    EXTRACT(DAY FROM age(now(), incorporated_on))::int AS age_days
FROM public.companies
WHERE incorporated_on >= now() - INTERVAL '90 days'
  AND status = 'active'
"""

# 10. Outstanding charge: has_charges is true
_OUTSTANDING_CHARGE_SQL = """
SELECT company_number
FROM public.companies
WHERE has_charges = true
  AND status = 'active'
"""

# 2. Reactivation = synonymous with switched_from_dormant in our v1.
# We surface it as a separate kind because the plan called it out, but
# the SQL is identical for the data we have. We use the same query.


# ── Pattern definitions: kind, label_template, detail_columns, sql ──


def _label_first_filing_after_gap(d: dict) -> str:
    yrs = d.get("gap_years", 0)
    return f"First filing in {yrs}+ years"


def _label_switched_to_dormant(d: dict) -> str:
    return "Switched to dormant"


def _label_switched_from_dormant(d: dict) -> str:
    return "Switched from dormant"


def _label_long_dormant(d: dict) -> str:
    n = d.get("dormant_count", 0)
    return f"Long dormant ({n}+ years)"


def _label_address_churn(d: dict) -> str:
    n = d.get("changes", 0)
    return f"Address changed {n}× / 12 mo"


def _label_director_churn(d: dict) -> str:
    n = d.get("event_count", 0)
    return f"Director churn ({n} events / 12 mo)"


def _label_director_velocity(d: dict) -> str:
    name = d.get("officer_name", "a director")
    n = d.get("recent_appointments", 0)
    return f"{name.split(',')[0].title()} appointed at {n} cos / 90 days"


def _label_recently_incorporated(d: dict) -> str:
    n = d.get("age_days", 0)
    return f"New ({n} days old)"


def _label_outstanding_charge(d: dict) -> str:
    return "Outstanding charge"


PATTERNS: list[tuple[str, str, callable]] = [
    # (pattern_kind, sql, label_fn)
    ("first_filing_after_gap", _FIRST_FILING_AFTER_GAP_SQL, _label_first_filing_after_gap),
    ("switched_to_dormant",    _SWITCHED_TO_DORMANT_SQL,    _label_switched_to_dormant),
    ("switched_from_dormant",  _SWITCHED_FROM_DORMANT_SQL,  _label_switched_from_dormant),
    ("reactivation",           _SWITCHED_FROM_DORMANT_SQL,  _label_switched_from_dormant),
    ("long_dormant",           _LONG_DORMANT_SQL,           _label_long_dormant),
    ("address_churn",          _ADDRESS_CHURN_SQL,          _label_address_churn),
    ("director_churn",         _DIRECTOR_CHURN_SQL,         _label_director_churn),
    ("director_velocity",      _DIRECTOR_VELOCITY_SQL,      _label_director_velocity),
    ("recently_incorporated",  _RECENTLY_INCORPORATED_SQL,  _label_recently_incorporated),
    ("outstanding_charge",     _OUTSTANDING_CHARGE_SQL,     _label_outstanding_charge),
]


_UPSERT_SQL = """
INSERT INTO public.company_patterns
    (company_number, pattern_kind, pattern_label, detail, last_seen_at, is_currently_active)
VALUES ($1, $2, $3, $4::jsonb, now(), true)
ON CONFLICT (company_number, pattern_kind) DO UPDATE SET
    pattern_label       = EXCLUDED.pattern_label,
    detail              = EXCLUDED.detail,
    last_seen_at        = now(),
    is_currently_active = true
"""

_DEACTIVATE_SQL = """
UPDATE public.company_patterns
SET is_currently_active = false
WHERE pattern_kind = $1
  AND last_seen_at < $2
  AND is_currently_active = true
"""


async def detect_patterns(ctx: dict) -> None:
    """Cron: recompute all v1 patterns and update public.company_patterns."""
    pool: asyncpg.Pool = ctx["pool"]
    bound = log.bind(job="detect_patterns")

    summary: dict[str, int] = {}

    for kind, sql_text, label_fn in PATTERNS:
        async with pool.acquire() as conn:
            async with conn.transaction():
                run_started_at = await conn.fetchval("SELECT now()")
                rows = await conn.fetch(sql_text)
                for r in rows:
                    detail = {k: _json_safe(v) for k, v in dict(r).items() if k != "company_number"}
                    label = label_fn(detail)
                    await conn.execute(
                        _UPSERT_SQL,
                        r["company_number"],
                        kind,
                        label,
                        json.dumps(detail),
                    )
                # Mark all rows of this kind that we didn't just touch as inactive.
                await conn.execute(_DEACTIVATE_SQL, kind, run_started_at)
        summary[kind] = len(rows)

    bound.info("detect_patterns_complete", **summary)


def _json_safe(v):
    """Coerce dates/datetimes/decimals to JSON-serialisable values."""
    from datetime import date, datetime
    from decimal import Decimal
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v
