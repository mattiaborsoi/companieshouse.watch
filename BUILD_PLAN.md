# Companies House Live Tracker — Build Plan

> **Working title:** TBD (some candidates: `RegistryWatch`, `OpenRegistry`, `Filing.live`, `companieshouse.watch`)
> **One-line pitch:** A free, open-source, real-time view of the UK Companies House register, with anomaly detection and AI-generated summaries — built so people can actually understand what's being filed and by whom.
> **Audience:** Journalists, OSINT researchers, fraud/compliance analysts, FinTwit, curious citizens.

---

## 0. How to use this document with Claude Code

This is a working spec, not a finished design. Treat each numbered section as a chunk of work. Suggested workflow:

1. Read this whole file, then ask Claude to summarise its understanding back to you before writing any code. Push back on anything wrong.
2. Build in the order given — **Phase 1 → Phase 2 → Phase 3**. Don't skip ahead. The most common failure mode is building the AI features before the data pipeline is solid.
3. After each phase, do a manual review of what was built. Don't trust "it works" without seeing it run on real data.
4. Keep this file in the repo root as `BUILD_PLAN.md`. Update it as decisions change.

Open questions and explicit unknowns are flagged with **`[DECISION]`**. Don't let Claude paper over them — pause and decide.

---

## 1. Goals and non-goals

### Goals
- Real-time ingestion of every filing/officer/PSC change from Companies House.
- A clean, fast public UI for browsing the live feed, searching companies/officers, and viewing structured profiles.
- One genuinely novel feature in v1: **address-clustering anomaly detection** with LLM-generated explanations.
- Cost-controlled AI: cached, rate-limited, hard daily caps, no user-supplied prompts.
- Donation-friendly framing without begging.
- Open source under a MIT licence.

### Non-goals (for v1)
- Full director network graphs / entity resolution. Defer to v2.
- Watchlists with email alerts. Defer to v2.
- Mobile app. Web only, but mobile-responsive.
- Non-UK data (Scotland/NI are within Companies House scope; Republic of Ireland and overseas are not).
- Free-form AI prompts of any kind. Ever.
- Reproducing what Beauhurst/Endole sell. We're a different product.

### Explicit principles
- **Free for individual users.** Pro tier exists only to fund the project.
- **No tracking beyond minimal analytics** (Plausible or self-hosted Umami, never GA).
- **No dark patterns.** No cookie walls, no email modals, no upsell on every page.
- **Sourcing on every claim.** Every datum links back to its filing on Companies House.
- **Honest about what AI generated.** Every AI summary is clearly labelled and dated.

---

## 2. High-level architecture

```
┌─────────────────────┐      ┌──────────────────────┐
│ Companies House     │      │ Companies House      │
│ Streaming API       │      │ REST API             │
│ (long-lived HTTPS)  │      │ (on-demand fetches)  │
└──────────┬──────────┘      └──────────┬───────────┘
           │                            │
           ▼                            ▼
┌─────────────────────────────────────────────────────┐
│ Streamer process (1 instance, autorestart)          │
│  - reads stream                                     │
│  - persists timepoint to Redis                      │
│  - publishes events to a Redis Stream / queue       │
└──────────────────────────┬──────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
┌────────────────────────┐  ┌──────────────────────────┐
│ Worker(s)              │  │ Anomaly detector (cron)  │
│  - normalise events    │  │  - runs every N minutes  │
│  - upsert into Postgres│  │  - SQL rules             │
│  - hydrate via REST    │  │  - writes anomaly rows   │
│    where needed        │  │  - enqueues LLM jobs     │
└────────────┬───────────┘  └──────────────┬───────────┘
             │                             │
             ▼                             ▼
       ┌───────────────────────────────────────┐
       │ Postgres (primary store)              │
       │  - companies, officers, filings, PSCs │
       │  - events (append-only)               │
       │  - anomalies                          │
       │  - ai_summaries (cached)              │
       │  - llm_calls (audit log)              │
       │  - users, quotas, subscriptions       │
       └────────────────┬──────────────────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │ Web app (Next.js)   │
              │  - SSR pages        │
              │  - tRPC / REST API  │
              │  - SSE for live feed│
              └──────────┬──────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Cloudflare      │
                │ (DDoS, caching, │
                │  bot mitigation)│
                └─────────────────┘

LLM gateway (separate small service):
  - all LLM calls go through it
  - enforces budgets, caching, rate limits
  - never called directly from web/worker code
```

