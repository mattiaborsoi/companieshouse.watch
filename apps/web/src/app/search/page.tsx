export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { searchCompanies, searchChRestApi, searchOfficers } from "@/lib/db";
import SearchBox from "@/components/ui/SearchBox";
import { companyStatusClass, formatDate } from "@/lib/utils";

interface Props {
  searchParams: Promise<{ q?: string; status?: string; tab?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `Search: ${q}` : "Search" };
}

export default async function SearchPage({ searchParams }: Props) {
  const { q, status, tab } = await searchParams;
  const query = q?.trim() ?? "";
  const activeTab = tab === "people" ? "people" : "companies";
  const statusFilter = status ?? "all";

  const [localResultsRaw, officerResults] = await Promise.all([
    query.length >= 2 ? searchCompanies(query) : Promise.resolve([]),
    query.length >= 2 && activeTab === "people" ? searchOfficers(query) : Promise.resolve([]),
  ]);

  const localResults = statusFilter === "all"
    ? localResultsRaw
    : localResultsRaw.filter((c) => c.status.toLowerCase() === statusFilter);

  const remoteResults =
    query.length >= 2 && activeTab === "companies" && localResultsRaw.length === 0
      ? await searchChRestApi(query)
      : [];

  const tabLink = (t: string) => `/search?q=${encodeURIComponent(query)}&tab=${t}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Search</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Company name, number, or person</p>
      </div>

      <SearchBox initialValue={query} />

      {/* Tab switcher */}
      {query.length >= 2 && (
        <div className="flex gap-1 border-b border-[var(--border-subtle)]">
          {(["companies", "people"] as const).map((t) => (
            <a
              key={t}
              href={tabLink(t)}
              className={`px-4 py-2 text-xs font-mono uppercase tracking-wide transition-colors border-b-2 -mb-px ${
                activeTab === t
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {t}
            </a>
          ))}
        </div>
      )}

      {query.length > 0 && query.length < 2 && (
        <p className="font-mono text-sm text-[var(--text-muted)]">Enter at least 2 characters.</p>
      )}

      {/* Companies tab */}
      {activeTab === "companies" && query.length >= 2 && (
        <>
          {/* Status filter chips */}
          {localResultsRaw.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {(["all", "active", "dissolved"] as const).map((s) => {
                const count = s === "all"
                  ? localResultsRaw.length
                  : localResultsRaw.filter((c) => c.status.toLowerCase() === s).length;
                const isActive = statusFilter === s;
                return (
                  <a
                    key={s}
                    href={`/search?q=${encodeURIComponent(query)}&tab=companies&status=${s}`}
                    className={`px-3 py-1 rounded-full border font-mono text-xs transition-colors ${
                      isActive
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    }`}
                  >
                    {s} · {count}
                  </a>
                );
              })}
            </div>
          )}

          {localResults.length === 0 && remoteResults.length === 0 && (
            <p className="text-sm text-[var(--text-secondary)]">
              No companies found for <span className="text-[var(--text-primary)] font-medium">{query}</span>.
            </p>
          )}

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
                      <div className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">{c.companyNumber}</div>
                    </div>
                    <span className={`badge shrink-0 border ${companyStatusClass(c.status)}`}>
                      {c.status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-[var(--text-muted)]">
                    <span>{c.type}</span>
                    {c.incorporatedOn && <span>Inc. {formatDate(c.incorporatedOn)}</span>}
                    {c.registeredAddressPostcode && <span>{c.registeredAddressPostcode.toUpperCase()}</span>}
                  </div>
                </Link>
              ))}
            </div>
          )}

          {remoteResults.length > 0 && (
            <div className="space-y-2">
              <div className="rounded-md border border-amber-900 bg-amber-950/50 px-4 py-2.5 text-xs text-amber-400 font-mono">
                ↗ Not in local database — showing live results from Companies House.
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
                      <div className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">{c.companyNumber}</div>
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
        </>
      )}

      {/* People tab */}
      {activeTab === "people" && query.length >= 2 && (
        <>
          {officerResults.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">
              No people found for <span className="text-[var(--text-primary)] font-medium">{query}</span>.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="font-mono text-xs text-[var(--text-muted)] uppercase tracking-wide">
                {officerResults.length} result{officerResults.length !== 1 ? "s" : ""}
              </p>
              {officerResults.map((o) => (
                <Link
                  key={o.officerId}
                  href={`/officer/${o.officerId}`}
                  className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)] hover:border-[var(--accent)] transition-all group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                        {o.nameFull}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
                        {o.appointmentCount} appointment{o.appointmentCount !== 1 ? "s" : ""}
                        {o.nationality && ` · ${o.nationality}`}
                        {o.occupation && ` · ${o.occupation}`}
                      </div>
                    </div>
                    {o.dateOfBirthYear && (
                      <span className="shrink-0 font-mono text-xs text-[var(--text-muted)]">
                        b. {o.dateOfBirthYear}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
