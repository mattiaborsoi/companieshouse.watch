export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { createHash } from "crypto";
import {
  searchCompanies,
  searchChRestApi,
  searchOfficers,
  searchChRestOfficers,
  chSlugFromLink,
  logSearch,
  type SearchQueryType,
} from "@/lib/db";
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

  // Detect UK postcode (full or partial) — force CH REST search for companies
  const isPostcode = /^[A-Z]{1,2}[0-9][0-9A-Z]?(\s*[0-9][A-Z]{2})?$/i.test(query.trim());

  // Always run BOTH local queries so we can surface a cross-tab nudge when
  // the user lands on a tab that has no matches but the other one does.
  // Both queries are cheap ILIKE lookups — cheaper than a wasted user.
  const [localResultsRaw, officerResults] = await Promise.all([
    query.length >= 2 ? searchCompanies(query) : Promise.resolve([]),
    query.length >= 2 ? searchOfficers(query)  : Promise.resolve([]),
  ]);

  const localResults = statusFilter === "all"
    ? localResultsRaw
    : localResultsRaw.filter((c) => c.status.toLowerCase() === statusFilter);

  // For postcodes always hit CH REST; otherwise only when no local results
  const remoteResults =
    query.length >= 2 && activeTab === "companies" && (localResultsRaw.length === 0 || isPostcode)
      ? await searchChRestApi(query)
      : [];

  // People: CH REST fallback when local DB has no results
  const remoteOfficers =
    query.length >= 2 && activeTab === "people" && officerResults.length === 0
      ? await searchChRestOfficers(query)
      : [];

  // Cross-tab peek: when the active tab's local results are scant, also
  // glance at the OTHER tab's CH REST endpoint — just to know whether the
  // nudge banner should fire. Catches the "this query is actually a person
  // we don't have indexed locally" case (e.g. niche officer names).
  // Bounded to weak-local-result queries so the REST budget stays tight.
  const PEEK_THRESHOLD = 3;
  const [peekedRemoteOfficers, peekedRemoteCompanies] = await Promise.all([
    query.length >= 2
      && activeTab === "companies"
      && officerResults.length === 0
      && localResultsRaw.length < PEEK_THRESHOLD
      ? searchChRestOfficers(query)
      : Promise.resolve([]),
    query.length >= 2
      && activeTab === "people"
      && localResultsRaw.length === 0
      && officerResults.length < PEEK_THRESHOLD
      ? searchChRestApi(query)
      : Promise.resolve([]),
  ]);

  // Effective counts that power the nudge banner (local + cross-tab peek)
  const officerNudgeCount = officerResults.length + peekedRemoteOfficers.length;
  const companyNudgeCount = localResultsRaw.length + peekedRemoteCompanies.length;

  // ── Analytics: fire-and-forget search logging. Never blocks render or
  // surfaces an error to the user; zero-result queries are the highest signal.
  if (query.length >= 2) {
    const queryType: SearchQueryType =
      isPostcode                     ? "postcode"
      : /^\d{6,8}$/.test(query)      ? "company_number"
      : activeTab === "people"       ? "officer_name"
      :                                "company_name";

    const localCount  = (localResultsRaw?.length ?? 0) + (officerResults?.length ?? 0);
    const remoteCount =
      (remoteResults?.length ?? 0) +
      (remoteOfficers?.length ?? 0) +
      (peekedRemoteOfficers?.length ?? 0) +
      (peekedRemoteCompanies?.length ?? 0);

    const ipRaw = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ipHash = ipRaw
      ? createHash("sha256").update(ipRaw + "ch-search-salt").digest("hex")
      : null;

    logSearch(query, queryType, localCount, remoteCount, ipHash).catch(() => {
      /* analytics must never break the page */
    });
  }

  const tabLink = (t: string) => `/search?q=${encodeURIComponent(query)}&tab=${t}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Search</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Company name, number, or person</p>
      </div>

      <SearchBox initialValue={query} />

      {/* Tab switcher — counts make it obvious where the matches actually live.
          Use the combined (local + cross-tab peek) count so a remote-only match
          on the other side still shows up as a real number on the badge. */}
      {query.length >= 2 && (
        <div className="flex gap-1 border-b border-[var(--border-subtle)]">
          {(["companies", "people"] as const).map((t) => {
            const count = t === "companies" ? companyNudgeCount : officerNudgeCount;
            const isActive = activeTab === t;
            return (
              <a
                key={t}
                href={tabLink(t)}
                className={`px-4 py-2 text-xs font-mono uppercase tracking-wide transition-colors border-b-2 -mb-px flex items-center gap-2 ${
                  isActive
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                <span>{t}</span>
                {count > 0 && (
                  <span
                    className={`inline-flex items-center justify-center min-w-[1.25rem] px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${
                      isActive
                        ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                        : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      )}

      {/* Cross-tab nudge — only surface when the OTHER tab has matches the
          user almost certainly hasn't realised exist. Highest-signal moment:
          they're on companies, got few/no hits, but the name matches an
          officer (or vice versa). Pattern lifted from Google "Did you mean". */}
      {query.length >= 2 && activeTab === "companies" && officerNudgeCount > 0 && (
        <a
          href={tabLink("people")}
          className="flex items-center justify-between gap-3 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/[0.06] hover:bg-[var(--accent)]/[0.10] px-4 py-3 transition-colors group"
        >
          <span className="text-sm text-[var(--text-primary)]">
            <span className="mr-2">👤</span>
            <span className="font-semibold text-[var(--accent)]">
              {officerNudgeCount} {officerNudgeCount === 1 ? "person" : "people"}
            </span>{" "}
            also {officerNudgeCount === 1 ? "matches" : "match"}{" "}
            <span className="font-mono text-[var(--text-primary)]">&ldquo;{query}&rdquo;</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--accent)] group-hover:translate-x-0.5 transition-transform shrink-0">
            view people →
          </span>
        </a>
      )}
      {query.length >= 2 && activeTab === "people" && companyNudgeCount > 0 && (
        <a
          href={tabLink("companies")}
          className="flex items-center justify-between gap-3 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/[0.06] hover:bg-[var(--accent)]/[0.10] px-4 py-3 transition-colors group"
        >
          <span className="text-sm text-[var(--text-primary)]">
            <span className="mr-2">🏢</span>
            <span className="font-semibold text-[var(--accent)]">
              {companyNudgeCount} {companyNudgeCount === 1 ? "company" : "companies"}
            </span>{" "}
            also {companyNudgeCount === 1 ? "matches" : "match"}{" "}
            <span className="font-mono text-[var(--text-primary)]">&ldquo;{query}&rdquo;</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--accent)] group-hover:translate-x-0.5 transition-transform shrink-0">
            view companies →
          </span>
        </a>
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
          {officerResults.length === 0 && remoteOfficers.length === 0 && (
            <p className="text-sm text-[var(--text-secondary)]">
              No people found for <span className="text-[var(--text-primary)] font-medium">{query}</span>.
            </p>
          )}

          {officerResults.length > 0 && (
            <div className="space-y-2">
              <p className="font-mono text-xs text-[var(--text-muted)] uppercase tracking-wide">
                {officerResults.length} result{officerResults.length !== 1 ? "s" : ""} · local database
              </p>
              {officerResults.map((o) => {
                const slug = o.chOfficerLink ? chSlugFromLink(o.chOfficerLink) : null;
                const href = `/officer/${slug ?? o.officerId}`;
                return (
                  <Link
                    key={o.officerId}
                    href={href}
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
                );
              })}
            </div>
          )}

          {remoteOfficers.length > 0 && (
            <div className="space-y-2">
              <div className="rounded-md border border-amber-900 bg-amber-950/50 px-4 py-2.5 text-xs text-amber-400 font-mono">
                ↗ Not in local database — showing live results from Companies House.
              </div>
              {remoteOfficers.map((o, i) => {
                const href = o.chSlug ? `/officer/${o.chSlug}` : null;
                const card = (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                        {o.nameFull}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
                        {o.appointmentCount} appointment{o.appointmentCount !== 1 ? "s" : ""}
                        {o.addressSnippet && ` · ${o.addressSnippet}`}
                      </div>
                    </div>
                    {o.dateOfBirthYear && (
                      <span className="shrink-0 font-mono text-xs text-[var(--text-muted)]">
                        b. {o.dateOfBirthYear}
                      </span>
                    )}
                  </div>
                );
                return href ? (
                  <Link
                    key={i}
                    href={href}
                    className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)] hover:border-[var(--accent)] transition-all group"
                  >
                    {card}
                  </Link>
                ) : (
                  <div
                    key={i}
                    className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
                  >
                    {card}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
