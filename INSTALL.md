# Running it yourself

Everything runs in Docker Compose — Postgres, Redis, the two Python services,
the web app and a migration runner. There is nothing host-specific.

## Prerequisites

- Docker and Docker Compose
- Companies House API keys — register at
  [developer-specs.company-information.service.gov.uk](https://developer-specs.company-information.service.gov.uk).
  You need **two separate credentials**: a REST key and a Streaming key.
- Optional: an Anthropic API key, if you want the AI explanations.

## Setup

```bash
git clone https://github.com/mattiaborsoi/companieshouse.watch.git
cd companieshouse.watch
cp .env.example .env          # then fill in your keys
make setup                    # create the local data/ directories
make infra                    # start Postgres + Redis
make db-migrate               # apply the schema
make up                       # start everything
make logs                     # watch the stream come in
```

The web app is served on **http://localhost:3030**.

Within a few seconds the streamer should connect to the Companies House
streams and the worker should begin writing events. Check:

```bash
make db-shell
# then:
SELECT count(*) FROM public.companies;
SELECT count(*) FROM public.filings;
```

With no API keys you can still bring up Postgres, Redis and the web app —
there just won't be any data flowing in.

## Environment variables

Set in `.env`. See `.env.example` for the full list.

| Variable | Used by | Notes |
|---|---|---|
| `CH_REST_KEY` | streamer, worker, web | Companies House REST API key |
| `CH_STREAM_KEY` | streamer | Streaming API key — a **separate** credential |
| `DATABASE_URL` | worker, web | Postgres DSN |
| `DATABASE_URL_SYNC` | migrate | psycopg2 DSN, for Alembic |
| `REDIS_URL` | streamer, worker, web | `/0` for the queue, `/1` for the web cache |
| `ANTHROPIC_API_KEY` | llm-gateway | Optional. Never read by any other service |
| `GATEWAY_API_KEY` | web → llm-gateway | Shared token between the two |
| `BRAVE_SEARCH_API_KEY` | worker | Optional. Resolves company websites |
| `SITE_URL` | web, worker | Public origin. Defaults to `http://localhost:3030` |

> There are **two** `.env` files: the project root one, and
> `infra/docker/.env`. Compose invoked with `-f infra/docker/docker-compose.yml`
> reads the one **next to the compose file**, so that is where secrets belong.

## Everyday commands

```bash
make up             # start the full stack
make down           # stop (data on disk is preserved)
make logs           # tail everything
make logs-streamer  # just the stream consumer
make logs-worker    # just the queue worker
make db-migrate     # apply pending migrations
make db-shell       # psql
make test           # run the test suite in Docker
make build          # rebuild images after code changes
make ps             # container health
make backfill       # seed ~1000 companies from the REST API
```

## How the pieces fit

```
Companies House
  Streaming API ──▶ streamer ──▶ Redis queue ──▶ worker ──▶ Postgres
  REST API      ─────────────────────────────▶ worker (fills gaps on demand)

                                               Postgres ──▶ web (Next.js)
                                                            └─▶ llm-gateway ──▶ Anthropic
```

| Service | What it does |
|---|---|
| `postgres` | Everything is stored here (Postgres 16) |
| `redis` | Job queue, stream positions, query cache |
| `streamer` | Holds four long-lived connections to Companies House |
| `worker` | Processes queued events; also runs the scheduled detectors |
| `llm-gateway` | The only service allowed to talk to Anthropic |
| `web` | The Next.js front end, on port 3030 |

**Stream positions** are kept in Redis, so a restart resumes where it left
off rather than replaying from the beginning.

## Deploying

Point `SITE_URL` at your public origin so canonical URLs, social cards and the
sitemap generate correctly, put a reverse proxy in front for TLS, and forward
to the `web` container on port 3030.

Two things that matter in production and are easy to miss:

- **`audit.*` tables are partitioned by month.** Partitions must exist before
  rows can be written, or every insert fails. `apps/worker/src/worker/partitions.py`
  creates them six months ahead on startup and daily thereafter.
- **Cap Redis memory.** The Companies House REST cache will otherwise grow
  until it crowds out everything else.

## Further reading

- [`CLAUDE.md`](CLAUDE.md) — architecture and the API gotchas worth knowing
- [`DATA_MODEL.md`](DATA_MODEL.md) — the database schema
- [`BUILD_PLAN.md`](BUILD_PLAN.md) — how it was built, phase by phase
- [`AI_POLICY.md`](AI_POLICY.md) — the rules the AI features run under
- [`OPERATIONS.md`](OPERATIONS.md) — operational notes
