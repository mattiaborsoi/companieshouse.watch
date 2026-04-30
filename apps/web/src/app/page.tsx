import { Suspense } from "react";
import Link from "next/link";
import { getStats, getRecentFilings, getRecentActivity, getAnomalies, getRecentFilingEvents } from "@/lib/db";
import LiveTicker from "@/components/ui/LiveTicker";
import SearchBox from "@/components/ui/SearchBox";
import Marquee from "@/components/ui/Marquee";
import { filingCategoryLabel, filingCategoryColor, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

// ─── Stats row ────────────────────────────────────────────
async function StatsRow() {
  const s = await getStats();
  const fmt = (n: number) => n.toLocaleString("en-GB");
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Filings today", value: fmt(s.filingsToday) },
          { label: "Companies",     value: fmt(s.companies) },
          { label: "Officers",      value: fmt(s.officers) },
          { label: "PSCs",          value: fmt(s.pscs) },
        ].map(({ label, value }) => (
          <div key={label} className="stat-card">
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>
      <p className="font-mono text-[10px] text-[var(--text-muted)] px-0.5">
        Local database growing as the stream runs · Companies House registers ~5.6M entities in total
      </p>
    </div>
  );
}

// ─── Recent filings table ──────────────────────────────────
async function RecentFilingsTable() {
  const filings = await getRecentFilings(30);
  if (!filings.length) return null;
  return (
    <div className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-surface)]"
         style={{ boxShadow: "var(--panel-shadow)" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Category</th>
            <th className="hidden sm:table-cell">Type</th>
            <th className="text-right">Date</th>
          </tr>
        </thead>
        <tbody>
          {filings.map((f) => (
            <tr key={f.transactionId}>
              <td>
                <Link href={`/c/${f.companyNumber}`}
                  className="font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors">
                  {f.companyName}
                </Link>
                <div className="font-mono text-[10px] text-[var(--text-muted)] mt-0.5 tracking-wide">
                  {f.companyNumber}
                </div>
              </td>
              <td>
                <span className={`badge border ${filingCategoryColor(f.category)}`}>
                  {filingCategoryLabel(f.category)}
                </span>
              </td>
              <td className="hidden sm:table-cell font-mono text-xs text-[var(--text-secondary)]">
                {f.type}
              </td>
              <td className="text-right font-mono text-xs text-[var(--text-muted)]">
                {formatDate(f.filingDate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Anomaly highlights ───────────────────────────────────
async function AnomalyHighlights() {
  const anomalies = await getAnomalies(5);
  if (!anomalies.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="section-label">Anomalies detected</h2>
          <span className="badge border bg-red-950 text-red-300 border-red-800 font-mono font-bold text-[9px]">
            {anomalies.length}
          </span>
        </div>
        <Link href="/anomalies" className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
          All anomalies →
        </Link>
      </div>
      <div className="panel overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Score</th>
              <th>Subject</th>
              <th className="text-right hidden sm:table-cell">Companies</th>
              <th className="text-right">AI</th>
            </tr>
          </thead>
          <tbody>
            {anomalies.map((a) => {
              const f = a.features;
              const subject =
                a.kind === "director_velocity" ? (f.officer_name ?? "Unknown officer") :
                a.kind === "officer_churn"     ? (f.company_name ?? a.detectionKey) :
                ([f.address_line_1, f.locality, f.postcode].filter(Boolean).join(", ") || "—");
              const scoreColor =
                a.score >= 70 ? "text-red-300 border-red-700 bg-red-950" :
                a.score >= 40 ? "text-orange-300 border-orange-700 bg-orange-950" :
                                "text-yellow-300 border-yellow-700 bg-yellow-950";
              return (
                <tr key={a.id}>
                  <td>
                    <span className={`badge border font-mono font-bold text-xs ${scoreColor}`}>{a.score}</span>
                  </td>
                  <td>
                    <Link href={`/anomalies/${a.id}`}
                      className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors">
                      {subject}
                    </Link>
                    <div className="font-mono text-[10px] text-[var(--text-muted)] mt-0.5">
                      {{
                        address_cluster:   "Address cluster",
                        director_velocity: "Director velocity",
                        officer_churn:     "Officer churn",
                        bulk_registration: "Bulk registration",
                      }[a.kind] ?? a.kind}
                    </div>
                  </td>
                  <td className="text-right font-mono text-sm text-[var(--accent)] hidden sm:table-cell">
                    {f.company_count}
                  </td>
                  <td className="text-right">
                    {a.aiSummaryOutput
                      ? <span className="font-mono text-[10px] text-[var(--accent)]">✓</span>
                      : <span className="font-mono text-[10px] text-[var(--text-muted)]">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10px] text-[var(--text-muted)]">
        Four detection types: address cluster, director velocity, officer churn, bulk registration. Updated every 10 min.
      </p>
    </div>
  );
}

const KIND_BADGE: Record<string, { label: string; color: string }> = {
  "filing-history":               { label: "Filing",  color: "bg-blue-950 text-blue-300 border-blue-700" },
  "company-officers":             { label: "Officer", color: "bg-orange-950 text-orange-300 border-orange-700" },
  "company-psc-individual":       { label: "PSC",     color: "bg-indigo-950 text-indigo-300 border-indigo-700" },
  "company-psc-corporate-entity": { label: "PSC",     color: "bg-indigo-950 text-indigo-300 border-indigo-700" },
  "company-psc-legal-person":     { label: "PSC",     color: "bg-indigo-950 text-indigo-300 border-indigo-700" },
  "company-psc-super-secure":     { label: "PSC",     color: "bg-indigo-950 text-indigo-300 border-indigo-700" },
};

async function ActivityFeed() {
  const activity = await getRecentActivity(30);
  if (!activity.length) {
    return <p className="text-sm text-[var(--text-muted)] px-1">No activity yet.</p>;
  }
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]"
         style={{ boxShadow: "var(--panel-shadow)" }}>
      {activity.map((ev, i) => {
        const badge = KIND_BADGE[ev.summary];
        return (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-elevated)] transition-colors">
            <span className={`badge border shrink-0 ${badge?.color ?? "bg-zinc-900 text-zinc-400 border-zinc-600"}`}>
              {badge?.label ?? ev.summary}
            </span>
            <div className="min-w-0 flex-1">
              {ev.companyNumber ? (
                <Link href={`/c/${ev.companyNumber}`}
                  className="text-sm text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors truncate block">
                  {ev.companyName ?? ev.companyNumber}
                </Link>
              ) : (
                <span className="text-sm text-[var(--text-muted)]">Unknown</span>
              )}
            </div>
            <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)] whitespace-nowrap">
              {ev.publishedAt
                ? new Date(ev.publishedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
                : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

async function LiveTickerSeeded() {
  const events = await getRecentFilingEvents(20);
  return <LiveTicker initialEvents={events} />;
}

// ─── Page ─────────────────────────────────────────────────
export default async function HomePage() {
  const filings = await getRecentFilings(1);
  const hasFilings = filings.length > 0;

  return (
    <>
      {/* Scrolling event wire */}
      <Suspense fallback={null}>
        <Marquee />
      </Suspense>

      <div className="mx-auto max-w-6xl space-y-8 px-4 py-10">

        {/* Hero */}
        <div className="space-y-5">
          <div className="section-label flex items-center gap-2">
            <span className="live-dot" />
            <span>Real-time UK Companies House register</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
            <h1 className="font-mono text-4xl font-bold leading-tight tracking-tight text-[var(--text-primary)] sm:text-5xl">
              Every UK company change,{" "}
              <span className="text-[var(--accent)]"
                style={{ textShadow: "0 0 40px rgba(34,211,238,0.4)" }}>
                live.
              </span>
            </h1>

            <div className="shrink-0 panel-elevated px-5 py-4 text-right glow-pulse">
              <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1">
                Filings streaming
              </div>
              <div className="font-mono text-2xl font-bold text-[var(--accent)] tabular-nums">
                Now
              </div>
              <Link href="/feed"
                className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors mt-1 block">
                View live feed →
              </Link>
            </div>
          </div>

          <p className="text-sm text-[var(--text-secondary)] max-w-xl leading-relaxed">
            Filings, officer appointments, and ownership changes as they stream from Companies House —
            plus automated pattern detection across addresses, directors and filings.
            Free, open-source, no paywall.{" "}
            <Link href="/about" className="text-[var(--accent)] hover:underline underline-offset-2">About this project</Link>
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: "Live stream",         href: "/feed" },
              { label: "Anomaly detection",   href: "/anomalies" },
              { label: "AI explanations",     href: "/about#ai" },
            ].map(({ label, href }) => (
              <Link key={label} href={href}
                className="font-mono text-[10px] uppercase tracking-widest border border-[var(--border)] px-2.5 py-1 rounded text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">
                {label}
              </Link>
            ))}</div>

          <div className="flex items-center gap-3 max-w-lg">
            <div className="flex-1">
              <SearchBox />
            </div>
            <Link href="/support" className="btn-support shrink-0">
              Support ♥
            </Link>
          </div>
        </div>

        {/* Anomaly highlights — the site's differentiator, shown prominently */}
        <Suspense fallback={null}>
          <AnomalyHighlights />
        </Suspense>

        {/* Stats */}
        <Suspense fallback={
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-md bg-[var(--bg-surface)]" />
            ))}
          </div>
        }>
          <StatsRow />
        </Suspense>

        {/* Main two-col */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="section-label">
                {hasFilings ? "Recent filings" : "Recent activity"}
              </h2>
              <Link href="/feed" className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
                All events →
              </Link>
            </div>
            <Suspense fallback={<div className="h-64 animate-pulse rounded-md bg-[var(--bg-surface)]" />}>
              {hasFilings ? <RecentFilingsTable /> : <ActivityFeed />}
            </Suspense>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="section-label">Live stream</h2>
            </div>
            <Suspense fallback={<LiveTicker />}>
              <LiveTickerSeeded />
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}
