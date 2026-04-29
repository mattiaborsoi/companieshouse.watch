import { Suspense } from "react";
import Link from "next/link";
import { getStats, getRecentFilings, getRecentActivity } from "@/lib/db";
import LiveTicker from "@/components/ui/LiveTicker";
import SearchBox from "@/components/ui/SearchBox";
import { filingCategoryLabel, filingCategoryColor, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function Stats() {
  const stats = await getStats();
  const fmt = (n: number) => n.toLocaleString("en-GB");
  const items = [
    { label: "Companies", value: fmt(stats.companies) },
    { label: "Filings",   value: fmt(stats.filings) },
    { label: "Officers",  value: fmt(stats.officers) },
    { label: "PSCs",      value: fmt(stats.pscs) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(({ label, value }) => (
        <div
          key={label}
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-4"
        >
          <div className="font-mono text-2xl font-bold tabular-nums text-[var(--text-primary)]">
            {value}
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-muted)] uppercase tracking-wider">
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  "filing-history":                  "Filing",
  "company-officers":                "Officer",
  "company-psc-individual":          "PSC",
  "company-psc-corporate-entity":    "PSC",
  "company-psc-legal-person":        "PSC",
  "company-psc-super-secure":        "PSC",
};

const KIND_COLOR: Record<string, string> = {
  "filing-history":               "border-blue-900 bg-blue-950 text-blue-400",
  "company-officers":             "border-purple-900 bg-purple-950 text-purple-400",
  "company-psc-individual":       "border-indigo-900 bg-indigo-950 text-indigo-400",
  "company-psc-corporate-entity": "border-indigo-900 bg-indigo-950 text-indigo-400",
  "company-psc-legal-person":     "border-indigo-900 bg-indigo-950 text-indigo-400",
  "company-psc-super-secure":     "border-indigo-900 bg-indigo-950 text-indigo-400",
};

async function RecentFilingsTable() {
  const filings = await getRecentFilings(25);
  if (!filings.length) {
    return null;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
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
                <Link
                  href={`/c/${f.companyNumber}`}
                  className="font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors"
                >
                  {f.companyName}
                </Link>
                <div className="font-mono text-xs text-[var(--text-muted)] mt-0.5">
                  {f.companyNumber}
                </div>
              </td>
              <td>
                <span className={`badge border ${filingCategoryColor(f.category)}`}>
                  {filingCategoryLabel(f.category)}
                </span>
              </td>
              <td className="hidden sm:table-cell text-[var(--text-secondary)] text-xs">
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

async function RecentActivityFeed() {
  const activity = await getRecentActivity(30);
  if (!activity.length) {
    return (
      <p className="text-sm text-[var(--text-muted)] px-1">No activity recorded yet.</p>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
      {activity.map((ev, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors">
          <span className={`badge mt-0.5 shrink-0 border ${KIND_COLOR[ev.summary] ?? "border-zinc-700 bg-zinc-900 text-zinc-400"}`}>
            {KIND_LABEL[ev.summary] ?? ev.summary}
          </span>
          <div className="min-w-0 flex-1">
            {ev.companyNumber ? (
              <Link
                href={`/c/${ev.companyNumber}`}
                className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors"
              >
                {ev.companyName ?? ev.companyNumber}
              </Link>
            ) : (
              <span className="text-sm text-[var(--text-muted)]">Unknown company</span>
            )}
          </div>
          <span className="shrink-0 font-mono text-xs text-[var(--text-muted)] whitespace-nowrap">
            {ev.publishedAt
              ? new Date(ev.publishedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
              : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

export default async function HomePage() {
  const filings = await getRecentFilings(1);
  const hasFilings = filings.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-12">
      {/* Hero */}
      <div className="space-y-5 max-w-2xl">
        <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest">
          <span className="live-dot" />
          <span>Streaming live from Companies House</span>
        </div>
        <h1 className="text-4xl font-bold leading-tight tracking-tight text-[var(--text-primary)] sm:text-5xl">
          Every UK company change,{" "}
          <span
            className="text-[var(--accent)]"
            style={{ textShadow: "0 0 32px color-mix(in srgb, var(--accent) 40%, transparent)" }}
          >
            live
          </span>
          .
        </h1>
        <p className="text-base text-[var(--text-secondary)] leading-relaxed">
          Real-time feed of every change to the UK Companies House register —
          filings, officer appointments, and beneficial ownership updates.
          Free, open-source.
        </p>
        <div className="flex items-center gap-3 pt-1">
          <div className="max-w-sm flex-1">
            <SearchBox />
          </div>
          <Link href="/feed" className="btn-ghost shrink-0 text-xs">
            Live feed →
          </Link>
        </div>
      </div>

      {/* Stats */}
      <Suspense
        fallback={
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-[var(--bg-surface)]" />
            ))}
          </div>
        }
      >
        <Stats />
      </Suspense>

      {/* Main content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          {hasFilings ? (
            <>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Recent filings
              </h2>
              <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-[var(--bg-surface)]" />}>
                <RecentFilingsTable />
              </Suspense>
            </>
          ) : (
            <>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Recent activity
              </h2>
              <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-[var(--bg-surface)]" />}>
                <RecentActivityFeed />
              </Suspense>
            </>
          )}
        </div>
        <div>
          <LiveTicker />
        </div>
      </div>
    </div>
  );
}
