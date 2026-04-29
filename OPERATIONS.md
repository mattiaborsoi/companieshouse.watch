# Operations Runbook

> Companion to `BUILD_PLAN.md`. This is the document you read at 03:00 UTC when something is on fire. Keep it pragmatic and current.

---

## 0. How this document is used

Three modes:

1. **First-time setup.** Read top to bottom when bringing up a new environment.
2. **Daily ops.** Skim §3–§5; act on alerts.
3. **Incident.** Jump to §9 (Incident Response). The procedures there assume nothing.

The single most important rule: **when in doubt, lower the LLM daily cap to the current spend.** That stops cost bleeding while you investigate. Everything else can wait.

---

## 1. Environments

Three environments. Same code, different scale and data.

### `dev` — local
- Docker Compose. Postgres, Redis, the four services.
- Stream API in **dry-run mode** (no Companies House key) — uses a recorded fixture file replayed on a loop. Real API key optional for testing real ingestion locally.
- LLM gateway in **mock mode** by default — returns canned responses without calling Anthropic. Real key optional, behind an env flag.
- All caps and quotas dropped to small numbers (£0.50/day cap, 1 generation/hour) to make it impossible to leak production-scale costs from a dev mistake.

### `staging` — pre-production
- One small VPS, one Postgres instance, one Redis.
- Real Companies House stream key (separate account from production).
- Real Anthropic key with a £10/month workspace cap.
- Used for: testing schema migrations, prompt version changes, and deployments that touch the gateway.
- Not publicly linked. Authenticated access only.

### `prod` — public
- Hetzner Cloud (or Fly.io — see `BUILD_PLAN.md` decisions).
- Managed Postgres (Neon).
- Managed Redis (Upstash or Hetzner Redis).
- Cloudflare in front of the web app and gateway.
- Real keys, real caps, real users.

---

## 2. Service inventory

| Service | Process type | Restart policy | Logs to | Health endpoint |
|---|---|---|---|---|
| `web` (Next.js) | Long-running HTTP | always | stdout → host | `/api/healthz` |
| `streamer` | Long-running, single instance | always, with backoff | stdout → host | not HTTP — heartbeat in Redis |
| `worker` (arq) | Long-running, scalable | always | stdout → host | `/healthz` (admin port) |
| `llm-gateway` | Long-running HTTP | always | stdout → host | `/healthz` |
| `cron` | Scheduled tasks | per-job | stdout → host | n/a |

**Single-instance constraint**: the streamer must run as exactly one instance per stream. Running two against the same stream key will cause them to alternate-disconnect each other. Use the orchestrator's "max instances = 1" setting and verify on every deploy.

**Worker scaling**: the worker is stateless and horizontally scalable. v1 ships with one worker; raise to two when the queue depth alert fires repeatedly.

---

## 3. Deployment

### Pre-deploy checklist

- [ ] `make test` passes locally and in CI.
- [ ] Schema migration (if any) reviewed and tested in staging.
- [ ] If a new prompt version is shipping: A/B'd in staging on real data.
- [ ] If a new LLM `kind` is shipping: ethics doc committed (§13 of `AI_POLICY.md`).
- [ ] LLM workspace caps in Anthropic console match what's configured in `.env`.
- [ ] Health endpoints respond in staging.
- [ ] Rollback plan written down (see below).

### Deploy order

Always in this order:
1. **Database migrations.** Run, verify, then deploy services. Migrations are forward-only; they must work with both the old and new code.
2. **Worker.** Deploy first so it can drain the queue with new logic.
3. **Gateway.** Deploy second — the gateway is conservative and refuses unknown `kind` values, so it should accept new kinds before the web tries to use them.
4. **Streamer.** Restart only if its code changed; otherwise leave it alone (every restart loses a few seconds of stream).
5. **Web.** Deploy last so users only see the new UI when everything behind it is ready.

### Rollback

Every deploy is a Git tag. Rollback is `redeploy <previous-tag>`. Schema migrations follow the rule: a migration is mergeable only if the previous code version still runs against the new schema. This means:

