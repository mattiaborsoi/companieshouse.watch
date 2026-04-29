# CLAUDE.md — Project context for AI-assisted development

This file exists so that Claude Code can pick up this project cold in a new conversation without losing context. Keep it updated as the project evolves.

---

## What this project is

**companieshouse.watch** — a free, open-source, real-time UK Companies House tracker with AI anomaly detection. Targeting journalists, OSINT researchers, and fraud/compliance analysts.

Core pitch: live feed of every UK company filing/officer/PSC change, with address-clustering anomaly detection and Anthropic-powered plain-English explanations of suspicious patterns.

Full spec is in `docs/BUILD_PLAN.md` (architecture, phases, AI policy) and `docs/DATA_MODEL.md` (full Postgres schema).

---

## Current implementation state

**Phase 1 is scaffolded.** No data is flowing yet — the pipeline needs to be started and tested against the live stream.

What exists:
- `infra/docker/docker-compose.yml` — full stack (Postgres 16, Redis 7, streamer, worker, migrate, test services)
- `packages/db/alembic/` — Alembic migrations with the complete schema from `docs/DATA_MODEL.md`
- `apps/streamer/` — Python 3.12 process consuming the CH streaming API, enqueuing arq jobs
- `apps/worker/` — arq worker processing events, upserting into Postgres
- `apps/worker/src/worker/normaliser.py` — address normaliser for anomaly detection
- `apps/worker/tests/test_address_normaliser.py` — 89 tests (52 equivalent pairs, 20 non-colliding, edge cases) — all passing

What doesn't exist yet:
- `apps/web/` — Next.js frontend (Phase 2)
- `apps/llm-gateway/` — FastAPI LLM gateway (Phase 3)
- Anomaly detector cron job (Phase 3)
- XBRL financials parser (Phase 4)

**Phase 1 exit criterion**: `psql` and see filings flowing in real time.

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
make up             # start all services
make down           # stop (data preserved on disk)
make logs           # tail all logs
make logs-streamer  # tail streamer only
make logs-worker    # tail worker only
make test           # run test suite in Docker
make db-shell       # psql shell
make ps             # container status
```

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
        tasks.py        # (exists as upserts.py + main.py)
        upserts.py      # upsert_company, upsert_filing, etc.
        normaliser.py   # address normaliser (pure function, tested)
        ch_rest.py      # CH REST API wrapper
        db.py           # asyncpg connection pool
        config.py
      tests/
        test_address_normaliser.py
      Dockerfile
    llm-gateway/        # Phase 3 — not yet created
    web/                # Phase 2 — not yet created
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

- **Resource kinds** are `company-profile`, `company-officers`, `company-psc-individual` (and `company-psc-corporate-entity`, etc.) — not short forms
- **Company number** is absent from officer and PSC event `data`; extract from `resource_uri` using regex `/company/([^/]+)/`
- **`published_at`** is null on some events; use `COALESCE(..., now())` in the INSERT
- **Date fields** are ISO strings in CH data; asyncpg requires Python `datetime.date` objects — always run through `date.fromisoformat()`
- **Officer names** are `"SURNAME, Forename"` format in the stream
- **filing-history stream** returns 503 intermittently; streamer retries with 30s back-off and that's fine
- **REST rate limit**: 600 req/5 min ≈ 2/s; `ch_rest.py` enforces 0.6s delay

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
