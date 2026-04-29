# AI Policy

> Companion to `BUILD_PLAN.md`. This document is **normative**. Anything that touches the LLM API must comply with it. If you are reading this as Claude Code: you do not deviate from these rules without an explicit instruction from the project owner that overrides a specific clause. "Best effort" implementation is not acceptable.

---

## 0. Why this document exists

Three things kill open-source AI-powered projects:
1. **Cost runaway.** A bug, a bot, or a viral moment turns a £50/month bill into a £5,000 one overnight.
2. **Trust erosion.** Users stop trusting AI outputs because they're unlabelled, inconsistent, or wrong in invisible ways.
3. **Defamation and harm.** AI generates a confident-sounding sentence about a real person or business that is wrong, prejudicial, or actionable.

This policy is the set of rules that keep all three at bay. Each rule is here because skipping it would break one of those guarantees.

---

## 1. Hard rules (no exceptions)

These are not guidelines. Code that violates them is broken and must be fixed before merging.

1. **Users never write prompts.** No textbox, dropdown-with-free-text, file upload, URL parameter, or HTTP body field is ever passed to an LLM as part of a prompt. Every LLM call is triggered by a button or a system event whose prompt template is fixed in code at build time. *No exceptions.*

2. **Every LLM call goes through the gateway service.** The Anthropic API key exists in exactly one environment, on one service. Web app, worker, and cron jobs call the gateway over HTTP. They do not have the API key. They cannot call Anthropic directly. CI rejects any commit that imports `anthropic` outside `apps/llm-gateway/`.

3. **Every LLM call has explicit `max_tokens`.** Calls without an output cap are rejected by the gateway. The cap is set per-feature, conservatively (see §6).

4. **Every LLM output is cached by input hash.** `input_hash = SHA256(prompt_version || canonical_json(inputs))`. Before any call, the gateway checks `ai_summaries` for `(kind, prompt_version, input_hash)`. If found, it returns the cached output and logs a `cached=true` row in `llm_calls`. No API call is made.

5. **Every LLM call is logged in `audit.llm_calls`** with token counts, cost in pence, outcome, and cache-hit flag. This includes cache hits (cost = 0) and failures. The log is the source of truth for spend.

6. **Hard daily and monthly platform-wide caps.** When the daily cap is reached, the gateway refuses new generations and returns `{outcome: 'platform_paused'}`. Cached results continue to serve. Initial caps: **£5/day, £100/month** (revised quarterly).

7. **Per-user/IP rate limits.** Anonymous: 3 generations/day per IP-hash. Free signed-in: 10/day. Pro: 200/day. Enforced in Redis with TTL-keyed counters.

8. **Anthropic console workspace cap** set at 120% of monthly cap. This is the seatbelt that catches a logic bug bypassing the gateway's own counter.

9. **New generations are async.** The web app posts to the gateway, which queues the job and returns immediately. The UI shows "generating, refresh in ~30s." This decouples user request volume from API call volume — we throttle the queue, not the user.

10. **AI outputs are labelled.** Every AI-generated piece of text in the UI carries: a clear "AI generated" badge, the date generated, and the model name. No exceptions, no "subtle" branding. The user always knows they're reading machine output.

11. **No user-supplied data is ever sent to the LLM.** The only inputs to a prompt are (a) data the gateway has fetched from our own database and (b) parameters from a fixed enum (e.g. `kind=company_narrative`, `company_number=12345678`). User-typed text never reaches a model.

