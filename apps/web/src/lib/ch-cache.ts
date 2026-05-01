/**
 * Redis-backed cache wrapper around Companies House REST calls.
 *
 * Why: CH gives us 600 req/5min per API key. The web app, the worker, and
 * the streamer all share that key. When traffic spikes — or we backfill —
 * we burn through the budget and start getting 429s, which propagates to
 * users as "Couldn't reach Companies House" pages on cold-cache profiles.
 *
 * This wrapper caches successful and 404 responses in Redis (database 1,
 * separate from arq's database 0). 429s and 5xx are not cached so they
 * naturally recover. Cache key is the full path; TTL is per-call.
 *
 * Failure modes are silent: if Redis is unreachable, we fall through to
 * a live fetch as if there were no cache. The web app keeps working.
 */
import Redis from "ioredis";

let _redis: Redis | null = null;

function client(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    _redis = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      // Don't crash the process on Redis hiccups — fall through.
      enableOfflineQueue: false,
      reconnectOnError: () => true,
    });
    _redis.on("error", () => {
      /* swallow — we fall through to live fetch */
    });
  } catch {
    _redis = null;
  }
  return _redis;
}

export interface ChCachedResponse {
  ok: boolean;
  status: number;
  /** parsed JSON body, or null if response had no body / unparseable */
  data: unknown;
}

interface CachedPayload {
  status: number;
  data: unknown;
}

const CACHE_PREFIX = "ch:rest:";

// 24 hours. CH data changes slowly relative to our streamer's live ingestion,
// and the cache only matters for cold-cache profiles (companies not yet in
// our local DB). The streamer overwrites local DB live as new events arrive.
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
// 404 = "this company number doesn't exist". Stable forever in practice.
const NEGATIVE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * GET a CH REST path with Redis caching. Returns a Response-like envelope.
 *
 * - 200 responses are cached for `ttlSeconds` (default 24 h).
 * - 404 responses are cached for 30 days (negative cache — non-existent
 *   company numbers stay non-existent).
 * - 429 / 5xx are NOT cached so they recover when CH does.
 */
export async function chCachedGet(
  path: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<ChCachedResponse> {
  const key = process.env.CH_REST_KEY;
  if (!key) return { ok: false, status: 0, data: null };

  const redis = client();
  const cacheKey = CACHE_PREFIX + path;

  // 1. Try cache first
  if (redis) {
    try {
      const raw = await redis.get(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw) as CachedPayload;
        return {
          ok: cached.status >= 200 && cached.status < 300,
          status: cached.status,
          data: cached.data,
        };
      }
    } catch {
      /* fall through */
    }
  }

  // 2. Live fetch
  const token = Buffer.from(`${key}:`).toString("base64");
  let resp: Response;
  try {
    resp = await fetch(
      `https://api.company-information.service.gov.uk${path}`,
      { headers: { Authorization: `Basic ${token}` } },
    );
  } catch {
    return { ok: false, status: 0, data: null };
  }

  let data: unknown = null;
  if (resp.status !== 204) {
    try {
      data = await resp.json();
    } catch {
      data = null;
    }
  }

  // 3. Cache the result, but only the safe outcomes
  if (redis && (resp.ok || resp.status === 404)) {
    const payload: CachedPayload = { status: resp.status, data };
    const ttl = resp.status === 404 ? NEGATIVE_TTL_SECONDS : ttlSeconds;
    redis
      .set(cacheKey, JSON.stringify(payload), "EX", ttl)
      .catch(() => {
        /* swallow — caching is best-effort */
      });
  }

  return { ok: resp.ok, status: resp.status, data };
}