### Why this shape
- **Streamer is its own process** because it's long-lived and fragile; isolate it.
- **Workers are stateless** so we can scale horizontally if needed.
- **Postgres is the only store** until proven otherwise. No Elasticsearch, no Kafka, no graph DB. Boring.
- **LLM gateway is a hard wall** between user actions and our spend. Nothing else can call Anthropic directly.

---

## 3. Stack

### Languages and frameworks
- **Backend:** Python 3.12, FastAPI for HTTP, `httpx` for outbound, `arq` or `dramatiq` for the worker queue. **`[DECISION]`** Python wins over Node here because the XBRL ecosystem (`python-xbrl`, `arelle`) is more mature and we'll need it.
- **Streamer:** standalone Python process using `httpx.stream()`. Single file, ~150 lines.
- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui for components. SSR for SEO on profile pages.
- **Database:** Postgres 16. Use Postgres `tsvector` for search, JSONB for raw filing data, plain rows for everything else. **No Elasticsearch in v1.**
- **Cache/queue/rate limit:** Redis 7. Used for: streaming queue, LLM cache, per-user rate limit counters, daily/monthly LLM spend counters.
- **Object storage:** Cloudflare R2 or backblaze B2 for raw filing PDFs we cache locally. **`[DECISION]`** R2 because no egress fees.
- **LLM:** Anthropic API. Haiku for bulk, Sonnet for nuanced summaries. **Never Opus.** No OpenAI fallback in v1 — keep dependencies minimal.
- **Auth:** Lucia or Auth.js with email-magic-link. Skip social login in v1.
- **Payments (when we add the pro tier):** Stripe Checkout + Customer Portal. No custom billing UI.

### Infrastructure
- **Hosting:** **`[DECISION]`** Pick one of:
  - **Hetzner Cloud + managed Postgres + R2** — cheapest, ~£25/mo, more ops work.
  - **Fly.io + Neon Postgres + R2** — middle ground, ~£40–60/mo, less ops.
  - **Railway + Railway Postgres** — easiest, ~£60–100/mo, locks you in.
  - Recommend: **Hetzner + Neon + R2** for the right balance of cost and operability.
- **CDN/proxy:** Cloudflare in front of everything. Free tier is fine. Turn on bot fight mode and Turnstile for AI-trigger endpoints.
- **Monitoring:** Sentry (free tier) for errors, Better Stack or Healthchecks.io for uptime, a tiny internal dashboard for LLM spend.
- **Logs:** Whatever the host gives. Don't pay for Datadog at this stage.

### Repo structure (monorepo, single language per service)

```
/repo
  /apps
    /web              # Next.js
    /streamer         # Python long-running process
    /worker           # Python arq workers
    /llm-gateway      # Python FastAPI service
  /packages
    /db               # SQL migrations, shared schema docs
    /shared-types     # Generated types from Postgres → TS
  /infra
    /docker           # docker-compose for local dev
    /deploy           # deployment scripts/Terraform if used
  /docs
    BUILD_PLAN.md     # this file
    DATA_MODEL.md
    AI_POLICY.md
    OPERATIONS.md
  README.md
  LICENSE
  .env.example
```

---

## 4. Data sources and what to actually fetch

### Companies House Streaming API
- Base URL: `https://stream.companieshouse.gov.uk`
- Auth: HTTP Basic with stream key (separate from REST key) — register at `developer-specs.company-information.service.gov.uk`.
- Streams to consume in v1:
  - `/companies` — company profile changes (incorporation, name change, address, status).
  - `/filing-history` — every filing.
  - `/officers` — director/secretary appointments and resignations.
  - `/persons-with-significant-control` — beneficial ownership changes.
