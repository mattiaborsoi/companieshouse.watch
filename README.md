# companieshouse.watch

A free, open-source, real-time view of the UK Companies House register — with address-clustering anomaly detection and AI-generated plain-English explanations of suspicious patterns.

**Audience:** Journalists, OSINT researchers, fraud/compliance analysts, curious citizens.

> This project is in active development. See [Build Plan](BUILD_PLAN.md) for the roadmap.

---

## Quick start

### Prerequisites
- Docker + Docker Compose
- Companies House API keys ([register here](https://developer-specs.company-information.service.gov.uk))

### Setup

```bash
# 1. Clone and configure
git clone https://github.com/yourusername/companieshouse.watch.git
cd companieshouse.watch
cp .env.example .env
# Edit .env with your CH_REST_KEY and CH_STREAM_KEY

# 2. Create local data directories
make setup

# 3. Start the database and run migrations
make infra
make db-migrate

# 4. Start everything
make up

# 5. Watch it go
make logs
```

After a few seconds you should see the streamer connecting to the Companies House streams and the worker processing events. Verify with:

```bash
make db-shell
# Then in psql:
SELECT count(*) FROM public.filings;
SELECT count(*) FROM public.companies;
```

---

## Architecture

```
CH Streaming API ──▶ streamer ──▶ Redis (arq queue) ──▶ worker(s) ──▶ Postgres
CH REST API      ──────────────────────────────────────▶ worker(s) (hydration)
```

Five services, all running in Docker:

| Service | Description |
|---|---|
| `postgres` | Primary data store (Postgres 16) |
| `redis` | Job queue, stream timepoints, rate-limit counters (Redis 7) |
| `streamer` | Long-lived process consuming 4 CH streams |
| `worker` | arq workers processing events into Postgres |
| `llm-gateway` | *(Phase 3)* FastAPI service owning the Anthropic API key |

---

## Common commands

```bash
make setup          # First-time: create local data directories
make up             # Start full stack
make down           # Stop (data preserved on disk)
make logs           # Tail all logs
make db-migrate     # Apply pending schema migrations
make db-shell       # psql shell
make test           # Run test suite in Docker
make build          # Rebuild application images
make ps             # Container health status
```

---

## Data

All data is sourced from [Companies House](https://www.companieshouse.gov.uk/) under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). We attribute and pass through this licence for all data we redistribute.

Local data is stored in `data/` (gitignored) and bind-mounted into the containers. This directory survives container rebuilds.

---

## AI features

AI-generated content uses Anthropic Claude (Haiku for bulk operations). All AI features comply with the [AI Policy](docs/AI_POLICY.md):
- Fixed prompt templates only; no user-supplied prompts, ever
- Hard daily (£5) and monthly (£100) spend caps
- Every output labelled "AI generated, [date]"
- 24-hour takedown SLA

---

## Self-hosting

This project is designed to be self-hostable. Docker Compose covers the full stack. See `.env.example` for all required environment variables.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) (coming in Phase 5).

---

## License

MIT — see [LICENSE](LICENSE).

Companies House data: Open Government Licence v3.0.
AI-generated summaries: MIT (same as codebase).
