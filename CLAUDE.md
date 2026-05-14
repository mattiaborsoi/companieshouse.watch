# CLAUDE.md — Project context for AI-assisted development

This file exists so that Claude Code can pick up this project cold in a new conversation without losing context. Keep it updated as the project evolves.

---

## What this project is

**companieshouse.watch** — a free, open-source, real-time UK Companies House tracker with AI anomaly detection. Targeting journalists, OSINT researchers, and fraud/compliance analysts.

Core pitch: live feed of every UK company filing/officer/PSC change, with address-clustering anomaly detection and Anthropic-powered plain-English explanations of suspicious patterns.

Full spec is in `BUILD_PLAN.md` (architecture, phases, AI policy) and `DATA_MODEL.md` (full Postgres schema).

---

## Current implementation state

**Phases 1–3 complete + Phase C (decoupled hydration) + assorted Phase-4-ish enrichments.**
The site is live at https://ch.borsoi.co.uk on a DigitalOcean droplet (`infra/docker/docker-compose.yml`).
Data is streaming continuously from Companies House.

### Phase 1 — Data pipeline (complete)
- `infra/docker/docker-compose.yml` — full stack (Postgres 16, Redis 7, streamer, worker, web, migrate, test)
- `packages/db/alembic/` — Alembic migrations with the complete schema
- `apps/streamer/` — Python 3.12 process consuming the CH streaming API (companies, officers, PSC; filing-history stream 503 from CH side — server outage, not our code)
- `apps/worker/` — arq worker processing events, upserting into Postgres
- `apps/worker/src/worker/normaliser.py` — address normaliser (89 tests, all passing)
- `apps/worker/src/worker/backfill.py` — pulls ~1000 companies from CH REST API for dev data (`make backfill`)

### Phase 2 — Web UI (complete)
- `apps/web/` — Next.js 15 (App Router), TypeScript, Tailwind CSS
- `apps/web/src/app/page.tsx` — landing page with stats, recent filings table, SSE live ticker
- `apps/web/src/app/feed/` — `/feed` page: full live feed with category filters and pause button
- `apps/web/src/app/c/[number]/` — `/c/{number}` company profile: header, filings, officers, PSCs
- `apps/web/src/app/search/` — `/search?q=` page: name/number ILIKE search
- `apps/web/src/app/api/events/` — SSE endpoint polling Postgres for new filings every 5s
- `apps/web/src/lib/db.ts` — typed queries (postgres npm package, camelCase transform)

### Phase 3 — Anomaly detection + LLM gateway (complete)
- `apps/llm-gateway/` — FastAPI service: input-hash cache → Redis spend caps → Anthropic Haiku → `ai_summaries` + `audit.llm_calls`. Hard caps: £5/day, £100/month.
- `apps/worker/src/worker/anomaly_detector.py` — arq cron every 10 min, SQL address clustering, scores 0–100, upserts `public.anomalies`. No LLM calls — AI is on-demand only.
- `apps/worker/src/worker/director_velocity.py` — arq cron, flags officers with many active appointments; kind=`director_velocity`.
- `apps/worker/src/worker/officer_churn.py` — arq cron, flags companies with high officer appointment/resignation rate in 90 days; kind=`officer_churn`.
- `apps/worker/src/worker/bulk_registration.py` — arq cron, flags addresses with 10+ incorporations on the same day; kind=`bulk_registration`.
- `apps/web/src/app/anomalies/` — list page (scored clusters) + detail page (`/anomalies/[id]`) with company table, shared directors, and "Generate AI explanation" button. Handles all four anomaly kinds.
- `apps/web/src/app/api/anomalies/[id]/explain/` — Next.js API route that proxies to llm-gateway.

### Search enhancements (complete)
- `apps/web/src/app/search/` — company search with CH REST fallback, people/officer search with CH REST fallback (`searchChRestOfficers`), UK postcode detection (regex) that forces CH REST company lookup even when local results exist.
- `apps/web/src/lib/utils.ts` — `sicDescription(code)`: full UK SIC 2007 lookup (600+ codes + division-level fallback). `formatFilingDescription(type, description)`: checks `type` code first, then `description` slug, then human-readable description, then slug-converts `type`.
- Company profile `/c/[number]`: SIC codes show human-readable description, filing rows link directly to CH filing viewer (`find-and-update.company-information.service.gov.uk/company/{cn}/filing-history/{txId}`).
- Officer profile `/officer/[id]`: service address extracted from CH REST appointments response and displayed.
- Live feed `/feed`: client-side deduplication by `transactionId` (prevents duplicates on SSE reconnect after deploy).