12. **No PII beyond what is already public is sent to the LLM.** Officer DoBs (year/month only — we don't store the day), names, and addresses are public-by-statute. Email addresses, IP addresses, payment details, and any internal user data never enter a prompt.

13. **Opus is forbidden in v1.** Default to Haiku. Use Sonnet only where Haiku has been measurably shown to fail at the task. No model upgrades without an explicit decision recorded in `BUILD_PLAN.md` §15.

14. **Prompts are versioned.** Each prompt template lives in a versioned file (e.g. `prompts/anomaly_explanation_v3.txt`). Prompts are never edited in place — bumping the version creates a new file. The cache key includes the prompt version, so a bump invalidates that prompt's cache, forcing regeneration on next access.

15. **No retries on the LLM call itself.** If a generation fails (timeout, rate-limit, API error), the gateway logs the failure and returns it to the caller. The caller may surface "try again later" to the user but the gateway does not silently retry — that's a cost-multiplier waiting to happen.

---

## 2. The LLM gateway service

Sole owner of the Anthropic API key. Only service in the stack with the credential. Lives at `apps/llm-gateway/`.

### Public interface

A single endpoint:

```
POST /v1/generate
  body: {
    kind: enum,
    inputs: object,         // structured, validated against per-kind schema
    user_id: uuid | null,
    ip_hash: string | null,
    source: 'web' | 'api' | 'cron'
  }
  returns: {
    outcome: 'success' | 'cached' | 'queued' | 'quota_exceeded' |
             'platform_paused' | 'rate_limited' | 'error',
    summary_id: uuid | null,
    output: string | null,
    is_async: boolean,
    estimated_ready_at: timestamp | null
  }
```

### Per-call algorithm (in this exact order)

```
1. Validate kind ∈ allowed kinds
2. Validate inputs against the schema for that kind
3. Compute input_hash = SHA256(prompt_version + canonical_json(inputs))
4. SELECT from ai_summaries WHERE (kind, prompt_version, input_hash)
   IF FOUND:
     Log llm_calls with cached=true, cost_pence=0, outcome='cached'
     Return summary
5. Check Redis: llm:spend:daily and llm:spend:monthly
   IF either ≥ cap:
     Log llm_calls with outcome='platform_paused'
     Return {outcome: 'platform_paused'}
6. Check Redis: per-user or per-IP daily counter
   IF ≥ user's plan limit:
     Log llm_calls with outcome='quota_exceeded' or 'rate_limited'
     Return appropriate outcome
7. IF source != 'cron' AND queue_depth > N:
     Enqueue job, log llm_calls with outcome='queued'
     Return {outcome: 'queued', estimated_ready_at: ...}
   ELSE proceed synchronously.
8. Pick model from the kind's routing config
9. Render prompt = template(prompt_version, inputs)
10. Call Anthropic with explicit max_tokens
11. ON SUCCESS:
      Insert ai_summaries row
      Insert llm_calls row with token counts and cost
      INCRBY Redis spend counters
      INCR Redis user/IP counter
      Return {outcome: 'success', summary_id, output}
    ON FAILURE:
      Log llm_calls with outcome='error' and error_message
      DO NOT increment any counter
      Return {outcome: 'error'}
```

### What the gateway is **not** allowed to do

- Make speculative calls "to warm the cache." All calls are demand-driven or cron-driven.
- Call the LLM in a loop within a single request.
- Stream responses to clients in v1. (Streaming makes cost accounting harder. v2 if there's a reason.)
- Accept inputs that haven't been validated against a per-kind JSON schema.
- Accept a `kind` that isn't in the allowlist.
- Be reachable from outside the private network (no public ingress).

### Rate limiting the gateway itself

Even though only our own services call it, the gateway has a process-wide rate limit (e.g. 30 LLM-bound calls/sec). This protects against bugs in a worker that hot-loops calling it.

---

## 3. Allowed `kind`s and their routing

This is the v1 allowlist. Adding a new `kind` requires:
- A new entry in this section.
- A versioned prompt template.
- A JSON schema for `inputs`.
- An entry in the gateway's routing table.
- A test that exercises the prompt with realistic data.

| kind | model | max_tokens | typical input size | est. cost/call | cache fixed? |
|---|---|---|---|---|---|
| `anomaly_explanation` | Haiku 4.5 | 350 | ~600 tokens | <£0.005 | yes — same cluster + same data → same hash |
| `company_narrative` | Haiku 4.5 (Sonnet for FTSE/PLC) | 600 | ~3000 tokens | £0.005–£0.04 | yes — hash of (company_number, filings_fingerprint, financials_fingerprint) |
| `filing_one_liner` | Haiku 4.5 | 80 | ~200 tokens | <£0.001 | yes — keyed on transaction_id alone |
| `compare_two_companies` (Pro only) | Sonnet 4.6 | 800 | ~6000 tokens | £0.05–£0.10 | yes — hash of both companies' fingerprints |
| `director_timeline` (Pro only) | Sonnet 4.6 | 700 | ~5000 tokens | £0.04–£0.08 | yes — hash of officer_id + appointments fingerprint |

All new kinds default to Haiku. Sonnet only where the multi-document reasoning has been shown to matter.

---

## 4. Prompt design rules

### General principles

- **System prompt sets the constraints.** Tone, what not to say, output format.
- **User prompt carries the data.** Structured, labelled, no editorial framing.
- **Output is short by default.** If the user wants more detail, they read the underlying data. We are not a chatbot.

### Mandatory clauses in every system prompt

Every prompt template in this project includes these clauses near the top of the system prompt, paraphrased to fit the task:

1. **"State only what the data shows. Do not speculate, infer intent, or assign motive."**
2. **"Avoid loaded language: 'fraud', 'scam', 'shell', 'illegal', 'suspicious', 'criminal', 'tax avoidance/evasion', 'money laundering', 'sanctions evasion'. Do not use these words even when describing patterns that resemble them."**
3. **"Where a pattern has an ordinary commercial explanation (formation agent, virtual office, group company, accountancy practice), name it explicitly."**
4. **"If the data is sparse or ambiguous, say so plainly. Do not fill gaps with plausible-sounding inference."**
5. **"Output [X] sentences in plain English. No headers, no markdown, no lists."** (Unless the kind explicitly wants structured output.)

### Canonical example: `anomaly_explanation_v1`

```
SYSTEM:
You are summarising a Companies House data pattern for a public dashboard.
Your output appears under the heading "What this looks like" alongside the
raw data and a link to the underlying records.

Rules:
- State only what the data shows.
- Do not speculate about intent. Do not assign motive.
- Avoid these words entirely: fraud, scam, shell, illegal, suspicious,
  criminal, tax avoidance, tax evasion, money laundering, sanctions evasion.
- Where the data is consistent with an ordinary commercial explanation
  (e.g. registered office service, formation agent, accountancy practice,
  virtual office, group company structure), name that explanation explicitly.
- If the data is sparse, say so. Do not fill gaps.
- Output 2 to 3 sentences in plain English. No headers, no lists, no markdown.

USER:
Pattern type: address cluster

Data:
- Address: {address_one_line}
- Total active companies registered here: {total_active}
- Companies dissolved at this address: {total_dissolved}
- Companies registered in the last 30 days: {recent_30}
- Companies registered in the last 90 days: {recent_90}
- Distinct directors involved: {director_count}
- Top 5 directors by appointment count at this address:
{top_directors_block}
- Most common SIC code: {top_sic} ({top_sic_count} companies)
- Postcode area: {postcode_district}
- Address type signal: {address_type_signal}
  ('residential' | 'commercial' | 'mixed' | 'unknown')

Describe the pattern. Two to three sentences.
```

Notice what the prompt does NOT do:
- It does not pass any user input.
- It does not pass the LLM the company names or registration numbers (cluster-level, not company-level).
- It does not ask the model to "assess risk" or "rate suspicion."
- It does not include the project's own branding or personality.

### Prompt versioning rules

- Filename pattern: `prompts/{kind}_v{n}.txt`.
- Bumping the version creates a new file. **Never edit a previous version.**
- Cache key includes the version, so the cache for the old version is unaffected.
- The default version for each kind is set in `prompts/_versions.json`. Switching default versions is a deploy.
- A/B testing new prompt versions: route 10% of traffic to the new version by setting the version per-request from the gateway. Compare cost, latency, and (manually sampled) quality before flipping.

---

## 5. What gets summarised, and when

### Anomaly explanations
- Generated when a new cluster crosses the score threshold.
- Triggered by the anomaly cron job, not by a user.
- Cache lifetime: until the cluster's `features` JSONB changes substantively (any feature shifts by >10% or director set changes). Then a regeneration is queued.

### Company narratives
- Generated **on demand** when a user clicks "Generate plain-English summary" on a company page.
- For the first user, it queues; subsequent users see the cached output.
- Cache invalidated by: any change to filings count, financials parsed, officer set, status. Computed via a `summary_fingerprint` on the company.
- For "interesting" companies (FTSE 100/250, PLCs, anything with media coverage we track), pre-generate once a quarter to avoid the first-user-pays cold cache. Done by a low-priority cron — explicit "warm the cache" calls **are** allowed for this narrow case but require a flag in the gateway request and stricter rate limiting.

### Filing one-liners
- Generated lazily for the displayed filings on a profile page.
- Common filing types (CS01 confirmation statements, dormant accounts, AP01 appointments) have **deterministic templates, not LLM output.** Only narrative-rich filings (SH01 share allotments, articles changes, charges, insolvency notices) get LLM treatment.
- Per-page budget: at most 5 LLM-generated one-liners per profile page view, cached forever (filings don't change after they're filed).

### What never gets summarised
- Confirmation statements (CS01) — entirely structured data, render from the `description_values`.
- Annual accounts where we have XBRL — render the chart, don't ask the LLM to describe the chart.
- Officer appointments — deterministic template ("Appointed as director on {date}").
- PSC notifications — structured.

The principle: **we use the LLM where the source data is genuinely free-text or where multi-document synthesis adds something a template can't.** Everywhere else, deterministic rendering is faster, free, and more accurate.

---

## 6. Token budgeting

Per-feature `max_tokens` ceilings (output, not input):

| Feature | max_tokens | Rationale |
|---|---|---|
| anomaly_explanation | 350 | 2-3 sentences fit in ~150; ceiling allows for the rare longer cluster |
| company_narrative | 600 | A short paragraph plus a sentence on recent changes |
| filing_one_liner | 80 | One sentence, hard cap |
| compare_two_companies | 800 | Two short paragraphs |
| director_timeline | 700 | A few sentences |

Input size is bounded too. The gateway truncates structured inputs to a per-kind input cap before sending. If the truncation matters for quality, it's logged and we revisit.

---

## 7. Cost model and caps

### Headline numbers (Anthropic prices as of project planning, recheck quarterly)

- Haiku 4.5: roughly $1/M input tokens, $5/M output tokens.
- Sonnet 4.6: roughly $3/M input tokens, $15/M output tokens.
- Cache reads (Anthropic prompt caching, separate from our SQL cache): considerably cheaper than fresh input — useful when prompts share a large stable preamble. Worth implementing in v1 only for templates with >2k stable preamble tokens.

### Daily cap maths

At £5/day with the routing in §3, a worst-case all-Haiku day looks like:
- ~20,000 anomaly_explanation calls, OR
- ~10,000 company_narrative calls, OR
- ~80,000 filing_one_liner calls

Real distribution will be a mix and most calls will be cache hits. The cap is set so that even a "viral hour" doesn't blow the budget.

### Monthly cap maths

£100/month covers steady state plus headroom for one viral day. Revisit quarterly with actual data. If sustained traffic justifies an increase, raise it deliberately and update the workspace cap in lockstep.

### Console workspace cap

Set in the Anthropic console at **120% of monthly cap**. This is the absolute fallback if our own counters fail (Redis loss, gateway bug, etc.). Beyond this, the API itself returns errors, capping the worst case at ~£120/month.

---

## 8. Caching strategy

### Cache layers, in order

1. **SQL cache (`ai_summaries`).** Persistent. Keyed on `(kind, prompt_version, input_hash)`. The vast majority of cost savings live here.
2. **Anthropic prompt caching.** Consider for `company_narrative` and `compare_two_companies` where a multi-paragraph system prompt is shared across many calls. Off by default in v1.
3. **CDN cache for AI-bearing pages.** Anomaly pages, company pages, etc. are cached at the edge for 60 seconds. A cached page reading from `ai_summaries` is two orders of magnitude cheaper than even a SQL cache hit.

### Cache hit rate target

By month two of operation, cache hit rate should be **>80%**. Lower than that means either:
- The hash is too specific (inputs change too often).
- The feature is too long-tail (every call is unique data).
- A bot is iterating through fresh inputs.

The operations dashboard tracks hit rate daily. Below 70% triggers an investigation.

### Invalidation

- Prompt version bump → cache for that prompt version is dead-on-arrival; regeneration on demand.
- Underlying data change → upstream code computes a new fingerprint, hash changes, cache miss, regeneration.
- Manual invalidation → admin endpoint to drop a single `ai_summaries` row by ID, with audit logging.
- **No bulk cache flush.** If you find yourself wanting one, something is wrong upstream.

---

## 9. Rate limiting and quotas

### Tiers

| Tier | Daily generation budget | Notes |
|---|---|---|
| Anonymous (per IP-hash) | 3 | Counter expires daily |
| Free (signed in) | 10 | Encourages sign-up without making it mandatory |
| Pro | 200 | Realistic ceiling for power users |
| Banned | 0 | Cannot generate at all |

"Generation budget" = new generations only. Cache hits are unlimited.

### IP hashing

Anonymous rate limiting uses `sha256(ip || daily_salt)`. The salt rotates daily and lives only in Redis, so:
- Within a day, the same IP collides to the same hash → quota works.
- Across days, the hash is unjoinable → no long-term tracking.
- We do not log raw IPs anywhere (Cloudflare may have them in their own logs; that's their concern).

### Quota response

When a user is over quota, the API returns `outcome: 'quota_exceeded'` and a friendly message. The UI shows the cached generation if one exists, plus a banner: "You've hit today's AI limit. [Sign in / upgrade for more.]"

When the platform is paused, the message is different: "AI features are paused for today to manage costs. Cached results are still available." This is honest about why.

### Bypassing quotas

- Cron jobs (anomaly explanations, scheduled cache warming) are tagged `source: 'cron'` and bypass per-user quotas. They are still subject to platform caps.
- Admins (project owner accounts) bypass per-user quotas but not platform caps.

---

## 10. Abuse mitigation

### Cloudflare Turnstile

Required on every endpoint that triggers a new generation. Specifically: the "Generate summary" button and the Pro-only structured workflow buttons. Not required on read endpoints. Not required for cache hits (the user isn't generating anything new).

### Bot detection

Cloudflare's bot-fight mode handles most of it. Beyond that:
- A user account that exceeds 80% of its quota every day for 7 consecutive days gets a manual review.
- An IP-hash that consistently appears at exactly its limit is flagged for review.
- Patterns: requests perfectly evenly spaced in time, identical user-agent strings, no other engagement on the site.

### When abuse is detected

1. Investigate. Often it's a real user with a research project; talk to them.
2. If genuinely abusive: ban the account and/or block at Cloudflare.
3. If a bot is using a paid account: refund and ban (Stripe makes this clean).
4. Document each incident in `OPERATIONS.md` runbook.

---

## 11. Defamation and harm mitigation

The single highest-risk surface in this project is anomaly explanations. A confidently-worded sentence about a real address could damage a real business.

### Safety design

1. **The prompt does the work.** The §1 mandatory clauses and the kind-specific prompt rules constrain the model to factual, non-judgemental output. The forbidden-words list is explicit.
2. **No company names in cluster-level outputs.** The anomaly_explanation prompt receives the address and aggregate counts; it never receives company names. This makes it structurally hard for the model to defame a specific business.
3. **No director names in outputs by default.** The cluster prompt receives a top-N director count, not full names. We display director names in the UI from the structured data, separately.
4. **Every anomaly explanation has a "Report this summary" link.**
5. **Takedown SLA: 24 hours** from receipt of a reasoned request to removal or edit.
6. **Quarterly red-team review.** The project owner (or a delegate) samples 20 anomaly explanations and rates them for problematic language. Issues feed prompt version bumps.

### What we will not do

- We will not allow the LLM to express a confidence score, a risk rating, or a colour-coded badge ("HIGH RISK", "GREEN", etc.). These translate inherently uncertain pattern detection into a definite-feeling judgement.
- We will not let the LLM name specific individuals as the "operator" of a cluster, even if the structured data makes them a likely candidate.
- We will not surface anomaly summaries via push notifications, alerts, or social media auto-posts without an extra layer of human review (the Twitter bot in `BUILD_PLAN.md` posts the *data* — counts, address — not the AI explanation).

### Records

`public.anomalies` has takedown columns. Every takedown request and response is logged there with timestamps. Annual review of takedowns informs prompt revisions.

---

## 12. Incident response

If LLM spend exceeds expected behaviour, the response sequence is:

1. **Detect.** Alerts (see `OPERATIONS.md`) fire when:
   - Hourly spend > 5x 7-day baseline.
   - Daily spend > 50% of cap by 6pm UTC.
   - A single user generates > 50/hour.
   - Cache hit rate < 50% for the day.

2. **Contain.** First action is always: lower the daily cap in Redis to the current spend level. This stops the bleeding immediately. Do this *before* investigating.

3. **Investigate.** Common causes, in rough order of likelihood:
   - A bug introduced in a recent deploy (rollback).
   - A scraper hammering an endpoint (block at Cloudflare).
   - A legitimate viral moment (decide whether to raise the cap).
   - A quota-bypass bug (find and fix).

4. **Communicate.** If the platform was paused, the support page banner reflects it. If a deploy bug caused the spike, a brief postmortem in the repo's incidents folder.

5. **Adjust.** Update caps, alerts, or code based on what was learned.

---

## 13. Ethics review per kind

Before any new `kind` ships, the project owner answers these questions in writing (commit to the repo):

1. **What human harm could this output cause?** (defamation, privacy violation, encouragement of harassment, etc.)
2. **What's the worst plausible mistake this model could make on this task?**
3. **What signals would tell us the feature is being misused?**
4. **Can we ship a deterministic version first?** If yes, do.
5. **What would lead us to remove this feature?**

The answers live in `docs/ethics/{kind}.md`. They're consulted on quarterly review.

---

## 14. What is explicitly out of scope

These are tempting and we are not doing them in v1:

- **Chat interface.** No "ask anything about UK companies." See rule 1.
- **Embeddings/RAG.** No vector store, no semantic search over filings, no "similar companies." Costly, hard to get right, weak fit for the use case in v1.
- **Fine-tuned models.** No.
- **OpenAI/Gemini fallback.** Single-vendor in v1 keeps the policy simple.
- **Multi-language outputs.** English only. Adding languages multiplies the prompt-version surface area.
- **Image generation.** Companies House data is text. No image features.
- **Audio summaries.** No.
- **Per-user prompt customisation** ("explain this in the style of..."). No, see rule 1.

Each of these may be revisited in v2 with explicit ethics review and budget review.

---

## 15. Quarterly review

Once per quarter, the project owner reviews:

1. **Spend.** Actual vs cap, by feature. Adjust caps if needed.
2. **Cache hit rates.** Per-kind. Investigate any < 70%.
3. **Quality.** Sample 20 outputs per kind, rate them. Flag any patterns of error.
4. **Ethics.** Re-read the per-kind ethics docs. Anything that has aged badly?
5. **Anthropic pricing.** Update the cost model in §7 if pricing has shifted.
6. **Model availability.** New Anthropic models? Worth migrating from Haiku 4.5 to its successor? Migration is a prompt-version bump per kind.

The review output is a one-page note in `docs/ai-reviews/{YYYY-Qn}.md`.

---

## 16. Glossary

- **Generation** — a fresh LLM call resulting in a new `ai_summaries` row.
- **Cache hit** — a request that found an existing `ai_summaries` row and did not call the API.
- **Kind** — a fixed type of LLM use (e.g. `anomaly_explanation`). Each kind has one prompt template at a time.
- **Prompt version** — a numbered iteration of a kind's prompt. Bumping it invalidates the kind's cache.
- **Input hash** — `SHA256(prompt_version + canonical_json(inputs))`. The cache key.
- **Cap** — a hard ceiling on spend, enforced platform-wide.
- **Quota** — a per-user/IP daily generation budget.
- **Gateway** — the LLM gateway service. Sole owner of the API key.
