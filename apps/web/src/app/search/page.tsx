export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { searchCompanies, searchChRestApi } from "@/lib/db";
import SearchBox from "@/components/ui/SearchBox";
import { companyStatusClass, formatDate } from "@/lib/utils";

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `Search: ${q}` : "Search" };
}

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const localResults = query.length >= 2 ? await searchCompanies(query) : [];
  const remoteResults =
    query.length >= 2 && localResults.length === 0
      ? await searchChRestApi(query)
      : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Search</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Company name or number</p>
      </div>

      <SearchBox initialValue={query} />

      {query.length > 0 && query.length < 2 && (
        <p className="font-mono text-sm text-[var(--text-muted)]">Enter at least 2 characters.</p>
      )}

      {query.length >= 2 && localResults.length === 0 && remoteResults.length === 0 && (
        <p className="text-sm text-[var(--text-secondary)]">
          No companies found for <span className="text-[var(--text-primary)] font-medium">{query}</span>.
        </p>
      )}

      {/* Local DB results */}
      {localResults.length > 0 && (
        <div className="space-y-2">
          <p className="font-mono text-xs text-[var(--text-muted)] uppercase tracking-wide">
            {localResults.length} result{localResults.length !== 1 ? "s" : ""} · local database
          </p>
          {localResults.map((c) => (
            <Link
              key={c.companyNumber}
              href={`/c/${c.companyNumber}`}
              className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)] hover:border-[var(--accent)] transition-all group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                    {c.name}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
                    {c.companyNumber}
                  </div>
                </div>
                <span className={`badge shrink-0 border ${companyStatusClass(c.status)}`}>
                  {c.status}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-[var(--text-muted)]">
                <span>{c.type}</span>
                {c.incorporatedOn && <span>Inc. {formatDate(c.incorporatedOn)}</span>}
                {c.registeredAddressPostcode && (
                  <span>{c.registeredAddressPostcode.toUpperCase()}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* CH REST fallback */}
      {remoteResults.length > 0 && (
        <div className="space-y-2">
          <div className="rounded-md border border-amber-900 bg-amber-950/50 px-4 py-2.5 text-xs text-amber-400 font-mono">
            ↗ Not in local database — showing live results from Companies House. Profile pages
            will populate as events stream through.
          </div>
          {remoteResults.map((c) => (
            <Link
              key={c.companyNumber}
              href={`/c/${c.companyNumber}`}
              className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)] hover:border-[var(--accent)] transition-all group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                    {c.title}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
                    {c.companyNumber}
                  </div>
                </div>
                <span className={`badge shrink-0 border ${companyStatusClass(c.companyStatus ?? "unknown")}`}>
                  {c.companyStatus ?? "unknown"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-[var(--text-muted)]">
                <span>{c.companyType}</span>
                {c.dateOfCreation && <span>Inc. {formatDate(c.dateOfCreation)}</span>}
                {c.addressSnippet && <span>{c.addressSnippet}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
