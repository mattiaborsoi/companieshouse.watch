import { NextRequest, NextResponse } from "next/server";
import { getAnomaly, type AnomalyFeatures } from "@/lib/db";

const GATEWAY_URL = process.env.LLM_GATEWAY_URL ?? "http://localhost:8000";

// Simple per-IP sliding-window rate limiter: max 5 requests per 10 minutes.
// In-memory is correct for a single-instance deployment.
const _rateLimitWindow = 10 * 60 * 1000; // 10 min in ms
const _rateLimitMax = 5;
const _ipTimestamps = new Map<string, number[]>();

function _checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - _rateLimitWindow;
  const hits = (_ipTimestamps.get(ip) ?? []).filter(t => t > cutoff);
  if (hits.length >= _rateLimitMax) return false;
  hits.push(now);
  _ipTimestamps.set(ip, hits);
  // Prevent unbounded map growth: evict entries older than window
  if (_ipTimestamps.size > 5_000) {
    for (const [k, v] of _ipTimestamps) {
      if (v.every(t => t <= cutoff)) _ipTimestamps.delete(k);
    }
  }
  return true;
}

function _clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

// postgres.camel also camelizes JSONB keys; convert back to snake_case for the Python gateway
function featuresToSnake(f: AnomalyFeatures) {
  // Handle both camelCase (postgres.camel) and snake_case (raw) key shapes
  const raw = f as unknown as Record<string, unknown>;
  const get = (snake: string, camel: string) => raw[snake] ?? raw[camel];
  return {
    // address_cluster fields
    address_line_1:        get("address_line_1", "addressLine1") as string | undefined,
    postcode:              get("postcode", "postcode") as string | undefined,
    locality:              get("locality", "locality") as string | undefined,
    recently_incorporated: (get("recently_incorporated", "recentlyIncorporated") as number) ?? 0,
    shared_directors:      (get("shared_directors", "sharedDirectors") as number) ?? 0,
    // director_velocity fields
    officer_id:            get("officer_id", "officerId") as string | undefined,
    officer_name:          get("officer_name", "officerName") as string | undefined,
    nationality:           raw["nationality"] as string | undefined,
    recent_90_days:        (get("recent_90_days", "recent90Days") as number) ?? 0,
    recent_30_days:        (get("recent_30_days", "recent30Days") as number) ?? 0,
    // bulk_registration fields
    inc_date:              get("inc_date", "incDate") as string | undefined,
    companies_on_day:      (get("companies_on_day", "companiesOnDay") as number) ?? 0,
    formation_agent:       (get("formation_agent", "formationAgent") as boolean) ?? false,
    // officer_churn fields
    status:                raw["status"] as string | undefined,
    incorporated_on:       get("incorporated_on", "incorporatedOn") as string | undefined,
    appointments_90d:      (get("appointments_90d", "appointments90d") as number) ?? 0,
    terminations_90d:      (get("terminations_90d", "terminations90d") as number) ?? 0,
    total_churn:           (get("total_churn", "totalChurn") as number) ?? 0,
    // common
    company_count:         (get("company_count", "companyCount") as number) ?? 0,
    companies:             (get("companies", "companies") as AnomalyFeatures["companies"]) ?? [],
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!_checkRateLimit(_clientIp(req))) {
    return NextResponse.json(
      { error: "Too many requests — try again in a few minutes." },
      { status: 429 }
    );
  }

  const { id } = await params;

  const anomaly = await getAnomaly(id);
  if (!anomaly) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "anomaly_explanation",
        anomaly_id: anomaly.id,
        features: { ...featuresToSnake(anomaly.features), anomaly_kind: anomaly.kind },
        source: "web_ui",
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = (body as { detail?: string }).detail ?? "AI service error";
      const status = res.status === 429 ? 429 : 502;
      return NextResponse.json({ error: detail }, { status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Gateway unreachable", err);
    return NextResponse.json({ error: "AI service unavailable" }, { status: 503 });
  }
}