- Streams to defer to v2:
  - `/charges` — secured debt. Useful but less broadly interesting.
  - `/insolvency-cases` — narrow audience.
  - `/disqualified-officers` — low volume, can poll instead.

### Companies House REST API
- Base URL: `https://api.company-information.service.gov.uk`
- Auth: HTTP Basic with REST key.
- Rate limit: 600 requests / 5 min / key. We'll need to request an uplift early — be polite, explain the use case.
- Use cases in v1:
  - Hydrating company details when a stream event references a company we don't yet have.
  - On-demand "refresh" button on company pages.

### Bulk downloads
- Free monthly XBRL accounts files: `download.companieshouse.gov.uk/en_monthlyaccountsdata.html`
- 75% of accounts arrive as XBRL/iXBRL. Parse these for structured financials. Don't pay an LLM for this.
- For v1: download monthly, batch-process, store extracted figures (turnover, PBT, employees, total assets, etc.) in a `financials` table.
- For v2: incremental daily files.

### What we deliberately do NOT fetch
- PDFs of accounts unless a user views them. Storing all of them is expensive and unnecessary.
- The full register snapshot. It's huge and we don't need it; we can reconstruct from streams + on-demand REST.

---

## 5. Data model

Detailed schema in `DATA_MODEL.md` (to be written as part of Phase 1). Headline tables:

```
companies
  company_number (PK), name, status, type, incorporated_on,
  registered_address (JSONB), sic_codes (text[]),
  last_full_refresh_at, raw (JSONB)

officers
  officer_id (PK, ours), companies_house_officer_link (text),
  forename, surname, dob_year, dob_month, nationality,
  occupation, country_of_residence, raw (JSONB)
  -- entity resolution defers to v2; for v1 each officer record is per-appointment

appointments
  id (PK), company_number (FK), officer_id (FK),
  role, appointed_on, resigned_on, raw (JSONB)

filings
  transaction_id (PK), company_number (FK), category, type,
  description, date, paper_filed, links (JSONB), raw (JSONB)

psc
  id (PK), company_number (FK), kind, name, nationality,
  natures_of_control (text[]), notified_on, ceased_on, raw (JSONB)

financials  -- from XBRL parsing
  id (PK), company_number (FK), period_end, turnover,
  profit_before_tax, total_assets, employees, raw_xbrl_url

events  -- append-only stream log
  id (PK), source ('stream'|'rest'|'bulk'), resource_kind,
  resource_id, published_at, fields_changed (text[]),
  raw (JSONB), processed_at

anomalies
  id (PK), kind ('address_cluster'|...), key (e.g. address hash),
  detected_at, score, summary_short, raw_data (JSONB),
  ai_explanation_id (FK nullable)

ai_summaries  -- canonical cache for all LLM outputs
  id (PK), kind ('company_narrative'|'anomaly_explanation'|...),
  input_hash (unique), model, prompt_version, output (text),
  output_tokens, generated_at

llm_calls  -- audit log, every single call
  id (PK), summary_id (FK), user_id (FK nullable),
  model, input_tokens, output_tokens, cost_pence,
  cached_hit (bool), called_at

users
  id (PK), email, created_at, plan ('free'|'pro'),
  stripe_customer_id, daily_ai_quota_used, quota_reset_at

quotas_daily
  date (PK), llm_calls, llm_cost_pence, distinct_users
```

### Indexing
- `companies(name)` — `tsvector` GIN index.
- `companies(registered_address->>'postal_code')` — for area searches.
- `officers(surname, forename)` — btree composite.
- `filings(company_number, date DESC)` — for company filing history pages.
- `events(published_at DESC)` — live feed.

---

## 6. AI policy (THIS IS THE IMPORTANT ONE)

This section is normative. Anything that touches the LLM API must comply with it. Cross-link from `AI_POLICY.md`.

