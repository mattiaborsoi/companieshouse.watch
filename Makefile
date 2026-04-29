COMPOSE = docker compose -f infra/docker/docker-compose.yml

# ── First-time setup ─────────────────────────────────────────────────────────

setup:          ## Create local data directories (run once before first `make up`)
	mkdir -p data/postgres data/redis

# ── Stack lifecycle ──────────────────────────────────────────────────────────

up:             ## Start Postgres, Redis, streamer, and worker
	$(COMPOSE) up -d postgres redis streamer worker

down:           ## Stop and remove containers (data is preserved on disk)
	$(COMPOSE) down

infra:          ## Start only Postgres + Redis (useful during development)
	$(COMPOSE) up -d postgres redis

logs:           ## Tail logs for all running services
	$(COMPOSE) logs -f

logs-streamer:  ## Tail streamer logs only
	$(COMPOSE) logs -f streamer

logs-worker:    ## Tail worker logs only
	$(COMPOSE) logs -f worker

# ── Database ─────────────────────────────────────────────────────────────────

db-migrate:     ## Run Alembic migrations inside a container
	$(COMPOSE) run --rm --profile migrate migrate

db-shell:       ## Open a psql shell in the Postgres container
	$(COMPOSE) exec postgres psql -U chwatch chwatch

# ── Tests ────────────────────────────────────────────────────────────────────

test:           ## Run the test suite inside a Docker container
	$(COMPOSE) run --rm --profile test test

# ── Build ────────────────────────────────────────────────────────────────────

build:          ## (Re)build all application images
	$(COMPOSE) build streamer worker

build-no-cache: ## Rebuild images from scratch
	$(COMPOSE) build --no-cache streamer worker

# ── Status ───────────────────────────────────────────────────────────────────

ps:             ## Show running containers and health
	$(COMPOSE) ps

.PHONY: setup up down infra logs logs-streamer logs-worker db-migrate db-shell test build build-no-cache ps
