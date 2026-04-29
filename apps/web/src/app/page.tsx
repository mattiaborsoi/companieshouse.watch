import { Suspense } from "react";
import Link from "next/link";
import { getStats, getRecentFilings } from "@/lib/db";
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

async function RecentFilingsTable() {
  const filings = await getRecentFilings(25);
  if (!filings.length) {
    return (
      <p className="text-sm text-[var(--text-muted)]">No filings yet.</p>
    );
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

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-12">
      {/* Hero */}
      <div className="space-y-5 max-w-2xl">
        <div className="flex items-center gap-2 text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest">
          <span className="live-dot" />
          <span>Streaming live from Companies House</span>
        </div>
        <h1 className="text-4xl font-bold leading-tight tracking-tight text-[var(--text-primary)] sm:text-5xl">
          Every UK company filing,{" "}
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
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg bg-[var(--bg-surface)]"
              />
            ))}
          </div>
        }
      >
        <Stats />
      </Suspense>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Recent filings
          </h2>
          <Suspense
            fallback={
              <div className="h-64 animate-pulse rounded-lg bg-[var(--bg-surface)]" />
            }
          >
            <RecentFilingsTable />
          </Suspense>
        </div>
        <div>
          <LiveTicker />
        </div>
      </div>
    </div>
  );
}