### Hard rules
1. **Users never write prompts.** Every LLM call is triggered by a button or a system event with a fixed, code-controlled prompt template. No textboxes feed an LLM, ever.
2. **Every LLM call has explicit `max_tokens`.** No call without an output cap.
3. **Every LLM call goes through the LLM gateway service.** The gateway is the only thing that holds the API key.
4. **Every LLM output is cached by input hash.** Hash = SHA256 of (prompt template version + canonicalised inputs). If hash exists, return cached.
5. **Every LLM call is logged in `llm_calls`** with token counts, cost in pence, and cache-hit flag.
6. **Daily and monthly platform-wide spend caps.** When daily cap is hit, gateway returns "AI features paused" for new generations; cached results still served. Cap is **`[DECISION]`** — initial recommendation: £5/day, £100/month.
7. **Per-user rate limits.** Anonymous (by IP): 3 new generations/day. Free signed-in: 10/day. Pro: 200/day. Tracked in Redis.
8. **Anthropic console workspace cap** set 20% above monthly cap as a final fallback.
9. **Async by default.** New generations are queued, not synchronous. UI shows "generating, refresh in ~30s." Lets us throttle platform-wide.
10. **Outputs labelled "AI generated, [date]"** in the UI, always.

### Model routing
- **Haiku 4.5** for bulk + cheap operations:
  - Per-filing one-line summaries.
  - Anomaly explanations (templated, structured).
  - First pass on company narratives.
- **Sonnet 4.6** for nuanced operations only:
  - Multi-document company narratives with conflict resolution between sources.
  - **`[DECISION]`** Decide per-feature; default to Haiku unless quality is provably insufficient.
- **Opus** is forbidden in v1.

### Prompt versioning
- Each prompt template lives in a versioned file: `apps/llm-gateway/prompts/company_narrative_v1.txt`.
- Cache key includes prompt version. Bumping a prompt version invalidates that prompt's cache.
- Never edit a prompt in place — bump the version.