### Phase 4 / enrichments (complete)
- **Identity resolution** (`packages/db/alembic/versions/..._0003_company_identity.py`) — `company_identity` table linking companies that share directors/addresses across renames.
- **Formation agent detection** — `known_addresses` table (migration 0002) flags addresses with 50+ active companies (typical formation-agent pattern).
- **Director continuity** (migration 0006) — `person_match_key` on officers + `appointments_history` for cross-company tracking.
- **Pattern badges** (migration 0007) — `company_patterns` table; multiple SQL detectors populate per-company badges (rapid director turnover, address reuse, dormant filings, etc.) visible on `/c/[number]`.
- **Press mentions** (migration 0008) — `company_press` + `company_press_resolutions`; HTTP fetcher with SSRF protection + per-domain rate limit + robots.txt awareness scrapes news headlines, displayed on company profile.
- **Favicon cache** (migration 0005) — `company_favicons` table; `/api/favicon/[number]` resolves real corporate-website favicons (cached, with feedback table for user corrections).

### Phase C — Decoupled hydration (complete)
- **Problem**: officer/PSC events for unknown companies used to retry 3× with 30s delay each, blocking worker slots for up to 5 min per failed event. Under any backlog this saturated arq.
- **Fix** (migration 0009 + `apps/worker/src/worker/deferred.py`): events for unknown companies go to `meta.deferred_events`. A separate cron rate-limit-aware drains the queue by fetching the missing companies from CH REST.
- **Daily GC at 04:00 UTC** deletes deferred rows older than 7 days.

### Search analytics + perf (complete)
- **`audit.searches`** (migration 0010, partitioned by month) — every search logged with query, query_type (`company_name | company_number | postcode | officer_name`), local + remote result counts, `had_results` flag, SHA-256-hashed IP for dedup. Fire-and-forget from `apps/web/src/app/search/page.tsx`.
- **`pg_trgm` GIN indexes** (migration 0011) on `companies.name_normalised` and `officers.name_full` — search queries route through `name_normalised` with per-word AND'd ILIKEs, giving ~30-100× speed-up vs raw seq-scan ILIKE.
- **Cross-tab nudge banner** on `/search`: when active tab has weak local matches, peek CH REST on the OTHER side so we can show "👤 N people also match" / "🏢 N companies also match" with a count.

### Caching & observability (complete)
- **Redis query cache** in `apps/web/src/lib/db.ts` (`cachedQuery()`): 60s TTL on `getStatusBar` (NavBar) and `getStats` (homepage stats grid). Silent fallback to live query on any cache error.
- **Redis maxmemory cap**: 512 MB with `volatile-lru` + `activedefrag yes` — prevents the `ch:rest:*` cache from filling the droplet's RAM (set in `infra/docker/docker-compose.yml`, applied live via CONFIG SET).
- **Per-page revalidate=60s** on `/c/[number]` and `/officer/[id]` for ISR.
- **Per-company OG/Twitter cards + meta description** via `generateMetadata()` and `buildCompanyDescription()` in `utils.ts`.

