import { Suspense } from "react";

export const dynamic = "force-dynamic";
import Link from "next/link";
import { getStats, getRecentFilings } from "@/lib/db";
import LiveTicker from "@/components/ui/LiveTicker";
import SearchBox from "@/components/ui/SearchBox";
import { filingCategoryLabel, filingCategoryColor, formatDate } from "@/lib/utils";

async function Stats() {
  const stats = await getStats();
  const fmt = (n: number) => n.toLocaleString("en-GB");
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(
        [
          ["Companies", stats.companies],
          ["Filings", stats.filings],
          ["Officers", stats.officers],
          ["PSCs", stats.pscs],
        ] as const
      ).map(([label, count]) => (
        <div key={label} className="rounded-lg border bg-white px-4 py-3">
          <div className="font-mono text-2xl font-bold text-gray-900">{fmt(count)}</div>
          <div className="text-xs text-gray-500">{label}</div>
        </div>
      ))}
    </div>
  );
}

async function RecentFilingsTable() {
  const filings = await getRecentFilings(20);
  if (!filings.length) {
    return <p className="text-sm text-gray-400">No filings yet.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50 text-xs text-gray-500">
            <th className="px-4 py-2 text-left">Company</th>
            <th className="px-4 py-2 text-left">Category</th>
            <th className="hidden px-4 py-2 text-left sm:table-cell">Type</th>
            <th className="px-4 py-2 text-right">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {filings.map((f) => (
            <tr key={f.transactionId} className="hover:bg-gray-50">
              <td className="px-4 py-2">
                <Link
                  href={`/c/${f.companyNumber}`}
                  className="font-medium text-gray-900 hover:underline"
                >
                  {f.companyName}
                </Link>
                <div className="font-mono text-xs text-gray-400">{f.companyNumber}</div>
              </td>
              <td className="px-4 py-2">
                <span className={`badge ${filingCategoryColor(f.category)}`}>
                  {filingCategoryLabel(f.category)}
                </span>
              </td>
              <td className="hidden px-4 py-2 text-gray-500 sm:table-cell">{f.type}</td>
              <td className="px-4 py-2 text-right text-gray-500">
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
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-10">
      {/* Hero */}
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          Every UK company filing,{" "}
          <span className="text-brand-600">live</span>.
        </h1>
        <p className="max-w-xl text-gray-500">
          Real-time feed of every change to the UK Companies House register —
          filings, officer changes, and beneficial ownership updates. Free,
          open-source, and sourced directly from{" "}
          <a
            href="https://www.companieshouse.gov.uk/"
            className="underline hover:text-gray-700"
            target="_blank"
            rel="noopener noreferrer"
          >
            Companies House
          </a>
          .
        </p>
        <div className="flex items-center gap-3">
          <div className="max-w-sm flex-1">
            <SearchBox />
          </div>
          <Link href="/feed" className="btn-secondary shrink-0">
            Live feed →
          </Link>
        </div>
      </div>

      {/* Stats */}
      <Suspense fallback={<div className="h-16 animate-pulse rounded-lg bg-gray-100" />}>
        <Stats />
      </Suspense>

      {/* Two-column layout: recent filings + live ticker */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Recent filings</h2>
          <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-gray-100" />}>
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