### What gets summarised
v1 menu (one feature ships at launch, others phase in):
- **MVP**: anomaly explanations only.
- **Phase 2 of v1**: company narrative summaries (on-demand, cached).
- **Phase 3 of v1**: filing one-liners for SH01, articles changes, charges, insolvency notices (deterministic for confirmation statements and accounts; those don't need AI).

### Abuse mitigation
- Cloudflare Turnstile on every endpoint that triggers a new generation.
- Per-IP and per-user generation logs reviewed weekly for patterns.
- If a user account exceeds reasonable use even within quota (e.g. perfectly hitting the cap every day), human review.

---

## 7. Anomaly detection: address clustering (the v1 wedge)

This is the one feature that makes the project share-able. Build it well.

### Detection (deterministic, no LLM)
Run every 10 minutes via cron:

```sql
-- pseudo-SQL
SELECT
  normalise_address(registered_address) AS addr_hash,
  COUNT(*) AS company_count,
  COUNT(*) FILTER (WHERE incorporated_on > NOW() - INTERVAL '30 days') AS recent_count,
  array_agg(DISTINCT officer_id) AS officers,
  ...
FROM companies c
JOIN appointments a ON a.company_number = c.company_number
WHERE c.status = 'active'
GROUP BY addr_hash
HAVING COUNT(*) FILTER (WHERE incorporated_on > NOW() - INTERVAL '30 days') >= 10
ORDER BY recent_count DESC;
```

Address normalisation needs care: same flat written 6 different ways. Use a postcode + first-line-of-address normaliser. **`[DECISION]`** Build our own simple normaliser in v1, evaluate libraries (`postal`, `libpostal-py`) for v2.

### Scoring (rules, not ML)
- Recent incorporation count.
- Director overlap (same N directors across the cluster).
- Dormancy ratio (mostly dormant = suspicious).
- Address type heuristic (residential postcode vs commercial).

Output a 0–100 score. Top N clusters surface on a `/anomalies` page.

### LLM explanation (Haiku, cached, ~300 output tokens)

Prompt template (v1):
```
You are summarising a Companies House data pattern for a public dashboard.
Be factual and precise. Do not speculate about intent. Do not use words like
"fraud", "scam", "shell", "illegal". State only what the data shows.

DATA:
- Address: {address}
- Total companies registered here: {total}
- Registered in the last 30 days: {recent}
- Directors involved: {director_count} ({top_directors_summary})
- Status breakdown: {active}/{dormant}/{dissolved}
- Common SIC codes: {top_sics}

In 2-3 sentences, describe the pattern in plain English. Mention any
ordinary explanation (e.g. accountancy practice, formation agent, virtual
office) where the data is consistent with one. Do not editorialise.
```

Output displayed with: "AI-generated summary based on public Companies House data. Patterns may have entirely benign explanations."

### Defamation safety
- Never use loaded language in prompts or templates.
- Display patterns, not conclusions.
- Have a `report this summary` link on every anomaly.
- Takedown SLA: 24 hours from receipt.

---

## 8. UX and pages (v1)

### Public pages
- `/` — Landing page. Headline + live feed strip + "search any UK company" + 3 currently-trending anomalies. No marketing fluff.
- `/feed` — Full live feed via SSE. Filters: filing type, region, company status. Pause button.
- `/c/[company-number]` — Company profile: header, structured filing history, officers, PSCs, financials chart (XBRL-derived), AI narrative button.
- `/o/[officer-slug]` — Officer page: appointments table, addresses-of-record. (Network view deferred.)
- `/anomalies` — List of address clusters with their AI explanations.
- `/anomalies/[id]` — Detail view of one cluster.
- `/search` — Search results (companies + officers + addresses).
- `/about` — What this is, who built it, sourcing.
- `/support` — Costs breakdown, donation links, sponsors.
- `/api-docs` — Documentation if we expose any read API.

### Authed pages (Phase 3)
- `/account` — Plan, usage, billing portal link.
- `/watchlists` — v2.

### Component library
- shadcn/ui as the base.
- One signature visual element to make the project demoable. **`[DECISION]`** Options:
  - Live filing ticker bar at top of every page (subtle, ambient).
  - Animated UK map of incorporations in the last hour on the landing page.
  - "Pulse" view of register activity over the last 24 hours.
  - Recommend: ticker bar + 24h pulse. Ambient + screenshot-able.

### Design direction
- Lean readable, not OSINT-aesthetic. Inter/Geist for UI, JetBrains Mono for codes/numbers.
- Light theme primary, dark theme well-supported.
- One accent colour (TBD), heavy use of grey scale.
- Mobile-responsive but desktop-first — this is a research tool.

---

## 9. Donations and pro tier

### Free tier (forever, never gated)
- Live feed, search, all profile pages.
- Cached AI outputs (someone else's already-generated summaries).
- Anomaly list with AI explanations.
- 3 new AI generations/day per IP, 10/day for signed-in free users.

### Support footer
Persistent line in the footer. Updated weekly from real data:
> Running on £{cost} this month. {n} supporters covering £{covered} of it. [Support →]

Link to `/support` page. No popups, no modals, no email collection.

### `/support` page contents
- One-paragraph pitch ("this is what it costs, this is what it does").
- Honest cost breakdown table: hosting, LLM, domain, time.
- Three CTAs in order: GitHub Sponsors (recurring), Buy Me a Coffee (one-off), Pro plan (recurring with features).
- Sponsor wall (logos at £25+/mo tiers, names at lower tiers, no random user names).

### Pro tier (Phase 3)
- £8/mo or £80/yr **`[DECISION]`** finalise pricing post-launch based on traffic.
- 200 AI generations/day.
- Watchlists with email alerts (v2 feature, gates pro launch).
- CSV/JSON exports of search results.
- Read API access with key (rate-limited).
- "Compare two companies" structured workflow.
- "Director timeline" structured workflow.

### What pro is NOT
- Not free-form prompts.
- Not access to "more powerful AI" (we use the same models for everyone).
- Not exclusive data (everything is in the free tier, just rate-limited).

---

## 10. Cost control implementation

This is the bit that, if done badly, destroys the project. Detail in `OPERATIONS.md`.

### LLM gateway service
Sole owner of the Anthropic API key. All other services call `gateway.generate(kind, inputs, user_id?)`.

Gateway responsibilities, in order on every call:
1. Compute input hash.
2. Lookup in `ai_summaries` by hash. If hit → log a cache hit in `llm_calls` (cost = 0), return cached.
3. Check global daily/monthly cap in Redis. If exceeded → return `{paused: true}`, no API call.
4. Check per-user quota in Redis. If exceeded → return `{quota_exceeded: true}`, no API call.
5. Check per-IP quota for anonymous. Same handling.
6. Pick model based on `kind`.
7. Build prompt from versioned template + inputs.
8. Call Anthropic with explicit `max_tokens`.
9. On response: write to `ai_summaries` and `llm_calls`, increment Redis counters.
10. Return output.

### Counters in Redis
- `llm:spend:daily:{YYYY-MM-DD}` — pence, INCRBY on each call.
- `llm:spend:monthly:{YYYY-MM}` — pence, INCRBY on each call.
- `llm:user:{user_id}:daily:{date}` — call count, INCR on each call.
- `llm:ip:{ip_hash}:daily:{date}` — call count, INCR on each call.

All keys have TTL set to expire automatically.

### Internal dashboard (`/admin` for project owner)
- Today's spend, this month's spend, vs caps.
- Cache hit rate (target: >80% within first month).
- Top users by generation count.
- Recent generations with token counts.
- Anomaly: hourly call rate vs 7-day baseline.

### Alerts
- Pagerduty/Healthchecks/Telegram bot ping when:
  - Daily spend > 50% of cap by 6pm.
  - Hourly call rate > 5x 7-day baseline.
  - Any single user generates >50 in an hour.
  - Cache hit rate <50% for the day.

---

## 11. Open source and licensing

- **Licence:** MIT or Apache 2.0. **`[DECISION]`** Default Apache 2.0 (better patent protection).
- **Repo:** Public from day one. Don't wait until "it's ready."
- **Contributing:** `CONTRIBUTING.md` with how to run locally, code style, PR process.
- **Self-host docs:** This product should be self-hostable. Docker compose for the full stack. Document all required env vars in `.env.example`.
- **Data licensing:** Companies House data is published under the OGL (Open Government Licence v3.0). We must attribute and pass through the licence on data we redistribute. AI-generated summaries are our own output — licence them MIT to match the codebase.

---

## 12. Build phases

### Phase 1 — Data pipeline (target: 2–3 weekends)
- [ ] Apply for Companies House REST and Stream API keys.
- [ ] Set up monorepo structure, basic CI (lint + tests).
- [ ] Provision Postgres, Redis, R2.
- [ ] Implement schema migrations.
- [ ] Build streamer process. Test against `/filing-history` first.
- [ ] Build worker that upserts events into Postgres.
- [ ] Backfill: pull recent state for ~1000 sample companies via REST so we have non-empty tables for development.
- [ ] Verify: streamer runs for 24h without dropping events; database grows; reconnects work.
- [ ] **Exit criteria:** I can `psql` and see filings flowing in real time.

### Phase 2 — Public read-only UI (target: 2–3 weekends)
- [ ] Next.js scaffold, Tailwind, shadcn/ui.
- [ ] `/` landing with live ticker via SSE.
- [ ] `/feed` with filters.
- [ ] `/c/[company]` profile page (no AI yet).
- [ ] `/o/[officer]` page.
- [ ] `/search` with Postgres tsvector backend.
- [ ] Cloudflare in front.
- [ ] **Exit criteria:** I can show a friend the live feed and a company profile.

### Phase 3 — Anomaly detection + AI (target: 2 weekends)
- [ ] Address normalisation utility + tests.
- [ ] Anomaly detector cron job.
- [ ] `/anomalies` and `/anomalies/[id]` pages.
- [ ] LLM gateway service.
- [ ] Anthropic key, hard cap, dashboard.
- [ ] First prompt: anomaly explanation v1.
- [ ] Cache layer + Redis counters + per-IP rate limit.
- [ ] **Exit criteria:** I can hit `/anomalies`, see real clusters, see AI explanations, and verify cache hits in the audit log.

### Phase 4 — XBRL financials + company narratives (target: 2 weekends)
- [ ] Bulk XBRL ingest job.
- [ ] `financials` table + parsed figures.
- [ ] Financials chart on company profile.
- [ ] Company narrative LLM feature (on-demand button).
- [ ] **Exit criteria:** Profile pages show 5 years of headline financials and an AI narrative.

### Phase 5 — Launch prep (target: 1 weekend)
- [ ] About page, support page, sourcing page.
- [ ] Self-host docs.
- [ ] LICENSE, README, CONTRIBUTING.
- [ ] Open repo.
- [ ] Soft-launch on Mastodon/Bluesky/X to OSINT/journalism circles.
- [ ] Twitter bot that auto-tweets the day's most interesting anomaly.

### Phase 6 — Pro tier (target: when traffic justifies)
- [ ] Auth (email magic link).
- [ ] Stripe integration.
- [ ] Watchlists and email alerts.
- [ ] CSV exports.
- [ ] Read API.

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| LLM cost runs away due to bug or attack. | Hard daily cap, console workspace cap, Cloudflare Turnstile, per-user rate limits, async generation. |
| Defamation claim from an anomaly summary. | Conservative prompt, factual-only language, takedown link, 24h SLA, no editorialising. |
| Companies House API rate limit blocks us. | Streaming API removes most polling; request rate limit uplift; backoff and retry. |
| Companies House launches an overlapping feature. | Watch their roadmap (the ECCT Act work is a signal). Differentiate on UX and the anomaly product. |
| Entity resolution does badly when we add network views. | Defer to v2 deliberately. Don't ship a half-baked director graph that misleads. |
| Personal data complaints (GDPR). | All data is public-by-statute. Have a clear data page citing OGL and the Companies Act. Have an erasure-request process for edge cases. |
| Solo maintainer burnout. | Open source from day one. Clear contributing docs. Don't promise SLAs. Pro tier funded operations, not feature-velocity promises. |
| Audience asymmetry (loud niche, small mass). | Expected. Plan for that growth shape. The Twitter-bot wedge is what unlocks reach. |

---

## 14. What success looks like (12 months out)

- Project runs unattended for weeks at a time without spend incidents.
- 1–5k DAU.
- 30–100 paying pro users covering operating costs.
- Genuine journalism cites the project at least once a month.
- 5+ external contributors with merged PRs.
- A second anomaly type ships (beyond address clustering).

If those things happen, this becomes a real thing. If they don't, you've still built something useful, the data pipeline is reusable, and you've learned the actual shape of running an AI-powered public product.

---

## 15. Decisions log

Every `[DECISION]` above gets resolved here as you make calls. Format: date, decision, reason. Add to this list rather than editing the body of the document.

| Date | Decision | Reason |
|---|---|---|
| 2026-04-29 | License: MIT | Widest adoption; Apache 2.0 patent clause not needed at this stage |
| 2026-04-29 | Hosting: Docker Compose (local) | Start simple; no cloud costs until traffic justifies it |
| 2026-04-29 | Queue backend: arq | Fits existing Redis dependency; simpler than dramatiq |
| 2026-04-29 | Address normalisation: simple v1 (pure Python) | libpostal is 2GB; defer to v2 if false-positive rate is unacceptable in production |
| 2026-04-29 | DB volumes: local bind-mount | Data survives container rebuilds; simpler than named Docker volumes for a solo project |

---

## 16. References

- Companies House developer docs: https://developer-specs.company-information.service.gov.uk
- Streaming API guide: https://developer-specs.company-information.service.gov.uk/streaming-api/guides/overview
- Bulk accounts data: https://download.companieshouse.gov.uk/en_monthlyaccountsdata.html
- Reference open-source streamer: https://github.com/mrbrianevans/companies-house-stream
- Open Government Licence v3.0: https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/
- Anthropic API docs: https://docs.claude.com
