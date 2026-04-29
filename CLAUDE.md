# CLAUDE.md — Project context for AI-assisted development

This file exists so that Claude Code can pick up this project cold in a new conversation without losing context. Keep it updated as the project evolves.

---

## What this project is

**companieshouse.watch** — a free, open-source, real-time UK Companies House tracker with AI anomaly detection. Targeting journalists, OSINT researchers, and fraud/compliance analysts.

Core pitch: live feed of every UK company filing/officer/PSC change, with address-clustering anomaly detection and Anthropic-powered plain-English explanations of suspicious patterns.

Full spec is in `docs/BUILD_PLAN.md` (architecture, phases, AI policy) and `docs/DATA_MODEL.md` (full Postgres schema).

---

## Current implementation state

**Phase 1 complete. Phase 2 (web UI) scaffolded and running.** Data is flowing live from Companies House.

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

### Not yet built
- `apps/llm-gateway/` — FastAPI LLM gateway (Phase 3)
- Anomaly detector cron job (Phase 3)
- XBRL financials parser (Phase 4)

**Web app runs on port 3030** (ports 3000 and 3001 were occupied by other containers on the dev machine).

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
          20260429_0001_initial.py   # full schema
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
| `CH_REST_KEY` | streamer, worker | Companies House REST API key |
| `CH_STREAM_KEY` | streamer | Companies House streaming API key (separate credential) |
| `DATABASE_URL` | worker | asyncpg DSN; use `localhost` for direct access, `postgres` hostname inside Docker |
| `DATABASE_URL_SYNC` | migrate | psycopg2 DSN for Alembic |
| `REDIS_URL` | streamer, worker | `localhost:6379` locally; `redis:6379` inside Docker |
| `ANTHROPIC_API_KEY` | llm-gateway (Phase 3) | never used directly by streamer/worker |

---

## Key technical decisions (from `docs/BUILD_PLAN.md` decisions log)

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

## AI policy (Phase 3 — not yet implemented)

See `docs/AI_POLICY.md`. Hard rules that must never be bypassed:
- All LLM calls go through `apps/llm-gateway/` only
- Fixed prompt templates; users never write prompts
- Hard daily cap: £5; monthly cap: £100
- Forbidden words in prompts: fraud, scam, shell, suspicious, illegal, etc.
- Every output labelled "AI generated, [date]"
- Async generation only; never synchronous

---

## Postgres schema highlights

Full schema in `docs/DATA_MODEL.md`. Key things to know:
- `public.companies` — primary key is `company_number` (text); `registered_address_hash` is the anomaly clustering key
- `audit.events` — append-only, partitioned by month; never delete
- `audit.llm_calls` — every LLM call logged, including cache hits; partitioned by month
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

## What to do next (Phase 1 completion)

1. `make setup && make infra && make db-migrate` — get the schema applied
2. `make up` — start streamer and worker
3. `make logs` — watch for events flowing in
4. `make db-shell` → `SELECT count(*) FROM public.filings;` — verify rows accumulating
5. Once data is flowing, run `make down && make up` — verify stream resumes from timepoint
6. Phase 1 exit: filings visible in `psql`, streamer reconnects after restart

After Phase 1: build the Next.js frontend (Phase 2 — see `docs/BUILD_PLAN.md` §12).

---

## What NOT to do

- Do not run Python processes directly on the host (use Docker)
- Do not add `ON DELETE CASCADE` to public data tables (see DATA_MODEL.md §0)
- Do not call the Anthropic API from streamer or worker (Phase 3 gateway only)
- Do not store full officer dates of birth (year + month only)
- Do not display anything about super-secure PSCs beyond their existence
- Do not add free-form AI prompt inputs — ever
