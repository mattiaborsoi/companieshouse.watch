# Data Model

> Companion to `BUILD_PLAN.md`. This is the authoritative schema reference. If a service touches the database, it follows what is written here. Schema changes happen via migrations and update this document in the same commit.

---

## 0. Conventions

- **Primary keys** use the source-of-truth identifier where one exists (e.g. `company_number`). Otherwise UUIDs (`uuid_generate_v4()`).
- **Timestamps** are `timestamptz`, always UTC. Column names end in `_at` (point in time) or `_on` (date). Never store local time.
- **Money** is stored in **pence** as `bigint`. Never floats. Never decimal-money types in v1 — pence integers are unambiguous.
- **JSONB raw blobs** are kept on every entity for forward-compatibility. If Companies House adds a new field, we already have it. The cost is storage; the benefit is not having to backfill.
- **Soft deletes** with `deleted_at timestamptz` only where business logic requires it. Most tables are append-only or upsert-by-natural-key.
- **No `ON DELETE CASCADE` across the public data tables.** We never want a delete to silently fan out across registry data. Use application logic.
- **Naming**: snake_case, plural table names (`companies`, `officers`, `filings`), singular column names. Foreign keys end in `_id` or use the natural-key column name (`company_number`).
- **Schema separation**: `public` for everything user-facing; `audit` for `llm_calls`, `events`, and similar; `meta` for migrations and operational tables.

---

## 1. Source-of-truth and idempotency

Every record from Companies House arrives multiple times — via the stream, via on-demand REST hydration, sometimes via bulk files. The data model must make duplicate ingestion safe.

The rule: **upsert by natural key, never insert blindly.** The natural keys are:

| Entity | Natural key |
|---|---|
| Company | `company_number` |
| Filing | `transaction_id` |
| Officer appointment | `(company_number, companies_house_officer_link, appointed_on)` |
| PSC | `(company_number, links.self)` (Companies House's own opaque ID) |
| Charge | `charge_id` |
| Financials period | `(company_number, period_end)` |

The `events` table is the **only** append-only public-data table. It is the audit log of what arrived when, never deduplicated.

---

## 2. Schema: `public.companies`

```sql
CREATE TABLE public.companies (
  company_number       text PRIMARY KEY,
  name                 text NOT NULL,
  name_normalised      text NOT NULL,             -- lowercased, punctuation stripped, for search
  status               text NOT NULL,             -- 'active', 'dissolved', 'liquidation', etc.
  status_detail        text,                      -- granular sub-status from CH
  type                 text NOT NULL,             -- 'ltd', 'plc', 'llp', 'private-unlimited', etc.
  jurisdiction         text NOT NULL,             -- 'england-wales', 'scotland', 'northern-ireland'

  incorporated_on      date,
  dissolved_on         date,                      -- NULL if still active
  ceased_on            date,                      -- catch-all for non-dissolution closures

  registered_address   jsonb NOT NULL DEFAULT '{}'::jsonb,
                                                  -- shape: {address_line_1, address_line_2,
                                                  -- locality, region, postal_code, country}
  registered_address_postcode text,               -- denormalised for index, lowercased no-space
  registered_address_hash     text,               -- normalised address hash, see §10

  sic_codes            text[] NOT NULL DEFAULT '{}',

  has_charges          boolean NOT NULL DEFAULT false,
  has_insolvency       boolean NOT NULL DEFAULT false,
  has_been_liquidated  boolean NOT NULL DEFAULT false,

  accounts_next_due    date,
  accounts_last_made_up_to date,
  confirmation_next_due date,

  raw                  jsonb NOT NULL,            -- full last-seen REST payload
  raw_etag             text,

  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_full_refresh_at timestamptz,               -- last time we hit /company/{number} REST
  last_event_at        timestamptz,               -- last time any stream event touched this row

  CONSTRAINT companies_jurisdiction_check
    CHECK (jurisdiction IN ('england-wales', 'scotland', 'northern-ireland', 'european',
                            'united-kingdom', 'wales', 'channel-islands'))
);
```

### Indexes

```sql
CREATE INDEX companies_name_trgm_idx
  ON public.companies USING gin (name_normalised gin_trgm_ops);
                                                  -- trigram for fuzzy search; requires pg_trgm

CREATE INDEX companies_name_fts_idx
  ON public.companies USING gin (to_tsvector('english', name));

CREATE INDEX companies_status_idx ON public.companies (status);
CREATE INDEX companies_postcode_idx ON public.companies (registered_address_postcode);
CREATE INDEX companies_address_hash_idx ON public.companies (registered_address_hash);
CREATE INDEX companies_incorporated_idx ON public.companies (incorporated_on DESC);
CREATE INDEX companies_sic_gin_idx ON public.companies USING gin (sic_codes);
CREATE INDEX companies_last_event_idx ON public.companies (last_event_at DESC);
```

### Notes
- `raw` exists so we never re-hit the REST API to recover a field we forgot to extract. It also makes adding columns cheap — backfill from `raw` rather than re-fetching.
- `name_normalised` is computed on write (trigger or app code, **`[DECISION]`** prefer app code so it's testable). Strips `LIMITED`, `LTD`, `LLP`, `PLC`, common punctuation, and lowercases. Used for search and dedup heuristics.
- `registered_address_hash` is the key for anomaly detection. Spec for the normaliser is in §10.
- `last_event_at` lets the live feed query "what changed in the last hour" without hitting the events table.

---

## 3. Schema: `public.officers` and `public.appointments`

A subtle modelling choice: in v1 we **do not do entity resolution** across appointments. Each appointment belongs to a single officer record as Companies House represents it. Entity resolution is v2 work and is too risky to half-build (see Risks in `BUILD_PLAN.md`).

So in v1, `officers` is essentially a denormalised cache keyed on the `companies_house_officer_link` (the opaque appointment-bound ID Companies House uses). Two appointments by "John Smith" at two companies will appear as two officers unless they happen to share the same link, which is rare.

```sql
CREATE TABLE public.officers (
  officer_id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ch_officer_link      text NOT NULL UNIQUE,      -- Companies House officer URL fragment

  forename             text,
  other_forenames      text,
  surname              text NOT NULL,
  honorific            text,
  name_full            text NOT NULL,             -- as filed
  name_normalised      text NOT NULL,             -- for search

  date_of_birth_year   int,                       -- CH only publishes year + month
  date_of_birth_month  int CHECK (date_of_birth_month BETWEEN 1 AND 12),

  nationality          text,
  country_of_residence text,
  occupation           text,

  raw                  jsonb NOT NULL,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_event_at        timestamptz
);

CREATE INDEX officers_surname_idx ON public.officers (lower(surname));
CREATE INDEX officers_name_trgm_idx
  ON public.officers USING gin (name_normalised gin_trgm_ops);
CREATE INDEX officers_dob_idx
  ON public.officers (date_of_birth_year, date_of_birth_month);
```

```sql
CREATE TABLE public.appointments (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_number       text NOT NULL REFERENCES public.companies(company_number),
  officer_id           uuid NOT NULL REFERENCES public.officers(officer_id),

  role                 text NOT NULL,             -- 'director', 'secretary', 'llp-member', etc.
  appointed_on         date,
  resigned_on          date,
  is_pre_1992          boolean NOT NULL DEFAULT false,
                                                  -- some old appointments have no appointed_on

  appointed_address    jsonb,                     -- correspondence address at time of appointment
  raw                  jsonb NOT NULL,

  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_event_at        timestamptz,

  UNIQUE (company_number, officer_id, role, appointed_on)
);

CREATE INDEX appointments_company_idx
  ON public.appointments (company_number, appointed_on DESC NULLS LAST);
CREATE INDEX appointments_officer_idx
  ON public.appointments (officer_id, appointed_on DESC NULLS LAST);
CREATE INDEX appointments_active_idx
  ON public.appointments (company_number) WHERE resigned_on IS NULL;
```

### Notes
- The `UNIQUE` constraint allows `appointed_on IS NULL` to appear multiple times (Postgres treats NULLs as distinct in unique constraints). This is correct for pre-1992 appointments where we have no date.
- `is_pre_1992` is a flag rather than inferred from a NULL date because we want explicit semantics.
- Entity resolution work in v2 will introduce a separate `person_clusters` table that maps multiple `officer_id`s to a single inferred person. The current schema is not blocked by deferring this.

---

## 4. Schema: `public.filings`

```sql
CREATE TABLE public.filings (
  transaction_id       text PRIMARY KEY,          -- CH's globally unique filing ID
  company_number       text NOT NULL REFERENCES public.companies(company_number),

  category             text NOT NULL,             -- 'accounts', 'officers', 'capital', etc.
  type                 text NOT NULL,             -- e.g. 'AA', 'CS01', 'AP01', 'SH01'
  subcategory          text,                      -- CH's optional subcategory
  description          text NOT NULL,             -- human description from CH
  description_values   jsonb NOT NULL DEFAULT '{}'::jsonb,
                                                  -- variables used in description templating

  filing_date          date NOT NULL,             -- date of the filing event
  action_date          date,                      -- date the action took effect (e.g. AGM date)

  paper_filed          boolean NOT NULL DEFAULT false,
  pages                int,

  document_metadata_url text,                     -- CH document API URL
  has_pdf              boolean NOT NULL DEFAULT false,
  has_xbrl             boolean NOT NULL DEFAULT false,

  raw                  jsonb NOT NULL,
  ingested_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX filings_company_date_idx
  ON public.filings (company_number, filing_date DESC);
CREATE INDEX filings_type_idx ON public.filings (type, filing_date DESC);
CREATE INDEX filings_category_idx ON public.filings (category, filing_date DESC);
CREATE INDEX filings_recent_idx ON public.filings (ingested_at DESC);
```

### Notes
- We do not store the PDF or XBRL content here. PDFs are fetched lazily and cached in R2; XBRL is parsed into `financials` (§7).
- `description_values` is what makes filing descriptions readable: CH stores a template like `"Statement of capital following an allotment of shares on {date}"` plus the variables; we render server-side.
- Filing types we care about most for the live feed: `IN01` (incorporation), `AP01`/`AP02`/`AP03`/`AP04` (appointments), `TM01`/`TM02` (resignations), `SH01` (share allotment), `MR01` (charge created), `LIQ` family (insolvency), `DS01`/`DS02` (dissolution). Build a UI-friendly type → label mapping in the app, not the DB.

---

## 5. Schema: `public.psc` (persons with significant control)

```sql
CREATE TABLE public.psc (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ch_psc_link          text NOT NULL UNIQUE,      -- CH's links.self

  company_number       text NOT NULL REFERENCES public.companies(company_number),
  kind                 text NOT NULL,             -- 'individual-person-with-significant-control',
                                                  -- 'corporate-entity-...', 'legal-person-...',
                                                  -- 'super-secure-person-...' (full anonymity),
                                                  -- 'individual-beneficial-owner', etc.

  name                 text,
  name_elements        jsonb,                     -- forename/surname for individuals
  is_anonymised        boolean NOT NULL DEFAULT false,

  natures_of_control   text[] NOT NULL DEFAULT '{}',
                                                  -- 'ownership-of-shares-25-to-50-percent', etc.

  notified_on          date,
  ceased_on            date,

  date_of_birth_year   int,
  date_of_birth_month  int,
  nationality          text,
  country_of_residence text,

  -- For corporate PSCs:
  identification       jsonb,                     -- registration number, country, etc.

  raw                  jsonb NOT NULL,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_event_at        timestamptz
);

CREATE INDEX psc_company_idx ON public.psc (company_number);
CREATE INDEX psc_active_idx ON public.psc (company_number) WHERE ceased_on IS NULL;
CREATE INDEX psc_kind_idx ON public.psc (kind);
CREATE INDEX psc_nationality_idx ON public.psc (nationality)
  WHERE ceased_on IS NULL AND kind LIKE 'individual%';
```

### Notes
- "Super-secure" PSCs are individuals with verified protection (e.g. domestic abuse survivors). `is_anonymised` flags these. **We display nothing about super-secure PSCs beyond the fact they exist.** This is non-negotiable; getting it wrong is a safeguarding failure, not a data quality issue.
- Corporate PSCs link to other entities; we do not auto-resolve them in v1 but the `identification` JSONB lets us do it later.

---

## 6. Schema: `public.charges` (deferred to v2 ingestion, schema reserved)

```sql
CREATE TABLE public.charges (
  charge_id            text PRIMARY KEY,
  company_number       text NOT NULL REFERENCES public.companies(company_number),
  status               text NOT NULL,             -- 'outstanding', 'fully-satisfied', etc.
  created_on           date,
  delivered_on         date,
  satisfied_on         date,
  classification       jsonb,
  particulars          jsonb,
  persons_entitled     jsonb,
  raw                  jsonb NOT NULL,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_event_at        timestamptz
);

CREATE INDEX charges_company_idx ON public.charges (company_number);
CREATE INDEX charges_outstanding_idx ON public.charges (company_number)
  WHERE status = 'outstanding';
```

Schema is created in Phase 1 even though ingestion is Phase 4 — saves a migration later.

---

## 7. Schema: `public.financials` (XBRL-derived)

XBRL parsing produces structured figures from electronically-filed accounts. About 75% of accounts come in this form.

```sql
CREATE TABLE public.financials (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_number       text NOT NULL REFERENCES public.companies(company_number),
  transaction_id       text REFERENCES public.filings(transaction_id),

  period_start         date,
  period_end           date NOT NULL,
  reporting_standard   text,                      -- 'frs102', 'frs105', 'ifrs', etc.
  is_consolidated      boolean NOT NULL DEFAULT false,
  is_dormant           boolean NOT NULL DEFAULT false,
  currency             text NOT NULL DEFAULT 'GBP',

  -- Headline figures, all in pence:
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

  employees_average    int,

  raw_xbrl_url         text,                      -- R2 path to the source XBRL file
  parser_version       text NOT NULL,             -- which version of our parser produced this
  parsed_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_number, period_end, is_consolidated)
);

CREATE INDEX financials_company_period_idx
  ON public.financials (company_number, period_end DESC);
```

### Notes
- We deliberately store only ~12 headline figures in v1. XBRL exposes thousands of tagged facts; resist the temptation to extract everything until there's a feature that needs it.
- `parser_version` lets us re-process old filings when we improve extraction without losing the previous parse.
- Currency is stored even though almost everything is GBP. Some companies file in EUR/USD; mixing currencies silently is a footgun.
- Dormant companies have many NULL figures; that's fine — they're informational, not faulty.

---

## 8. Schema: `audit.events`

The append-only log of everything that arrived from Companies House. No updates, no deletes.

```sql
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE audit.events (
  id                   bigserial PRIMARY KEY,
  source               text NOT NULL,             -- 'stream:companies', 'stream:filing-history',
                                                  -- 'stream:officers', 'stream:psc',
                                                  -- 'rest:hydrate', 'bulk:accounts'
  resource_kind        text NOT NULL,
  resource_id          text NOT NULL,
  resource_uri         text,
  ch_timepoint         bigint,                    -- stream timepoint for replay
  published_at         timestamptz NOT NULL,
  fields_changed       text[] NOT NULL DEFAULT '{}',
  payload              jsonb NOT NULL,
  received_at          timestamptz NOT NULL DEFAULT now(),
  processed_at         timestamptz,
  processing_error     text
);

CREATE INDEX events_resource_idx
  ON audit.events (resource_kind, resource_id, received_at DESC);
CREATE INDEX events_unprocessed_idx
  ON audit.events (received_at) WHERE processed_at IS NULL;
CREATE INDEX events_published_idx ON audit.events (published_at DESC);
CREATE INDEX events_timepoint_idx ON audit.events (ch_timepoint)
  WHERE source LIKE 'stream:%';
```

### Notes
- This table grows fast — millions of rows per month. **Set up partitioning by `received_at` month from day one.** Use Postgres declarative partitioning.
- Retention: keep 90 days of raw events. After that, `payload` is dropped (set to NULL) but the row is kept for audit. Monthly summary stats live in `meta.events_monthly_stats`.
- The stream timepoint is critical for graceful restarts. The streamer persists the latest processed timepoint to Redis; on restart, it resumes from there. Without this, a 60-second restart loses 60 seconds of events.

---

## 9. Schema: `public.anomalies`

```sql
CREATE TABLE public.anomalies (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind                 text NOT NULL,             -- v1: 'address_cluster' only
  detection_key        text NOT NULL,             -- e.g. address_hash for address_cluster

  first_detected_at    timestamptz NOT NULL DEFAULT now(),
  last_detected_at     timestamptz NOT NULL DEFAULT now(),
  is_currently_flagged boolean NOT NULL DEFAULT true,

  score                int NOT NULL CHECK (score BETWEEN 0 AND 100),
  features             jsonb NOT NULL,            -- the inputs: counts, ratios, top directors, etc.

  ai_summary_id        uuid REFERENCES public.ai_summaries(id),
                                                  -- nullable until the LLM has run

  takedown_requested_at timestamptz,              -- if someone asks us to remove
  takedown_resolved_at  timestamptz,
  takedown_action      text,                      -- 'removed', 'kept-with-edit', 'kept'
  takedown_notes       text,

  UNIQUE (kind, detection_key)
);

CREATE INDEX anomalies_active_idx ON public.anomalies (score DESC)
  WHERE is_currently_flagged = true AND takedown_action IS DISTINCT FROM 'removed';
CREATE INDEX anomalies_kind_idx ON public.anomalies (kind, last_detected_at DESC);
```

### Notes
- One row per detection key, **not** one row per detection run. The cron job upserts: if the cluster still meets the threshold, update `last_detected_at` and `score`; if it no longer meets it, set `is_currently_flagged = false`.
- Anomalies are never hard-deleted, even after a takedown. We need the audit trail.
- `features` JSONB is the structured input that gets fed to the LLM. Storing it lets us reproduce the AI explanation if we change the prompt.

---

## 10. Address normalisation (the hash that powers anomaly detection)

The anomaly product stands or falls on whether two addresses for the same physical location collide to the same hash. Companies House does no normalisation, so the same flat appears as:
- `Flat 12, 4 Acacia Avenue, London, N1 7AB`
- `12 Acacia Ave, London, N17AB`
- `Flat 12, 4 Acacia Avenue, LONDON, N1 7AB, UNITED KINGDOM`
- `4 Acacia Avenue, Flat 12, London, N1 7AB`

The v1 normaliser is deliberately simple. Sophistication is v2 work.

### Algorithm (v1)
1. Lowercase everything.
2. Strip punctuation except numbers and spaces.
3. Replace common abbreviations: `ave` → `avenue`, `rd` → `road`, `st` → `street`, `ln` → `lane`, `cl` → `close`, `ct` → `court`, etc.
4. Collapse whitespace.
5. Drop trailing `united kingdom`, `england`, `scotland`, `wales`, `northern ireland`.
6. Extract postcode using regex (`/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i`), normalise to `SW1A 1AA` form.
7. Compute hash = SHA1 of `{normalised_first_line}|{postcode}`.

```python
def normalise_address(addr: dict) -> tuple[str, str]:
    # returns (hash, human_readable_normalised)
    ...
```

### Properties
- Idempotent: `normalise(normalise(x)) == normalise(x)`.
- Postcode-anchored: addresses with no postcode hash to a sentinel value `nopostcode:{first_line_hash}` and are bucketed separately. They are not used for anomaly detection in v1 — too noisy.
- Implemented as a Python pure function with comprehensive tests. The test set lives in `apps/worker/tests/test_address_normaliser.py` and includes:
  - At least 50 hand-curated equivalent-pair cases.
  - At least 20 should-NOT-collide cases (e.g. flats in the same building).
  - Real bad inputs sampled from production (UTF-8 weirdness, all-caps, all-lowercase, missing fields).

### When to use libpostal
Don't, in v1. `libpostal` is a 2GB model and adds deployment complexity. If the simple normaliser produces too many false positives or negatives in production, consider it for v2.

---

## 11. Schema: `public.ai_summaries`

The canonical cache for all LLM outputs. Anything generated by the LLM lives here — and only here. Other tables reference it by foreign key.

```sql
CREATE TABLE public.ai_summaries (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  kind                 text NOT NULL,             -- 'company_narrative', 'anomaly_explanation',
                                                  -- 'filing_one_liner', etc.
  prompt_version       text NOT NULL,             -- 'company_narrative_v1', 'anomaly_v2', etc.
  input_hash           text NOT NULL,             -- SHA256 of (prompt_version + canonical inputs)

  model                text NOT NULL,             -- exact model string
  output               text NOT NULL,
  output_format        text NOT NULL DEFAULT 'plain',
                                                  -- 'plain', 'markdown', 'json'

  input_tokens         int NOT NULL,
  output_tokens        int NOT NULL,
  cost_pence           int NOT NULL,              -- exact cost at generation time

  generated_at         timestamptz NOT NULL DEFAULT now(),
  superseded_by        uuid REFERENCES public.ai_summaries(id),
                                                  -- when prompt is bumped, link to new version

  UNIQUE (kind, prompt_version, input_hash)
);

CREATE INDEX ai_summaries_kind_idx ON public.ai_summaries (kind, generated_at DESC);
```

### Notes
- The `(kind, prompt_version, input_hash)` unique constraint is what makes the cache work. Identical inputs to the same prompt version always produce one row.
- `superseded_by` lets us regenerate against a new prompt version without losing the old output (which may still be displayed for users who saw it before the bump).
- `cost_pence` is recorded at generation time for honesty. If Anthropic changes pricing later, our historical numbers don't shift.

---

## 12. Schema: `audit.llm_calls`

Every call to the LLM gateway is logged here, including cache hits.

```sql
CREATE TABLE audit.llm_calls (
  id                   bigserial PRIMARY KEY,

  ai_summary_id        uuid REFERENCES public.ai_summaries(id),
                                                  -- non-NULL on actual calls and cache hits
  kind                 text NOT NULL,
  prompt_version       text NOT NULL,

  user_id              uuid REFERENCES public.users(id),
                                                  -- NULL for anonymous
  ip_hash              text,                      -- for anonymous rate limiting
  source               text NOT NULL,             -- 'web', 'api', 'cron'

  model                text,
  input_tokens         int,
  output_tokens        int,
  cost_pence           int NOT NULL DEFAULT 0,    -- 0 for cache hits
  cached_hit           boolean NOT NULL,
  outcome              text NOT NULL,
                                                  -- 'success', 'cached', 'quota_exceeded',
                                                  -- 'platform_paused', 'rate_limited',
                                                  -- 'api_error', 'timeout'

  latency_ms           int,
  error_message        text,

  called_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX llm_calls_user_idx ON audit.llm_calls (user_id, called_at DESC);
CREATE INDEX llm_calls_ip_idx ON audit.llm_calls (ip_hash, called_at DESC);
CREATE INDEX llm_calls_called_idx ON audit.llm_calls (called_at DESC);
CREATE INDEX llm_calls_outcome_idx ON audit.llm_calls (outcome, called_at DESC);
```

### Notes
- Partitioned by `called_at` month, like `events`.
- Retention: 12 months of full detail, then aggregated to `meta.llm_calls_monthly_stats` and the row is dropped.
- `ip_hash` is `sha256(ip || daily_salt)`. Daily-rotated salt makes the hashes unjoinable across days, so we have rate-limit utility but not long-term tracking. Salt lives in Redis.

---

## 13. Schema: `public.users`, `public.subscriptions`, `public.quotas_daily`

```sql
CREATE TABLE public.users (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email                citext NOT NULL UNIQUE,    -- citext for case-insensitive uniqueness
  email_verified_at    timestamptz,
  display_name         text,

  plan                 text NOT NULL DEFAULT 'free',
                                                  -- 'free', 'pro'
  stripe_customer_id   text UNIQUE,

  created_at           timestamptz NOT NULL DEFAULT now(),
  last_active_at       timestamptz,

  is_banned            boolean NOT NULL DEFAULT false,
  ban_reason           text,

  CONSTRAINT users_plan_check CHECK (plan IN ('free', 'pro'))
);

CREATE TABLE public.subscriptions (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              uuid NOT NULL REFERENCES public.users(id),
  stripe_subscription_id text UNIQUE,
  status               text NOT NULL,
                                                  -- 'active', 'past_due', 'canceled', 'trialing'
  plan                 text NOT NULL,
  current_period_end   timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  raw                  jsonb NOT NULL,            -- last Stripe webhook payload
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_user_idx ON public.subscriptions (user_id, status);
```

```sql
-- Daily roll-up for the operations dashboard. Updated nightly.
CREATE TABLE meta.quotas_daily (
  date                 date PRIMARY KEY,
  llm_calls_total      int NOT NULL DEFAULT 0,
  llm_calls_cached     int NOT NULL DEFAULT 0,
  llm_calls_billed     int NOT NULL DEFAULT 0,
  llm_cost_pence       int NOT NULL DEFAULT 0,
  distinct_users       int NOT NULL DEFAULT 0,
  distinct_ip_hashes   int NOT NULL DEFAULT 0,
  cap_pence            int NOT NULL,
  paused_at            timestamptz,
  resumed_at           timestamptz
);
```

### Notes
- `users.plan` is denormalised from the latest active `subscriptions` row. A trigger keeps it in sync. Yes, this is duplication; it's worth it because `users.plan` is read on every authed request.
- We don't store passwords. Authentication is email magic-link only in v1.
- `is_banned` exists for abuse mitigation. Banned users can still browse (we won't gatekeep public data) but cannot trigger AI generations.

---

## 14. Schema: `public.watchlists` (v2, schema reserved)

```sql
CREATE TABLE public.watchlists (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              uuid NOT NULL REFERENCES public.users(id),
  name                 text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  is_archived          boolean NOT NULL DEFAULT false
);

CREATE TABLE public.watchlist_items (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  watchlist_id         uuid NOT NULL REFERENCES public.watchlists(id) ON DELETE CASCADE,
  kind                 text NOT NULL,             -- 'company', 'officer', 'address'
  identifier           text NOT NULL,             -- company_number, officer_id, or address_hash
  added_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watchlist_id, kind, identifier)
);

CREATE TABLE public.alerts (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  watchlist_item_id    uuid NOT NULL REFERENCES public.watchlist_items(id) ON DELETE CASCADE,
  event_id             bigint NOT NULL REFERENCES audit.events(id),
  delivered_at         timestamptz,
  delivery_channel     text,                      -- 'email', 'webhook'
);
```

`ON DELETE CASCADE` is allowed here because watchlists are user-owned data, not registry data.

---

## 15. Migrations

- One tool: **`alembic`** (Python). The streamer, worker, and gateway are all Python; the web app uses generated TypeScript types from the schema, so the schema lives where the migrations run.
- Migrations are forward-only in production. Down-migrations exist for development convenience but are never relied on.
- Every migration file has a one-paragraph comment explaining *why*, not just *what*.
- Schema changes require updating this document **in the same commit**. Reviewer rejects PRs that don't.

```
/packages/db
  /migrations
    20260101_0001_initial.py
    20260108_0002_add_address_hash.py
    ...
  /sql
    address_normaliser.sql        -- the SQL helper functions (if any)
    materialised_views.sql        -- v2
  alembic.ini
```

---

## 16. Materialised views (deferred)

For v1, we query base tables directly and rely on indexes. Materialised views are a v2 optimisation if (and only if) specific queries become slow.

Candidates we'll consider:
- `mv_address_clusters` — precomputed address-cluster scores, refreshed every 10 minutes.
- `mv_recent_filings` — last 24 hours, optimised for the live feed.
- `mv_director_appointment_counts` — precomputed for officer pages.

Don't pre-build these. Wait for evidence of need.

---

## 17. Backups and disaster recovery

- **Postgres**: Daily automated backups via the managed provider (Neon has point-in-time recovery for 7 days on the free tier; pay for 30 if traffic justifies). Weekly logical dump (`pg_dump`) to R2 with 90-day retention.
- **Redis**: Treated as ephemeral. Everything reconstructible from Postgres + the stream timepoint persisted to Redis itself (we accept losing up to a few minutes of stream events on Redis loss).
- **R2**: Durable by default. We don't back this up separately.
- **Disaster scenario**: Full Postgres loss. Recovery: restore from latest dump, then re-run streamer from `last_known_timepoint - 1 hour` to fill the gap. Acceptable RTO: 4 hours. Acceptable RPO: 1 hour.

---

## 18. Privacy, GDPR, and erasure

Everything in this database is public-by-statute under the Companies Act 2006 and published under the OGL v3.0. We are processing public data for journalistic/research purposes (Article 85 of the GDPR / Schedule 2 of the DPA 2018).

But:

- **Officer dates of birth**: Companies House publishes year + month, not day. We replicate this exactly. **We never store full DoB even if we receive it.** Add a check to the ingestion pipeline.
- **Super-secure PSCs**: Detected by `kind LIKE 'super-secure%'`. We store the existence of the record but redact name, dates, and addresses on display. The schema allows this — the application layer enforces the redaction.
- **Erasure requests**: Even though the data is public-by-statute, we honour erasure requests where the requester has good reason (e.g. address suppression already granted by Companies House). Process:
  1. User emails us with the request.
  2. We verify with Companies House that the data has been suppressed there.
  3. We add the entity to a `meta.suppression_list` table.
  4. The application layer filters suppressed entities from all read paths.
  5. We do **not** delete from Postgres — the audit log still needs to exist. We just don't show.
- **Right to access**: We log enough about each user (auth events, AI generations) that a SAR returns useful data within 30 days. This is mostly an operational concern; the data model supports it.

```sql
CREATE TABLE meta.suppression_list (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind                 text NOT NULL,             -- 'officer', 'company', 'address'
  identifier           text NOT NULL,
  reason               text,
  added_at             timestamptz NOT NULL DEFAULT now(),
  added_by             text NOT NULL,
  UNIQUE (kind, identifier)
);
```

---

## 19. Operational queries (canonical examples)

These are the queries the application runs hot. They should each return in <100ms on the indexed schema.

### Live feed (last hour)
```sql
SELECT f.*, c.name, c.status
FROM public.filings f
JOIN public.companies c ON c.company_number = f.company_number
WHERE f.ingested_at > now() - interval '1 hour'
ORDER BY f.ingested_at DESC
LIMIT 100;
```

### Company profile filings
```sql
SELECT * FROM public.filings
WHERE company_number = $1
ORDER BY filing_date DESC
LIMIT 50;
```

### Address cluster detection
```sql
SELECT registered_address_hash,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE incorporated_on > now() - interval '30 days') AS recent,
       COUNT(*) FILTER (WHERE status = 'dissolved') AS dissolved,
       COUNT(*) FILTER (WHERE status = 'active') AS active
FROM public.companies
WHERE registered_address_hash IS NOT NULL
GROUP BY registered_address_hash
HAVING COUNT(*) FILTER (WHERE incorporated_on > now() - interval '30 days') >= 10
ORDER BY recent DESC
LIMIT 200;
```

### Search (companies)
```sql
SELECT company_number, name, status,
       similarity(name_normalised, $1) AS sim
FROM public.companies
WHERE name_normalised % $1
ORDER BY sim DESC, status = 'active' DESC
LIMIT 20;
```
