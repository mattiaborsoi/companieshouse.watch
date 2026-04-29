"""Initial schema: all tables from DATA_MODEL.md

Revision ID: 0001
Revises:
Create Date: 2026-04-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")

    op.execute("CREATE SCHEMA IF NOT EXISTS audit")
    op.execute("CREATE SCHEMA IF NOT EXISTS meta")

    # -------------------------------------------------------------------------
    # public.companies
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE public.companies (
            company_number                text PRIMARY KEY,
            name                          text NOT NULL,
            name_normalised               text NOT NULL,
            status                        text NOT NULL,
            status_detail                 text,
            type                          text NOT NULL,
            jurisdiction                  text NOT NULL,

            incorporated_on               date,
            dissolved_on                  date,
            ceased_on                     date,

            registered_address            jsonb NOT NULL DEFAULT '{}'::jsonb,
            registered_address_postcode   text,
            registered_address_hash       text,

            sic_codes                     text[] NOT NULL DEFAULT '{}',

            has_charges                   boolean NOT NULL DEFAULT false,
            has_insolvency                boolean NOT NULL DEFAULT false,
            has_been_liquidated           boolean NOT NULL DEFAULT false,

            accounts_next_due             date,
            accounts_last_made_up_to      date,
            confirmation_next_due         date,

            raw                           jsonb NOT NULL,
            raw_etag                      text,

            first_seen_at                 timestamptz NOT NULL DEFAULT now(),
            last_full_refresh_at          timestamptz,
            last_event_at                 timestamptz,

            CONSTRAINT companies_jurisdiction_check
                CHECK (jurisdiction IN (
                    'england-wales', 'scotland', 'northern-ireland', 'european',
                    'united-kingdom', 'wales', 'channel-islands'
                ))
        )
    """)

    op.execute("""
        CREATE INDEX companies_name_trgm_idx
            ON public.companies USING gin (name_normalised gin_trgm_ops)
    """)
    op.execute("""
        CREATE INDEX companies_name_fts_idx
            ON public.companies USING gin (to_tsvector('english', name))
    """)
    op.execute("CREATE INDEX companies_status_idx ON public.companies (status)")
    op.execute("CREATE INDEX companies_postcode_idx ON public.companies (registered_address_postcode)")
    op.execute("CREATE INDEX companies_address_hash_idx ON public.companies (registered_address_hash)")
    op.execute("CREATE INDEX companies_incorporated_idx ON public.companies (incorporated_on DESC)")
    op.execute("CREATE INDEX companies_sic_gin_idx ON public.companies USING gin (sic_codes)")
    op.execute("CREATE INDEX companies_last_event_idx ON public.companies (last_event_at DESC)")

    # -------------------------------------------------------------------------
    # public.officers
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE public.officers (
            officer_id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            ch_officer_link         text NOT NULL UNIQUE,

            forename                text,
            other_forenames         text,
            surname                 text NOT NULL,
            honorific               text,
            name_full               text NOT NULL,
            name_normalised         text NOT NULL,

            date_of_birth_year      int,
            date_of_birth_month     int CHECK (date_of_birth_month BETWEEN 1 AND 12),

            nationality             text,
            country_of_residence    text,
            occupation              text,

            raw                     jsonb NOT NULL,
            first_seen_at           timestamptz NOT NULL DEFAULT now(),
            last_event_at           timestamptz
        )
    """)

    op.execute("CREATE INDEX officers_surname_idx ON public.officers (lower(surname))")
    op.execute("""
        CREATE INDEX officers_name_trgm_idx
            ON public.officers USING gin (name_normalised gin_trgm_ops)
    """)
    op.execute("CREATE INDEX officers_dob_idx ON public.officers (date_of_birth_year, date_of_birth_month)")

    # -------------------------------------------------------------------------
    # public.appointments
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE public.appointments (
            id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_number      text NOT NULL REFERENCES public.companies(company_number),
            officer_id          uuid NOT NULL REFERENCES public.officers(officer_id),

            role                text NOT NULL,
            appointed_on        date,
            resigned_on         date,
            is_pre_1992         boolean NOT NULL DEFAULT false,

            appointed_address   jsonb,
            raw                 jsonb NOT NULL,

            first_seen_at       timestamptz NOT NULL DEFAULT now(),
            last_event_at       timestamptz,

            UNIQUE (company_number, officer_id, role, appointed_on)
        )
    """)

    op.execute("""
        CREATE INDEX appointments_company_idx
            ON public.appointments (company_number, appointed_on DESC NULLS LAST)
    """)
    op.execute("""
        CREATE INDEX appointments_officer_idx
            ON public.appointments (officer_id, appointed_on DESC NULLS LAST)
    """)
    op.execute("""
        CREATE INDEX appointments_active_idx
            ON public.appointments (company_number) WHERE resigned_on IS NULL
    """)

    # -------------------------------------------------------------------------
    # public.filings
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE public.filings (
            transaction_id          text PRIMARY KEY,
            company_number          text NOT NULL REFERENCES public.companies(company_number),

            category                text NOT NULL,
            type                    text NOT NULL,
            subcategory             text,
            description             text NOT NULL,
            description_values      jsonb NOT NULL DEFAULT '{}'::jsonb,

            filing_date             date NOT NULL,
            action_date             date,

            paper_filed             boolean NOT NULL DEFAULT false,
            pages                   int,

            document_metadata_url   text,
            has_pdf                 boolean NOT NULL DEFAULT false,
            has_xbrl                boolean NOT NULL DEFAULT false,

            raw                     jsonb NOT NULL,
            ingested_at             timestamptz NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE INDEX filings_company_date_idx
            ON public.filings (company_number, filing_date DESC)
    """)
    op.execute("CREATE INDEX filings_type_idx ON public.filings (type, filing_date DESC)")
    op.execute("CREATE INDEX filings_category_idx ON public.filings (category, filing_date DESC)")
    op.execute("CREATE INDEX filings_recent_idx ON public.filings (ingested_at DESC)")

    # -------------------------------------------------------------------------
    # public.psc
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE public.psc (
            id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            ch_psc_link             text NOT NULL UNIQUE,

            company_number          text NOT NULL REFERENCES public.companies(company_number),
            kind                    text NOT NULL,

            name                    text,
            name_elements           jsonb,
            is_anonymised           boolean NOT NULL DEFAULT false,

            natures_of_control      text[] NOT NULL DEFAULT '{}',

            notified_on             date,
            ceased_on               date,

            date_of_birth_year      int,
            date_of_birth_month     int,
            nationality             text,
            country_of_residence    text,

            identification          jsonb,

            raw                     jsonb NOT NULL,
            first_seen_at           timestamptz NOT NULL DEFAULT now(),
            last_event_at           timestamptz
        )
    """)

    op.execute("CREATE INDEX psc_company_idx ON public.psc (company_number)")
    op.execute("CREATE INDEX psc_active_idx ON public.psc (company_number) WHERE ceased_on IS NULL")
    op.execute("CREATE INDEX psc_kind_idx ON public.psc (kind)")
    op.execute("""
        CREATE INDEX psc_nationality_idx ON public.psc (nationality)
            WHERE ceased_on IS NULL AND kind LIKE 'individual%'
    """)

    # -------------------------------------------------------------------------
    # public.charges (schema reserved; ingestion is Phase 4)
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE public.charges (
            charge_id           text PRIMARY KEY,
            company_number      text NOT NULL REFERENCES public.companies(company_number),
            status              text NOT NULL,
            created_on          date,
            delivered_on        date,
            satisfied_on        date,
            classification      jsonb,
            particulars         jsonb,
            persons_entitled    jsonb,
            raw                 jsonb NOT NULL,
            first_seen_at       timestamptz NOT NULL DEFAULT now(),
            last_event_at       timestamptz
        )
    """)

    op.execute("CREATE INDEX charges_company_idx ON public.charges (company_number)")
    op.execute("""
        CREATE INDEX charges_outstanding_idx ON public.charges (company_number)
            WHERE status = 'outstanding'
    """)

    # -------------------------------------------------------------------------
    # public.financials (XBRL-derived; populated in Phase 4)
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE public.financials (
            id                              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_number                  text NOT NULL REFERENCES public.companies(company_number),
            transaction_id                  text REFERENCES public.filings(transaction_id),

            period_start                    date,
            period_end                      date NOT NULL,
            reporting_standard              text,
            is_consolidated                 boolean NOT NULL DEFAULT false,
            is_dormant                      boolean NOT NULL DEFAULT false,
            currency                        text NOT NULL DEFAULT 'GBP',

            turnover_pence                  bigint,
            cost_of_sales_pence             bigint,
            gross_profit_pence              bigint,
            operating_profit_pence          bigint,
            profit_before_tax_pence         bigint,
            profit_for_period_pence         bigint,
            total_assets_pence              bigint,
            current_assets_pence            bigint,
            current_liabilities_pence       bigint,
            net_assets_pence                bigint,
            cash_at_bank_pence              bigint,
            shareholders_funds_pence        bigint,

            employees_average               int,

            raw_xbrl_url                    text,
            parser_version                  text NOT NULL,
            parsed_at                       timestamptz NOT NULL DEFAULT now(),

            UNIQUE (company_number, period_end, is_consolidated)
        )
    """)

    op.execute("""
        CREATE INDEX financials_company_period_idx
            ON public.financials (company_number, period_end DESC)
    """)

    # -------------------------------------------------------------------------
    # audit.events (partitioned by received_at month)
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE audit.events (
            id              bigserial,
            source          text NOT NULL,
            resource_kind   text NOT NULL,
            resource_id     text NOT NULL,
            resource_uri    text,
            ch_timepoint    bigint,
            published_at    timestamptz NOT NULL,
            fields_changed  text[] NOT NULL DEFAULT '{}',
            payload         jsonb NOT NULL,
            received_at     timestamptz NOT NULL DEFAULT now(),
            processed_at    timestamptz,
            processing_error text,
            PRIMARY KEY (id, received_at)
        ) PARTITION BY RANGE (received_at)
    """)

    # Create initial partitions: current month + next 2 months
    op.execute("""
        CREATE TABLE audit.events_2026_04
            PARTITION OF audit.events
            FOR VALUES FROM ('2026-04-01') TO ('2026-05-01')
    """)
    op.execute("""
        CREATE TABLE audit.events_2026_05
            PARTITION OF audit.events
            FOR VALUES FROM ('2026-05-01') TO ('2026-06-01')
    """)
    op.execute("""
        CREATE TABLE audit.events_2026_06
            PARTITION OF audit.events
            FOR VALUES FROM ('2026-06-01') TO ('2026-07-01')
    """)

    op.execute("""
        CREATE INDEX events_resource_idx
            ON audit.events (resource_kind, resource_id, received_at DESC)
    """)
    op.execute("""
        CREATE INDEX events_unprocessed_idx
            ON audit.events (received_at) WHERE processed_at IS NULL
    """)
    op.execute("CREATE INDEX events_published_idx ON audit.events (published_at DESC)")
    op.execute("""
        CREATE INDEX events_timepoint_idx ON audit.events (ch_timepoint)
            WHERE source LIKE 'stream:%'
    """)

    # -------------------------------------------------------------------------
    # public.ai_summaries (needed before anomalies FK)
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE public.ai_summaries (
            id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            kind            text NOT NULL,
            prompt_version  text NOT NULL,
            input_hash      text NOT NULL,
            model           text NOT NULL,
            output          text NOT NULL,
            output_format   text NOT NULL DEFAULT 'plain',
            input_tokens    int NOT NULL,
            output_tokens   int NOT NULL,
            cost_pence      int NOT NULL,
            generated_at    timestamptz NOT NULL DEFAULT now(),
            superseded_by   uuid REFERENCES public.ai_summaries(id),

            UNIQUE (kind, prompt_version, input_hash)
        )
    """)

    op.execute("CREATE INDEX ai_summaries_kind_idx ON public.ai_summaries (kind, generated_at DESC)")

    # -------------------------------------------------------------------------
    # public.anomalies
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE public.anomalies (
            id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            kind                    text NOT NULL,
            detection_key           text NOT NULL,

            first_detected_at       timestamptz NOT NULL DEFAULT now(),
            last_detected_at        timestamptz NOT NULL DEFAULT now(),
            is_currently_flagged    boolean NOT NULL DEFAULT true,

            score                   int NOT NULL CHECK (score BETWEEN 0 AND 100),
            features                jsonb NOT NULL,

            ai_summary_id           uuid REFERENCES public.ai_summaries(id),

            takedown_requested_at   timestamptz,
            takedown_resolved_at    timestamptz,
            takedown_action         text,
            takedown_notes          text,

            UNIQUE (kind, detection_key)
        )
    """)

    op.execute("""
        CREATE INDEX anomalies_active_idx ON public.anomalies (score DESC)
            WHERE is_currently_flagged = true AND takedown_action IS DISTINCT FROM 'removed'
    """)
    op.execute("CREATE INDEX anomalies_kind_idx ON public.anomalies (kind, last_detected_at DESC)")

    # -------------------------------------------------------------------------
    # public.users & public.subscriptions
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE public.users (
            id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            email               citext NOT NULL UNIQUE,
            email_verified_at   timestamptz,
            display_name        text,
            plan                text NOT NULL DEFAULT 'free',
            stripe_customer_id  text UNIQUE,
            created_at          timestamptz NOT NULL DEFAULT now(),
            last_active_at      timestamptz,
            is_banned           boolean NOT NULL DEFAULT false,
            ban_reason          text,

            CONSTRAINT users_plan_check CHECK (plan IN ('free', 'pro'))
        )
    """)

    op.execute("""
        CREATE TABLE public.subscriptions (
            id                          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id                     uuid NOT NULL REFERENCES public.users(id),
            stripe_subscription_id      text UNIQUE,
            status                      text NOT NULL,
            plan                        text NOT NULL,
            current_period_end          timestamptz NOT NULL,
            cancel_at_period_end        boolean NOT NULL DEFAULT false,
            raw                         jsonb NOT NULL,
            created_at                  timestamptz NOT NULL DEFAULT now(),
            updated_at                  timestamptz NOT NULL DEFAULT now()
        )
    """)

    op.execute("CREATE INDEX subscriptions_user_idx ON public.subscriptions (user_id, status)")

    # -------------------------------------------------------------------------
    # audit.llm_calls (partitioned by called_at month)
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE audit.llm_calls (
            id              bigserial,
            ai_summary_id   uuid REFERENCES public.ai_summaries(id),
            kind            text NOT NULL,
            prompt_version  text NOT NULL,
            user_id         uuid REFERENCES public.users(id),
            ip_hash         text,
            source          text NOT NULL,
            model           text,
            input_tokens    int,
            output_tokens   int,
            cost_pence      int NOT NULL DEFAULT 0,
            cached_hit      boolean NOT NULL,
            outcome         text NOT NULL,
            latency_ms      int,
            error_message   text,
            called_at       timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (id, called_at)
        ) PARTITION BY RANGE (called_at)
    """)

    op.execute("""
        CREATE TABLE audit.llm_calls_2026_04
            PARTITION OF audit.llm_calls
            FOR VALUES FROM ('2026-04-01') TO ('2026-05-01')
    """)
    op.execute("""
        CREATE TABLE audit.llm_calls_2026_05
            PARTITION OF audit.llm_calls
            FOR VALUES FROM ('2026-05-01') TO ('2026-06-01')
    """)
    op.execute("""
        CREATE TABLE audit.llm_calls_2026_06
            PARTITION OF audit.llm_calls
            FOR VALUES FROM ('2026-06-01') TO ('2026-07-01')
    """)

    op.execute("CREATE INDEX llm_calls_user_idx ON audit.llm_calls (user_id, called_at DESC)")
    op.execute("CREATE INDEX llm_calls_ip_idx ON audit.llm_calls (ip_hash, called_at DESC)")
    op.execute("CREATE INDEX llm_calls_called_idx ON audit.llm_calls (called_at DESC)")
    op.execute("CREATE INDEX llm_calls_outcome_idx ON audit.llm_calls (outcome, called_at DESC)")

    # -------------------------------------------------------------------------
    # meta.quotas_daily
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE meta.quotas_daily (
            date                    date PRIMARY KEY,
            llm_calls_total         int NOT NULL DEFAULT 0,
            llm_calls_cached        int NOT NULL DEFAULT 0,
            llm_calls_billed        int NOT NULL DEFAULT 0,
            llm_cost_pence          int NOT NULL DEFAULT 0,
            distinct_users          int NOT NULL DEFAULT 0,
            distinct_ip_hashes      int NOT NULL DEFAULT 0,
            cap_pence               int NOT NULL,
            paused_at               timestamptz,
            resumed_at              timestamptz
        )
    """)

    # -------------------------------------------------------------------------
    # meta.suppression_list (GDPR erasure requests)
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE meta.suppression_list (
            id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            kind        text NOT NULL,
            identifier  text NOT NULL,
            reason      text,
            added_at    timestamptz NOT NULL DEFAULT now(),
            added_by    text NOT NULL,
            UNIQUE (kind, identifier)
        )
    """)

    # -------------------------------------------------------------------------
    # public.watchlists (v2 schema reserved)
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE public.watchlists (
            id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id     uuid NOT NULL REFERENCES public.users(id),
            name        text NOT NULL,
            created_at  timestamptz NOT NULL DEFAULT now(),
            is_archived boolean NOT NULL DEFAULT false
        )
    """)

    op.execute("""
        CREATE TABLE public.watchlist_items (
            id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            watchlist_id    uuid NOT NULL REFERENCES public.watchlists(id) ON DELETE CASCADE,
            kind            text NOT NULL,
            identifier      text NOT NULL,
            added_at        timestamptz NOT NULL DEFAULT now(),
            UNIQUE (watchlist_id, kind, identifier)
        )
    """)

    op.execute("""
        CREATE TABLE public.alerts (
            id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            watchlist_item_id   uuid NOT NULL REFERENCES public.watchlist_items(id) ON DELETE CASCADE,
            event_id            bigint NOT NULL,
            delivered_at        timestamptz,
            delivery_channel    text
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.alerts CASCADE")
    op.execute("DROP TABLE IF EXISTS public.watchlist_items CASCADE")
    op.execute("DROP TABLE IF EXISTS public.watchlists CASCADE")
    op.execute("DROP TABLE IF EXISTS meta.suppression_list CASCADE")
    op.execute("DROP TABLE IF EXISTS meta.quotas_daily CASCADE")
    op.execute("DROP TABLE IF EXISTS audit.llm_calls CASCADE")
    op.execute("DROP TABLE IF EXISTS public.subscriptions CASCADE")
    op.execute("DROP TABLE IF EXISTS public.users CASCADE")
    op.execute("DROP TABLE IF EXISTS public.anomalies CASCADE")
    op.execute("DROP TABLE IF EXISTS public.ai_summaries CASCADE")
    op.execute("DROP TABLE IF EXISTS audit.events CASCADE")
    op.execute("DROP TABLE IF EXISTS public.financials CASCADE")
    op.execute("DROP TABLE IF EXISTS public.charges CASCADE")
    op.execute("DROP TABLE IF EXISTS public.psc CASCADE")
    op.execute("DROP TABLE IF EXISTS public.filings CASCADE")
    op.execute("DROP TABLE IF EXISTS public.appointments CASCADE")
    op.execute("DROP TABLE IF EXISTS public.officers CASCADE")
    op.execute("DROP TABLE IF EXISTS public.companies CASCADE")
    op.execute("DROP SCHEMA IF EXISTS meta CASCADE")
    op.execute("DROP SCHEMA IF EXISTS audit CASCADE")