- **Adding columns**: safe — old code ignores them.
- **Removing columns**: two-step. First deploy removes references in code; second deploy drops the column.
- **Renaming columns**: never. Add new, migrate writes, migrate reads, drop old. Four steps.
- **Adding tables**: safe.
- **Dropping tables**: only after a release where nothing references them.

### Secret management

Secrets live in the host platform's secret store, never in the repo. Required secrets:

- `CH_REST_API_KEY` (gateway, worker)
- `CH_STREAM_API_KEY` (streamer only)
- `ANTHROPIC_API_KEY` (gateway only — verified by CI grep that no other service has it)
- `DATABASE_URL` (all)
- `REDIS_URL` (all)
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (worker, gateway)
- `STRIPE_API_KEY` (web only, Phase 6)
- `STRIPE_WEBHOOK_SECRET` (web only, Phase 6)

`.env.example` lists every variable. CI checks that no `.env` file is committed.

---

## 4. Monitoring and the operations dashboard

### Internal admin dashboard (`/admin`, project owner only)

A single page showing, in this order:

1. **Today's LLM spend** vs daily cap, as a bar with the current value.
2. **This month's LLM spend** vs monthly cap.
3. **Cache hit rate** today and 7-day average.
4. **Stream health**: last event timestamp per stream (companies, filings, officers, PSC). If any is older than 5 minutes during business hours, red.
5. **Worker queue depth**.
6. **Top users by generation count** (today, last 7 days).
7. **Top kinds by cost** (today, last 30 days).
8. **Recent anomaly detections** with their AI summary status.
9. **Recent errors** from `audit.llm_calls` where `outcome` is `error` or `timeout`.

Built as a single SSR page reading directly from Postgres + Redis. No fancy dashboarding tool. The dashboard itself is the simplest possible thing.

### External monitoring