### Not yet built
- XBRL financials parser (the `public.financials` table exists but isn't populated)
- A proper analytics dashboard (query `audit.searches` directly until volume justifies it)
- Sitemap.xml (deferred SEO item)

**Web app runs on port 3030** in production (ports 3000 and 3001 were occupied by other containers on the dev machine).

---

## How to run everything

All services run in Docker. Never run Python apps directly on the host machine.

### First-time setup
```bash
# 1. Create local data directories (bind-mounted into containers)
make setup

# 2. Run database migrations
make infra          # start Postgres + Redis
make db-migrate     # apply schema

# 3. Start the full stack
make up
```

### Day-to-day
```bash
make up             # start all services (incl. web on :3030)
make down           # stop (data preserved on disk)
make logs           # tail all logs
make logs-streamer  # tail streamer only
make logs-worker    # tail worker only
make test           # run test suite in Docker
make db-shell       # psql shell
make ps             # container status
make backfill       # pull ~1000 companies from CH REST API into Postgres
```

### Web UI
Open http://localhost:3030 after `make up`.

### Rebuild after code changes
```bash
make build          # rebuild images
make up             # restart services
```

---

## Repo structure

```
/
  apps/
    streamer/           # Python: long-running CH stream consumer
      src/streamer/
        main.py         # asyncio, 4 concurrent stream tasks
        config.py       # pydantic-settings, reads from env
      Dockerfile
    worker/             # Python: arq worker
      src/worker/
        main.py         # WorkerSettings, startup/shutdown hooks
        upserts.py      # upsert_company, upsert_filing, etc.
        normaliser.py   # address normaliser (pure function, tested)
        ch_rest.py      # CH REST API wrapper
        backfill.py     # dev data seeder (~1000 companies from REST API)
        db.py           # asyncpg connection pool
        config.py
      tests/
        test_address_normaliser.py
      Dockerfile
    llm-gateway/        # Phase 3 — not yet created
    web/                # Next.js 15 frontend
      src/app/
        page.tsx        # landing page (SSE live ticker + stats)
        feed/           # /feed — live filing feed with filters
        c/[number]/     # /c/{number} — company profile
        search/         # /search?q= — name/number search
        about/          # /about
        api/events/     # SSE endpoint (polls Postgres every 5s)
      src/lib/
        db.ts           # typed Postgres queries (postgres npm)
        utils.ts        # date formatting, badge colours
      Dockerfile
  packages/
    db/
      alembic/
        versions/
          20260429_0001_initial.py             # full base schema
          20260430_0002_known_addresses.py     # formation-agent flagging
          20260430_0003_company_identity.py    # identity-resolution table
          20260430_0004_audit_events_retry_index.py
          20260430_0005_favicon_cache_feedback.py
          20260430_0006_director_continuity.py # person_match_key, appointments_history
          20260430_0007_company_patterns.py    # per-company badges
          20260430_0008_company_press.py       # press mentions + resolutions
          20260501_0009_deferred_events.py     # Phase C — meta.deferred_events
          20260513_0010_search_analytics.py    # audit.searches (partitioned)
          20260513_0011_pg_trgm_search_indexes.py
      alembic.ini
  infra/
    docker/
      docker-compose.yml
      Dockerfile.migrate
  data/                 # gitignored; created by `make setup`
    postgres/           # Postgres data files
    redis/              # Redis AOF
  docs/
    BUILD_PLAN.md       # Full architecture, phases, AI policy, decisions log
    DATA_MODEL.md       # Authoritative Postgres schema reference
    AI_POLICY.md        # LLM governance rules (non-negotiable)
    OPERATIONS.md       # Deployment and runbook
  .env                  # gitignored; secrets + local DB/Redis URLs
  .env.example          # committed; template for .env
  CLAUDE.md             # this file
  Makefile
  LICENSE               # MIT
```

---

## Environment variables

Defined in `.env` (gitignored). Docker Compose services receive them via the `environment:` section.

| Variable | Used by | Notes |
|---|---|---|
| `CH_REST_KEY` | streamer, worker, web | Companies House REST API key |
| `CH_STREAM_KEY` | streamer | Companies House streaming API key (separate credential) |
| `DATABASE_URL` | worker, web | asyncpg / postgres.js DSN; `postgres` hostname inside Docker |
| `DATABASE_URL_SYNC` | migrate | psycopg2 DSN for Alembic |
| `REDIS_URL` | streamer, worker, web | `redis://redis:6379/0` (worker db0), `/1` (web cache db1) inside Docker |
| `ANTHROPIC_API_KEY` | llm-gateway | never used directly by streamer/worker |
| `GATEWAY_API_KEY` | web → llm-gateway | Bearer token protecting `/spend` endpoint |
| `BRAVE_SEARCH_API_KEY` | worker | Brave Search API for company-website resolution |
| `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` | worker | Optional auto-poster |
| `SITE_URL` | worker | Used in Bluesky posts and `NEXT_PUBLIC_SITE_URL` default for web |

**Note**: the droplet has TWO `.env` files — `/opt/.../.env` (project root) and `/opt/.../infra/docker/.env`. Docker Compose invoked with `-f infra/docker/docker-compose.yml` reads from the **compose-file directory** by default. New secrets go in `infra/docker/.env`.

---

## Key technical decisions (from `BUILD_PLAN.md` decisions log)

| Decision | Choice | Reason |
|---|---|---|
| License | MIT | Widest adoption |
| Hosting | Docker Compose locally | Start simple; hosting decision deferred |
| Queue backend | arq | Fits existing Redis dependency |
| Address normalisation | Simple v1 (pure Python) | libpostal is 2GB, defer to v2 |
| Python version | 3.12 | Latest stable, required by all packages |

---

## Companies House API

- **REST API**: `https://api.company-information.service.gov.uk` — rate limit 600 req/5 min; use Basic auth with REST key as username, empty password
- **Streaming API**: `https://stream.companieshouse.gov.uk` — long-lived HTTPS connection; 4 streams: `/companies`, `/filing-history`, `/officers`, `/persons-with-significant-control`
- **Timepoints**: the streamer persists each stream's latest timepoint to Redis (`stream:timepoint:{name}`); used for graceful resume on restart
- **Rate limiting**: `ch_rest.py` applies a 0.6s delay between REST calls to stay safely under 2 req/s

---

## AI policy (Phase 3 — implemented)

See `AI_POLICY.md`. Hard rules that must never be bypassed:
- All LLM calls go through `apps/llm-gateway/` only
- Fixed prompt templates; users never write prompts
- Hard daily cap: £5; monthly cap: £100
- Forbidden words in prompts: fraud, scam, shell, suspicious, illegal, etc.
- Every output labelled "AI generated, [date]"
- Async generation only; never synchronous

---

## Postgres schema highlights

Base schema documented in `DATA_MODEL.md`. **Important:** migrations 0002–0011 add tables not yet
reflected there — when in doubt, the migration files in `packages/db/alembic/versions/` are ground truth.

Key things to know:
- `public.companies` — primary key is `company_number` (text); `registered_address_hash` is the anomaly clustering key. `name_normalised` (lowercased, suffixes stripped) is the column the search code queries — it has a GIN trigram index.
- `public.officers.name_normalised` — same idea, surname-first form (e.g. "smith stephen bryan"); also GIN-trigram-indexed.
- `audit.events` — append-only, partitioned by month; never delete
- `audit.searches` — every search query, partitioned by month (migration 0010). Zero-result queries are the highest signal for what features to build next.
- `audit.llm_calls` — every LLM call logged, including cache hits; partitioned by month
- `meta.deferred_events` — Phase C hydration queue for events whose company isn't known yet (migration 0009)
- `company_patterns`, `company_press`, `company_identity`, `company_favicons`, `known_addresses`, `appointments_history` — enrichment tables
- Super-secure PSCs (`kind LIKE 'super-secure%'`): display existence only, never name/address/dob
- Money stored in **pence as bigint** — never floats
- All timestamps are `timestamptz` UTC

---

## CH Streaming API — gotchas discovered in production

**Event envelope structure** (critical — get this wrong and nothing works):
```json
{
  "resource_kind": "company-psc-individual",
  "resource_id": "abc123",
  "resource_uri": "/company/12345678/persons-with-significant-control/...",
  "data": { ...entity fields... },
  "event": {
    "type": "changed",
    "timepoint": 51040045,
    "published_at": "2026-04-29T19:45:03"
  }
}
```
`timepoint` and `published_at` are nested under `event`, NOT at the top level.

- **Resource kinds** are `company-profile`, `company-officers`, `company-psc-individual` (and `company-psc-corporate-entity`, etc.) — not short forms
- **Company number** is absent from officer and PSC event `data`; extract from `resource_uri` using regex `/company/([^/]+)/`
- **Date fields** are ISO strings in CH data; asyncpg requires Python `datetime.date` objects — always run through `date.fromisoformat()`
- **Officer names** are `"SURNAME, Forename"` format in the stream
- **filing-history stream** returns 503 consistently with the stream key — likely a separate permission on the CH developer account. Check `developer-specs.company-information.service.gov.uk` for the account subscriptions.
- **REST rate limit**: 600 req/5 min ≈ 2/s; `ch_rest.py` enforces 0.6s delay
- **FK race condition**: officer/PSC events for brand-new companies arrive before the company-profile event. Worker retries up to 3× with 30s delay via arq `Retry`.

---

## Production deployment

Live droplet: `root@161.35.193.48` (DigitalOcean, 2 vCPU / 4 GB / Ubuntu).
SSH key: `~/.ssh/digitalocean_ai`.

```bash
# Standard deploy
ssh -i ~/.ssh/digitalocean_ai root@161.35.193.48
cd /opt/companieshouse/companieshouse.watch
git pull --ff-only
docker compose -f infra/docker/docker-compose.yml run --rm migrate   # if migrations
docker compose -f infra/docker/docker-compose.yml build web && \
  docker compose -f infra/docker/docker-compose.yml up -d web
```

Public domain `ch.borsoi.co.uk` is proxied by Cloudflare; nginx on the droplet
terminates TLS and forwards to the `web` container on port 3030.

Cloudflare Web Analytics for `ch.borsoi.co.uk` is captured via the parent
`borsoi.co.uk` Automatic Setup — **no script tag is injected by the app**.

After Phase 1: build the Next.js frontend (Phase 2 — see `BUILD_PLAN.md` §12).

---

## What NOT to do

- Do not run Python processes directly on the host (use Docker)
- Do not add `ON DELETE CASCADE` to public data tables (see DATA_MODEL.md §0)
- Do not call the Anthropic API from streamer or worker (Phase 3 gateway only)
- Do not store full officer dates of birth (year + month only)
- Do not display anything about super-secure PSCs beyond their existence
- Do not add free-form AI prompt inputs — ever
