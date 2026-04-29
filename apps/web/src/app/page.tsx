import { Suspense } from "react";
import Link from "next/link";
import { getStats, getRecentFilings, getRecentActivity } from "@/lib/db";
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { label: "Companies", value: fmt(s.companies), delta: null },
        { label: "Filings",   value: fmt(s.filings),   delta: "today" },
        { label: "Officers",  value: fmt(s.officers),   delta: null },
        { label: "PSCs",      value: fmt(s.pscs),       delta: null },
      ].map(({ label, value }) => (
        <div key={label} className="stat-card">
          <div className="stat-value">{value}</div>
          <div className="stat-label">{label}</div>
        </div>
      ))}
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
            Filings, officer appointments, and ownership changes as they stream from Companies House.
            Free, open-source, no paywall.{" "}
            <Link href="/about" className="text-[var(--accent)] hover:underline underline-offset-2">About this project</Link>
          </p>

          <div className="flex items-center gap-3 max-w-lg">
            <div className="flex-1">
              <SearchBox />
            </div>
            <Link href="/support" className="btn-support shrink-0">
              Support ♥
            </Link>
          </div>
        </div>

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
            <LiveTicker />
          </div>
        </div>
      </div>
    </>
  );
}