- **Uptime**: Better Stack or Healthchecks.io. Targets: web, gateway, streamer heartbeat (a Redis key updated every 30s; an alert fires if it's > 2 min stale).
- **Errors**: Sentry, free tier. All four services report.
- **Logs**: Whatever the host provides. Ship to Better Stack Logs in v1 if the host's native viewer is poor.

### Heartbeats

Each long-running service writes a heartbeat to Redis every 30 seconds:

```
heartbeat:streamer       → timestamp + last stream timepoint
heartbeat:worker:{id}    → timestamp + queue depth
heartbeat:gateway        → timestamp + recent call count
```

A cron checks heartbeats every minute. Stale heartbeat → alert.

---

## 5. Alerts

### Alert routes

Two channels:
- **Telegram** (or Slack, or email — pick one and stick with it) for low/medium urgency.
- **Pagerduty** (or a phone-ringing equivalent) for high urgency only.

If the project is solo-maintained, the high urgency channel is your phone with a sound that wakes you. Configure mercilessly: reduce noise rather than tolerating it.

### Alert table

| Severity | Trigger | Channel |
|---|---|---|
| **HIGH** | Daily LLM spend > 80% of cap | Phone |
| **HIGH** | Hourly LLM call rate > 5x 7-day baseline | Phone |
| **HIGH** | Single user generated > 50 in an hour | Phone |
| **HIGH** | Web service health check failed for > 3 minutes | Phone |
| **HIGH** | Postgres connection failures > 10/minute | Phone |
| **MED** | Daily LLM spend > 50% of cap by 6pm UTC | Telegram |
| **MED** | Streamer heartbeat stale > 2 minutes | Telegram |
| **MED** | Worker queue depth > 1000 for > 5 minutes | Telegram |
| **MED** | Cache hit rate < 50% for the day (computed at end of day) | Telegram |
| **MED** | Sentry error rate spike (> 3x baseline) | Telegram |
| **LOW** | Anomaly takedown request received | Email |
| **LOW** | New paying user signed up | Telegram (good news!) |
| **LOW** | Daily summary email at 09:00 UTC | Email |

### What an alert must include

- The trigger condition.
- Current value vs threshold.
- A link to the relevant dashboard view.
- A link to the section of this runbook that handles it.

---

## 6. Cost control: how the rules are actually enforced

Cross-reference with `AI_POLICY.md` §2. This section is the operational view — what runs where.

### The Redis counters

Six counters, all with TTL:

```
llm:spend:daily:{YYYY-MM-DD}           TTL 48h
llm:spend:monthly:{YYYY-MM}            TTL 35 days
llm:user:{user_id}:gen:{YYYY-MM-DD}    TTL 48h
llm:ip:{ip_hash}:gen:{YYYY-MM-DD}      TTL 48h
llm:queue:depth                        no TTL — gauge
llm:platform_paused                    set if cap hit, manual reset
```

`llm:platform_paused` is the kill switch. When set, the gateway returns `outcome: 'platform_paused'` for all new generations. It's automatically set when the daily or monthly cap is reached, and automatically cleared at the start of the next day/month. It can also be set manually for emergency stops.

### The cap config

Lives in the gateway's environment, not in code:

```
LLM_DAILY_CAP_PENCE=500          # £5/day
LLM_MONTHLY_CAP_PENCE=10000      # £100/month
ANTHROPIC_WORKSPACE_CAP_USD=125  # set in console too — these must match
```

Changing caps is an env update + gateway restart. There is intentionally no admin UI for this — caps changing requires deliberate action.

### Manual cap controls (the panic button)

Each of these is a one-line script in `apps/llm-gateway/scripts/`:

- `pause_now.py` — sets `llm:platform_paused`. Use when alarmed.
- `resume.py` — clears it. Use when calm.
- `lower_cap.py <pence>` — temporarily lower the daily cap. Use during an investigation.
- `flush_user_quota.py <user_id>` — reset a user's daily counter (rare, e.g. apology refund).

All of these write a row to `audit.admin_actions` with the operator name and reason.

### Daily cost reconciliation

Once a day, a cron job compares:
- `audit.llm_calls` summed cost for yesterday.
- Anthropic console reported usage for yesterday (via Anthropic's billing API).

If the two diverge by more than 5%, alert. Most often this is timezone confusion; occasionally it's a bug in our cost calculation.

---

## 7. Backups and restores

### Postgres

- Managed provider's automated backups: daily, 7-day retention on the entry tier.
- Weekly logical dump: `pg_dump --format=custom > weekly-{YYYY-WW}.dump`, uploaded to R2. 90-day retention.
- Schema-only dump committed to repo on every migration: `db/schema_dumps/{date}.sql`. Useful for reading history without a DB connection.

### Restoring from backup (drill quarterly)

1. Provision a new Postgres instance.
2. Restore latest `pg_dump`: `pg_restore -d $NEW_DATABASE_URL weekly-{YYYY-WW}.dump`.
3. Verify row counts match expected within ±5% (allowing for drift since the dump).
4. Update `DATABASE_URL` in service env, deploy.
5. Re-run streamer from a timepoint = `(latest event in restored DB) - 1 hour`. Some duplicate events will arrive; the upsert logic handles this idempotently.

Do this drill on staging quarterly. The first time you run it during an actual incident is the wrong time to discover something is missing.

### Redis

Treated as ephemeral. On loss:
- Daily/monthly counters reset to zero. The gateway will under-account for the rest of the day; mitigate by checking Anthropic console manually.
- Streamer timepoint lost; restart from `(latest event in Postgres) - 1 hour`.
- User rate-limit counters reset; users get a free day's quota. Tolerable.

We don't pay for Redis persistence in v1.

### R2

Cloudflare R2 is durable. Versioned bucket for the XBRL files. No separate backup.

### Git repo

It's GitHub. We trust GitHub. Don't.
- Mirror the repo to a second remote (Codeberg or self-hosted Gitea) on every push, via a CI step.
- Keep a local clone on a machine you control.

---

## 8. Companies House data hygiene

### Streamer correctness

The streamer is the most fragile piece in the system. It must:

1. **Reconnect with backoff.** Companies House documents an exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 32s. Implemented and tested.
2. **Persist the timepoint frequently.** Write to Redis after every N events (N = 50). On restart, resume from the last persisted timepoint. Some duplicates are fine; the worker handles upserts.
3. **Use exactly one stream key per environment.** Two clients on the same key alternate-disconnect each other.
4. **Handle 429 responses correctly.** Back off for the duration the API tells you. Repeated 429s while ignoring backoff will get the IP blocked.

### REST hydration

The streaming events are minimal — sometimes you need the full company profile to interpret an event. The worker hydrates via REST when:

- Receiving a stream event for a company we don't yet have.
- Detecting a status change that affects derived state.
- A user requests a manual refresh.

REST has 600 requests / 5 min per key (= 2/sec sustained). The worker stays well under this:
- Token-bucket rate limiter at 1.5 req/sec (75% of cap).
- Backoff on 429.
- Hydration jobs are low-priority in the queue; user-triggered refreshes are higher.

If we need more headroom: request an uplift from Companies House (politely, with the use case). Don't fan out across multiple keys; that's a TOS grey area.

### Bulk XBRL processing

Once a month, after the Companies House monthly accounts file drops:
1. Cron downloads it to R2.
2. Worker iterates files, parses with our XBRL parser, upserts into `financials`.
3. Failures (corrupt files, unsupported taxonomies) are logged but don't fail the batch.
4. Done in batches of 1000 to keep memory bounded.

Expected duration: a few hours. Schedule overnight.

---

## 9. Incident response

### Common incidents and runbooks

#### 9.1 LLM spend is climbing fast

**Symptom**: HIGH alert "Daily spend > 80% of cap" or "Hourly rate > 5x baseline".

**Triage** (do these in order, do not skip):

1. **Pause the platform.** `python scripts/pause_now.py "investigating spend spike"`. The platform stops generating new content immediately. Cached results continue to serve.
2. **Look at the dashboard.** Top users by generation today. Top kinds by cost.
3. **Identify the cause.**
   - **One user is hammering**: ban or rate-limit that account. Was it a paying user? Refund and ban.
   - **One IP is hammering anonymous endpoints**: Cloudflare block.
   - **One kind is suddenly expensive**: a recent prompt change blew up output length, or a recent code change is generating without checking cache. Roll back the offending deploy.
   - **All kinds proportionally up**: legitimate traffic spike (something went viral). Decide whether to raise the cap or stay paused.
4. **Resume only when** the cause is identified and contained. `python scripts/resume.py`.
5. **Postmortem**. Write up in `docs/incidents/{date}-{slug}.md`. Even if it was tiny.

#### 9.2 Streamer is dead

**Symptom**: MED alert "Streamer heartbeat stale".

**Triage**:

1. Check the host's process status. Is the streamer running?
2. If running but heartbeat stale: check logs for the last error.
   - **Connection refused / network**: usually transient; the backoff should recover. Wait 2 minutes.
   - **401 / 403**: API key revoked or rotated. Check Companies House developer portal.
   - **Endless 429s**: someone (possibly us, via another process) is using the same key. Find the duplicate.
3. If not running: restart it. The orchestrator should have done this; if not, that's a separate bug.
4. After restart: verify in the admin dashboard that events are flowing. Check the gap in `audit.events.received_at`.
5. If the gap is significant (> 30 minutes), trigger a backfill: a one-off job that pulls the missing window via REST for the most-watched companies.

#### 9.3 Worker queue is backing up

**Symptom**: MED alert "Worker queue depth > 1000".

**Triage**:

1. Is one job type dominating? Check by inspecting the queue.
2. **A single slow job type**: investigate why it's slow. Often a hung HTTP call (Companies House REST, or LLM gateway). Check timeouts.
3. **All job types slow**: worker is at capacity. Scale up: deploy a second worker instance.
4. **Stuck jobs**: jobs older than their timeout that haven't been retried. Look for a deadlock or external dependency outage.

#### 9.4 Postgres is unresponsive

**Symptom**: HIGH alert "Postgres connection failures".

**Triage**:

1. Check the managed provider's status page. Is the provider degraded?
2. If yes: wait, communicate via the support page banner.
3. If no: connection pool exhaustion is the most likely cause. Check active connections. A leak somewhere?
4. Long-running queries holding locks: identify with `pg_stat_activity`, decide whether to terminate.
5. Disk full: rare on managed providers but possible if events table has grown unexpectedly. Drop oldest unprocessed events partition if needed.

#### 9.5 Defamation/takedown request

**Symptom**: Email or contact form submission requesting removal of a summary, page, or anomaly.

**Procedure**:

1. **Acknowledge within 4 hours.** Even if you can't action immediately. Templated reply: "Received, reviewing within 24 hours."
2. **Read the request.** Is the requester named? Are they the subject of the data, their representative, or a third party?
3. **Identify the precise content** they want removed. URL, screenshot, or paragraph.
4. **Decide**:
   - **Legitimate, the AI summary is misleading** → remove the AI summary (set `ai_summary_id = null`, mark anomaly with `takedown_action='removed'`). Underlying data stays — it's public.
   - **Legitimate, the underlying data is the issue** → check if Companies House have suppressed the data; add to `meta.suppression_list`. The application filters them from display.
   - **Not legitimate (no identifiable harm, no specific complaint)** → polite reply explaining the data is public-by-statute and we display only what is published. Keep records.
5. **Log the action** in `public.anomalies` takedown columns.
6. **If a pattern emerges** (multiple takedowns for the same kind of complaint), consider it a signal that a prompt or feature needs revision.
7. **Lawyer threats**: take seriously, escalate to the project owner immediately, do not respond ad hoc. If the project ever has more than one maintainer, only the project owner replies to legal correspondence.

#### 9.6 Cloudflare is having a bad day

**Symptom**: Users report errors that none of our internal monitoring sees.

**Triage**:

1. Check Cloudflare's status page.
2. If a regional outage: nothing to do but wait. Comms via the support page (which is also behind Cloudflare — if that's down too, post to the project's social account).
3. If our config is the issue (e.g. a recent rule change broke something): roll back the rule.

#### 9.7 Stripe webhook is broken (Phase 6+)

**Symptom**: A user paid but their account didn't upgrade, or vice versa.

**Triage**:

1. Check Stripe webhook delivery logs.
2. If failures: look at the response code from our endpoint. Common cause: signature verification rejecting valid webhooks (clock skew, secret mismatch).
3. Replay missed webhooks from the Stripe dashboard.
4. Manually upgrade the affected user; refund if they suffered double-billing.

---

## 10. Routine procedures

### Daily (automated, you read the email)

- 09:00 UTC: daily summary email arrives. Skim:
  - Spend yesterday vs cap.
  - Cache hit rate.
  - New paying users.
  - Open takedown requests.
  - Any anomalies above threshold that haven't been AI-summarised (queue stuck?).

### Weekly (Monday morning, ~30 minutes)

- Review the past week's incidents folder.
- Sample 5 anomaly explanations and 3 company narratives, sanity-check the language.
- Check the weekly Postgres logical backup completed.
- Update the support page footer numbers ("running on £X this month, Y supporters").
- Glance at top users for any unusual patterns.

### Monthly (first Sunday, ~2 hours)

- Cost review: actual vs cap by feature. Consider raising or lowering caps.
- Review Anthropic pricing page for changes.
- Drill: restore staging from latest Postgres backup, verify (quarterly minimum, monthly preferred).
- Update `BUILD_PLAN.md` decisions log if anything has shifted.
- Review open issues and PRs from external contributors.

### Quarterly

- Per `AI_POLICY.md` §15, full AI review.
- Disaster recovery drill.
- Re-read `OPERATIONS.md` (this document) and update anything that's drifted from reality.
- Anthropic API key rotation.

---

## 11. Onboarding a co-maintainer

If/when a second person joins:

1. They get a personal account with admin role on the staging environment first. Production access is delayed.
2. They read all four documents in order: `BUILD_PLAN.md` → `DATA_MODEL.md` → `AI_POLICY.md` → this one.
3. They shadow the project owner through one weekly review and one monthly review.
4. They handle one staging incident (simulated or real) before getting production access.
5. Production secrets shared via 1Password / Bitwarden vault, not chat.
6. Both maintainers are on the same alerting channels.

---

## 12. The "leaving the project" runbook

If the project owner needs to step away — temporary or permanent — the following must remain accessible to a successor or shut the project down cleanly.

### Documented continuously
- This document.
- The `BUILD_PLAN.md` decisions log.
- A `OWNERSHIP.md` file at the repo root listing: domain registrar, hosting account, Stripe account, Anthropic account, Cloudflare account, payment method on each.
- Stripe set up for refunds without manual operator action where possible.

### If shutting down
1. Turn off Stripe billing, refund pro users for the unused portion of their period.
2. Pause the platform (`pause_now.py`), set the support page to a goodbye message.
3. Stop the streamer (no new data ingest).
4. Leave the read-only website running for 90 days for users who want to export their watchlists.
5. After 90 days: delete user PII (emails, Stripe IDs, watchlists), keep the public data and code.
6. Open-source the final state if not already; the data pipeline alone is useful to others.

### If transferring ownership
1. Successor reads all documents, sets up local dev, runs the test suite.
2. Joint review of one quarterly process.
3. Transfer all accounts (registrar, hosting, Anthropic, Stripe) — change of email, MFA, payment method.
4. Update the support page and repo README with the new maintainer.
5. Original owner retains repo write access for 30 days as a safety net, then steps off.

---

## 13. Useful one-liners

```bash
# What did we spend today?
psql $DATABASE_URL -c "
  SELECT kind, COUNT(*), SUM(cost_pence) AS pence
  FROM audit.llm_calls
  WHERE called_at::date = CURRENT_DATE
  GROUP BY kind ORDER BY pence DESC;"

# Top 10 users by generation today
psql $DATABASE_URL -c "
  SELECT user_id, COUNT(*) AS gens
  FROM audit.llm_calls
  WHERE called_at::date = CURRENT_DATE AND NOT cached_hit
  GROUP BY user_id ORDER BY gens DESC LIMIT 10;"

# Cache hit rate today
psql $DATABASE_URL -c "
  SELECT
    COUNT(*) FILTER (WHERE cached_hit) * 100.0 / COUNT(*) AS hit_pct
  FROM audit.llm_calls
  WHERE called_at::date = CURRENT_DATE;"

# Stream health: time since last event per stream source
psql $DATABASE_URL -c "
  SELECT source, MAX(received_at) AS last_event,
         now() - MAX(received_at) AS gap
  FROM audit.events
  WHERE source LIKE 'stream:%'
  GROUP BY source;"

# Are we paused?
redis-cli GET llm:platform_paused

# Pause now
python apps/llm-gateway/scripts/pause_now.py "reason here"

# Resume
python apps/llm-gateway/scripts/resume.py

# Lower today's cap to current spend
python apps/llm-gateway/scripts/lower_cap.py $(redis-cli GET llm:spend:daily:$(date +%F))
```

---

## 14. Things that will go wrong (and we accept)

Some failure modes are not worth engineering away in v1. Listed here so we don't pretend they don't exist:

- **Up to a few minutes of stream events lost on a streamer crash + Redis simultaneous loss.** Not worth solving with HA in v1.
- **The site briefly serving a stale "AI generated" badge if the user views a cached summary right as a regeneration completes.** Cosmetic.
- **A handful of duplicate event rows in `audit.events` after a streamer restart from a slightly earlier timepoint.** The upsert layer handles them; the audit log just has duplicates.
- **First-user-pays for cold-cache company narratives.** Mitigation is the cache-warming cron for popular companies; the long tail still has cold caches.
- **Anthropic API outage means generations fail for the duration.** Cached results still serve. We do not have a fallback model in v1.
- **A bug in the address normaliser causes false-positive or false-negative anomalies.** We monitor takedown rate as the canary; if it spikes, we ship a normaliser fix.

When any of these graduates from "acceptable in v1" to "actually a problem," we revisit. Until then, simplicity wins.

---

## 15. Contact

Project owner: TBD
Repo: TBD
Status page: TBD (consider Cachet or status.so)
Security disclosures: security@<domain>
General contact: hello@<domain>
