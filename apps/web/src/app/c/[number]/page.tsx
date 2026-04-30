export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import {
  getCompany,
  getCompanyFilings,
  getCompanyOfficers,
  getCompanyPscs,
  getCompanyIdentity,
  getDirectorContinuity,
  getCompanyPatterns,
  getCompanyPress,
  getCompanyPressCount,
  bumpIdentityResolutionPriority,
  bumpPressResolutionPriority,
  getCompanyFromChRest,
  getOfficersFromChRest,
  getPscsFromChRest,
  getFilingsFromChRest,
  getAnomalyForAddress,
  chSlugFromLink,
  ChRestRateLimitError,
  type Company,
  type ChRestCompany,
  type ChRestFiling,
  type ChRestOfficer,
  type ChRestPsc,
  type CompanyIdentity,
  type DirectorContinuityRow,
  type CompanyPattern,
  type PressMention,
} from "@/lib/db";
import {
  formatDate,
  companyStatusClass,
  filingCategoryLabel,
  filingCategoryColor,
  formatFilingDescription,
  sicDescription,
} from "@/lib/utils";

interface Props {
  params: Promise<{ number: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { number } = await params;
  const cn = number.toUpperCase();
  const local = await getCompany(cn);
  const name = local?.name ?? (await getCompanyFromChRest(cn))?.name;
  if (!name) return { title: "Company not found" };
  const ogImage = `/api/og/c/${cn}`;
  return {
    title: name,
    openGraph: {
      title: name,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: name,
      images: [ogImage],
    },
  };
}

// UK Companies House numbers: 8 chars, digits or SC/NI/OC/LP/NC/SL/SE/R prefix + digits
const CH_NUMBER_RE = /^[A-Z]{0,2}[0-9]{6,8}$/;

export default async function CompanyPage({ params }: Props) {
  const { number } = await params;
  const cn = number.toUpperCase();

  if (!CH_NUMBER_RE.test(cn)) notFound();

  // Try local DB first; fall back to CH REST
  const localCompany = await getCompany(cn);

  if (localCompany) {
    const addrHash = localCompany.registeredAddressHash ?? undefined;
    const [filings, officers, pscs, clusterAnomaly, identity, continuity, patterns, press, pressCount] = await Promise.all([
      getCompanyFilings(cn),
      getCompanyOfficers(cn),
      getCompanyPscs(cn),
      addrHash ? getAnomalyForAddress(addrHash) : Promise.resolve(null),
      getCompanyIdentity(cn),
      getDirectorContinuity(cn, 50),
      getCompanyPatterns(cn),
      getCompanyPress(cn, 5),
      getCompanyPressCount(cn),
    ]);
    // For active companies without identity / press yet, prioritise resolution at
    // the next cron tick. Fire-and-forget; never blocks page render.
    if (!identity && localCompany.status === "active") {
      bumpIdentityResolutionPriority(cn).catch(() => {});
    }
    if (localCompany.status === "active") {
      bumpPressResolutionPriority(cn).catch(() => {});
    }
    // Fallback to CH REST when local DB has no filings or officers yet
    const [restFilings, restOfficers] = await Promise.all([
      filings.length === 0 ? getFilingsFromChRest(cn) : Promise.resolve([]),
      officers.length === 0 ? getOfficersFromChRest(cn) : Promise.resolve([]),
    ]);
    return (
      <CompanyProfile
        company={localCompany}
        filings={filings}
        restFilings={restFilings}
        officers={officers}
        restOfficers={restOfficers}
        pscs={pscs}
        fromRest={false}
        clusterAnomaly={clusterAnomaly}
        identity={identity}
        continuity={continuity}
        patterns={patterns}
        press={press}
        pressCount={pressCount}
      />
    );
  }

  // Not in local DB — fetch live from CH REST
  let restCompany: Awaited<ReturnType<typeof getCompanyFromChRest>>;
  let restOfficers: Awaited<ReturnType<typeof getOfficersFromChRest>>;
  let restPscs: Awaited<ReturnType<typeof getPscsFromChRest>>;
  try {
    [restCompany, restOfficers, restPscs] = await Promise.all([
      getCompanyFromChRest(cn),
      // Officers/PSCs failure isn't fatal; show empty if they fail.
      getOfficersFromChRest(cn).catch(() => []),
      getPscsFromChRest(cn).catch(() => []),
    ]);
  } catch (e) {
    if (e instanceof ChRestRateLimitError) {
      return <RateLimitedFallback companyNumber={cn} />;
    }
    throw e;
  }

  if (!restCompany) notFound();

  const restFilings = await getFilingsFromChRest(cn).catch(() => []);
  return (
    <CompanyProfile
      company={restCompany}
      filings={[]}
      restFilings={restFilings}
      officers={[]}
      pscs={[]}
      restOfficers={restOfficers}
      restPscs={restPscs}
      fromRest={true}
    />
  );
}

// Shown when the company isn't in our local DB AND Companies House is
// currently rate-limiting us. Better than a 404, which would imply the
// company doesn't exist.
function RateLimitedFallback({ companyNumber }: { companyNumber: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 space-y-5 text-center">
      <p className="section-label mx-auto">Companies House rate-limited</p>
      <h1 className="font-mono text-2xl font-bold text-[var(--text-primary)]">
        Couldn&apos;t reach Companies House right now
      </h1>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
        Company <span className="font-mono text-[var(--text-primary)]">{companyNumber}</span>{" "}
        isn&apos;t in our local database yet, and the Companies House API has temporarily
        rate-limited us. The page will work in a moment — please refresh.
      </p>
      <div className="pt-2 flex flex-wrap justify-center gap-3">
        <a
          href={`https://find-and-update.company-information.service.gov.uk/company/${companyNumber}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost text-xs"
        >
          View on Companies House ↗
        </a>
        <Link href="/" className="btn-ghost text-xs">← Home</Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rendering component (handles both local and REST data)
// ---------------------------------------------------------------------------

type AnyCompany = Company | ChRestCompany;

function CompanyProfile({
  company,
  filings,
  restFilings = [],
  officers,
  pscs,
  restOfficers = [],
  restPscs = [],
  fromRest,
  clusterAnomaly = null,
  identity = null,
  continuity = [],
  patterns = [],
  press = [],
  pressCount = 0,
}: {
  company: AnyCompany;
  filings: Awaited<ReturnType<typeof getCompanyFilings>>;
  restFilings?: ChRestFiling[];
  officers: Awaited<ReturnType<typeof getCompanyOfficers>>;
  pscs: Awaited<ReturnType<typeof getCompanyPscs>>;
  restOfficers?: ChRestOfficer[];
  restPscs?: ChRestPsc[];
  fromRest: boolean;
  clusterAnomaly?: { id: string; score: number } | null;
  identity?: CompanyIdentity | null;
  continuity?: DirectorContinuityRow[];
  patterns?: CompanyPattern[];
  press?: PressMention[];
  pressCount?: number;
}) {
  const addr = company.registeredAddress as Record<string, string>;
  const addressLines = [
    addr.address_line_1,
    addr.address_line_2,
    addr.locality,
    addr.region,
    addr.postal_code,
  ].filter(Boolean);

  const activeOfficers = officers.filter((o) => !o.resignedOn);
  const formerOfficers = officers.filter((o) => o.resignedOn);
  const activeRestOfficers = restOfficers.filter((o) => !o.resignedOn);
  const formerRestOfficers = restOfficers.filter((o) => o.resignedOn);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-10">
      {/* Live-from-REST banner */}
      {fromRest && (
        <div className="rounded-md border border-amber-900 bg-amber-950/50 px-4 py-2.5 text-xs text-amber-400 font-mono">
          ↗ Fetched live from Companies House — not yet in local database. Profile will populate
          automatically as events stream through.
        </div>
      )}

      {/* Cluster anomaly warning */}
      {clusterAnomaly && (
        <Link
          href={`/anomalies/${clusterAnomaly.id}`}
          className="flex items-center gap-3 rounded-md border border-red-900 bg-red-950/40 px-4 py-2.5 hover:bg-red-950/60 transition-colors group"
        >
          <span className="font-mono text-xs font-bold text-red-300 tabular-nums border border-red-700 bg-red-950 px-1.5 py-0.5 rounded shrink-0">
            {clusterAnomaly.score}
          </span>
          <span className="text-xs text-red-300 font-mono">
            This address is part of a flagged cluster — {clusterAnomaly.score >= 70 ? "high" : clusterAnomaly.score >= 40 ? "medium" : "low"} anomaly score.
          </span>
          <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-red-400 group-hover:text-red-300 transition-colors shrink-0">
            View cluster →
          </span>
        </Link>
      )}

      {/* Header */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          {identity?.faviconUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/favicon/${company.companyNumber}`}
              alt=""
              width={32}
              height={32}
              referrerPolicy="no-referrer"
              className="rounded mt-1 shrink-0 border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
            />
          )}
          <h1 className="text-2xl font-bold text-[var(--text-primary)] leading-tight">
            {company.name}
          </h1>
          <span className={`badge mt-1 border ${companyStatusClass(company.status)}`}>
            {company.status}
          </span>
        </div>

        {identity?.websiteUrl && (
          <div className="space-y-1.5">
            <a
              href={identity.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-[var(--accent)] hover:underline underline-offset-2 font-mono"
            >
              {new URL(identity.websiteUrl).hostname.replace(/^www\./, "")} ↗
            </a>
            {identity.websiteDescription && (
              <p className="text-sm text-[var(--text-secondary)] italic max-w-2xl leading-relaxed">
                {identity.websiteDescription}
              </p>
            )}
            <a
              href={`mailto:takedowns@borsoi.co.uk?subject=${encodeURIComponent("Incorrect website for " + company.name + " (" + company.companyNumber + ")")}&body=${encodeURIComponent("I believe the website shown for " + company.name + " (" + identity.websiteUrl + ") is incorrect.\n\nThe correct website (if known) is:\n\nReason:\n")}`}
              className="inline-block font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            >
              ↳ report incorrect website
            </a>
          </div>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-[var(--text-muted)]">
          <span className="text-[var(--text-secondary)]">{company.companyNumber}</span>
          <span>{company.type}</span>
          {company.incorporatedOn && (
            <span>Inc. {formatDate(company.incorporatedOn)}</span>
          )}
          {company.dissolvedOn && (
            <span className="text-red-400">Dissolved {formatDate(company.dissolvedOn as string)}</span>
          )}
          {addressLines.length > 0 && <span>{addressLines.join(", ")}</span>}
        </div>

        {company.sicCodes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {company.sicCodes.map((sic: string) => {
              const desc = sicDescription(sic);
              return (
                <span key={sic} className="badge border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                  {sic}{desc ? ` · ${desc}` : ""}
                </span>
              );
            })}
          </div>
        )}

        <a
          href={`https://find-and-update.company-information.service.gov.uk/company/${company.companyNumber}`}
          className="inline-block text-xs text-[var(--accent)] hover:underline underline-offset-2"
          target="_blank"
          rel="noopener noreferrer"
        >
          View on Companies House ↗
        </a>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      {/* Phase 3: filing pattern badges */}
      {patterns.length > 0 && <PatternBadgesSection patterns={patterns} />}

      {/* Phase 4: press mentions */}
      {press.length > 0 && <PressSection press={press} totalCount={pressCount} />}

      {/* Filing history */}
      <FilingsSection filings={filings} restFilings={restFilings} companyNumber={company.companyNumber} />

      {/* Officers — prefer local data; fall back to REST when local is empty */}
      {(fromRest || officers.length === 0) && restOfficers.length > 0 ? (
        <RestOfficersSection active={activeRestOfficers} former={formerRestOfficers} />
      ) : (
        <LocalOfficersSection active={activeOfficers} former={formerOfficers} />
      )}

      {/* Directors also run — Phase 2 */}
      {continuity.length > 0 && <DirectorsAlsoRunSection rows={continuity} />}

      {/* PSCs */}
      {fromRest ? (
        <RestPscsSection pscs={restPscs} />
      ) : (
        <LocalPscsSection pscs={pscs} />
      )}
    </div>
  );
}

// ─── Phase 4: press mentions ──────────────────────────────────

function PressSection({ press, totalCount }: { press: PressMention[]; totalCount: number }) {
  // Defence in depth: only render http/https URLs. The press resolver already
  // filters at insert time, but we re-check here so a stale/manual row can't
  // become an XSS vector via javascript: / data: schemes.
  const safe = press.filter((p) => /^https?:\/\//i.test(p.url));
  if (safe.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        In the news · {totalCount}
      </h2>
      <div className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]"
           style={{ boxShadow: "var(--panel-shadow)" }}>
        {safe.map((p) => (
          <a
            key={p.url}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <p className="text-sm text-[var(--text-primary)] leading-snug line-clamp-2">{p.headline}</p>
            <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)] flex items-center gap-2">
              <span>{p.sourceDomain}</span>
              <span>·</span>
              <span>{formatDate(p.publishedAt)}</span>
              <span className="ml-auto text-[var(--accent)]/70">↗</span>
            </p>
          </a>
        ))}
      </div>
      <p className="font-mono text-[10px] text-[var(--text-muted)] leading-relaxed">
        Mentions sourced from the GDELT global news index. We don&apos;t curate or rank — links open the original article.
        {totalCount > press.length && ` ${totalCount - press.length} older mention${totalCount - press.length === 1 ? "" : "s"} available.`}
        {" "}
        <a
          href="mailto:takedowns@borsoi.co.uk?subject=Incorrect%20press%20mention"
          className="hover:text-[var(--accent)] transition-colors underline underline-offset-2"
        >
          Report incorrect mention
        </a>.
      </p>
    </section>
  );
}

// ─── Phase 3: filing-pattern badges ──────────────────────────────────

const PATTERN_COLOURS: Record<string, string> = {
  // Neutral / informational
  recently_incorporated:    "bg-blue-950/60 text-blue-300 border-blue-800",
  switched_from_dormant:    "bg-blue-950/60 text-blue-300 border-blue-800",
  reactivation:             "bg-blue-950/60 text-blue-300 border-blue-800",
  // Things worth a second look (amber)
  first_filing_after_gap:   "bg-amber-950/60 text-amber-300 border-amber-800",
  switched_to_dormant:      "bg-amber-950/60 text-amber-300 border-amber-800",
  long_dormant:             "bg-zinc-900 text-zinc-400 border-zinc-700",
  outstanding_charge:       "bg-amber-950/60 text-amber-300 border-amber-800",
  // Activity-based (orange)
  address_churn:            "bg-orange-950/60 text-orange-300 border-orange-800",
  director_churn:           "bg-orange-950/60 text-orange-300 border-orange-800",
  director_velocity:        "bg-orange-950/60 text-orange-300 border-orange-800",
};

function PatternBadgesSection({ patterns }: { patterns: CompanyPattern[] }) {
  // Deduplicate: 'reactivation' and 'switched_from_dormant' have the same SQL,
  // so suppress one of them on the page.
  const seen = new Set<string>();
  const unique = patterns.filter((p) => {
    if (p.patternKind === "reactivation" && seen.has("switched_from_dormant")) return false;
    if (p.patternKind === "switched_from_dormant" && seen.has("reactivation")) return false;
    seen.add(p.patternKind);
    return true;
  });
  if (unique.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Patterns · {unique.length}
        </h2>
        <Link href="/methodology" className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
          How are these computed? →
        </Link>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {unique.map((p) => (
          <span
            key={p.patternKind}
            className={`badge border font-mono text-[10px] ${PATTERN_COLOURS[p.patternKind] ?? "bg-zinc-900 text-zinc-300 border-zinc-700"}`}
            title={Object.entries(p.detail)
              .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
              .join("\n")}
          >
            {p.patternLabel}
          </span>
        ))}
      </div>
    </section>
  );
}

function DirectorsAlsoRunSection({ rows }: { rows: DirectorContinuityRow[] }) {
  // Group by viaOfficerId — show each director with their other companies
  type Group = {
    viaName: string;
    viaOfficerId: string;
    companies: DirectorContinuityRow[];
  };
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const g = groups.get(row.viaOfficerId);
    if (g) {
      g.companies.push(row);
    } else {
      groups.set(row.viaOfficerId, {
        viaName: row.viaName,
        viaOfficerId: row.viaOfficerId,
        companies: [row],
      });
    }
  }
  const ordered = [...groups.values()].sort(
    (a, b) => b.companies.length - a.companies.length,
  );

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Directors also run · {rows.length}
      </h2>
      <div className="space-y-4">
        {ordered.map((g) => {
          const visible = g.companies.slice(0, 5);
          const more = g.companies.length - visible.length;
          return (
            <div key={g.viaOfficerId} className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)]"
                 style={{ boxShadow: "var(--panel-shadow)" }}>
              <div className="px-4 py-2 border-b border-[var(--border-subtle)]">
                <Link
                  href={`/officer/${g.viaOfficerId}`}
                  className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors"
                >
                  {g.viaName}
                </Link>
                <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  {g.companies.length} other {g.companies.length === 1 ? "company" : "companies"}
                </span>
              </div>
              <ul className="divide-y divide-[var(--border-subtle)]">
                {visible.map((c) => (
                  <li key={`${c.otherOfficerId}-${c.companyNumber}`}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--bg-elevated)] transition-colors">
                    <Link href={`/c/${c.companyNumber}`}
                          className="flex-1 min-w-0 text-sm text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors truncate">
                      {c.companyName}
                    </Link>
                    <span className={`badge border text-[9px] shrink-0 ${companyStatusClass(c.companyStatus)}`}>
                      {c.companyStatus}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--text-muted)] shrink-0 hidden sm:inline">
                      {c.role}{c.appointedOn ? ` · ${formatDate(c.appointedOn)}` : ""}
                      {c.resignedOn ? " · resigned" : ""}
                    </span>
                  </li>
                ))}
                {more > 0 && (
                  <li className="px-4 py-2">
                    <Link href={`/officer/${g.viaOfficerId}`}
                          className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
                      View all {g.companies.length} →
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="font-mono text-[10px] text-[var(--text-muted)] leading-relaxed">
        Matched by name and date of birth (year/month). Possible mismatches —{" "}
        <a
          href="mailto:takedowns@borsoi.co.uk?subject=Incorrect%20director%20match"
          className="hover:text-[var(--accent)] transition-colors underline underline-offset-2"
        >
          report incorrect link
        </a>.
      </p>
    </section>
  );
}

function FilingsSection({
  filings,
  restFilings,
  companyNumber,
}: {
  filings: Awaited<ReturnType<typeof getCompanyFilings>>;
  restFilings: ChRestFiling[];
  companyNumber: string;
}) {
  const hasLocal = filings.length > 0;
  const hasRest = restFilings.length > 0;
  const count = hasLocal ? filings.length : restFilings.length;
  const chBase = `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}/filing-history`;

  const FilingRow = ({ transactionId, category, type, description, filingDate }: {
    transactionId: string; category: string; type: string;
    description: string | null; filingDate: Date | string | null;
  }) => (
    <tr className="hover:bg-[var(--bg-elevated)] transition-colors">
      <td>
        <span className={`badge border ${filingCategoryColor(category)}`}>
          {filingCategoryLabel(category)}
        </span>
      </td>
      <td className="text-xs text-[var(--text-secondary)]">
        <a
          href={`${chBase}/${transactionId}/document?format=pdf&download=0`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-[var(--accent)] transition-colors"
        >
          {formatFilingDescription(type, description)} ↗
        </a>
      </td>
      <td className="text-right font-mono text-xs text-[var(--text-muted)]">
        {formatDate(filingDate)}
      </td>
    </tr>
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Filing history · {count}
        </h2>
        {!hasLocal && hasRest && (
          <span className="font-mono text-xs text-amber-400">live from Companies House</span>
        )}
      </div>
      {!hasLocal && !hasRest ? (
        <p className="text-sm text-[var(--text-muted)]">No filings recorded yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Description</th>
                <th className="text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {(hasLocal ? filings : restFilings).map((f) => (
                <FilingRow
                  key={f.transactionId}
                  transactionId={f.transactionId}
                  category={f.category}
                  type={f.type}
                  description={f.description}
                  filingDate={f.filingDate}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function officerHref(chOfficerLink: string | null | undefined, officerId: string | undefined) {
  // Prefer CH-slug-based internal URL; fall back to UUID; then null
  if (chOfficerLink) {
    const slug = chSlugFromLink(chOfficerLink);
    if (slug) return `/officer/${slug}`;
  }
  if (officerId) return `/officer/${officerId}`;
  return null;
}

function LocalOfficersSection({
  active,
  former,
}: {
  active: Awaited<ReturnType<typeof getCompanyOfficers>>;
  former: Awaited<ReturnType<typeof getCompanyOfficers>>;
}) {
  const toItem = (a: typeof active[0]) => {
    const flat = a as typeof a & { nameFull?: string; nationality?: string; occupation?: string; chOfficerLink?: string };
    return {
      href: officerHref(flat.chOfficerLink, a.officerId),
      nameFull: flat.nameFull ?? a.officer?.nameFull ?? "Unknown",
      role: a.role,
      appointedOn: a.appointedOn ? String(a.appointedOn) : null,
      resignedOn: a.resignedOn ? String(a.resignedOn) : null,
      nationality: flat.nationality ?? a.officer?.nationality ?? null,
      occupation: flat.occupation ?? a.officer?.occupation ?? null,
    };
  };
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Current officers · {active.length}
      </h2>
      {active.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No current officers recorded.</p>
      ) : (
        <OfficerList items={active.map(toItem)} />
      )}
      {former.length > 0 && (
        <FormerOfficers items={former.map(toItem)} />
      )}
    </section>
  );
}

function RestOfficersSection({ active, former }: { active: ChRestOfficer[]; former: ChRestOfficer[] }) {
  const toItem = (o: ChRestOfficer) => ({
    href: o.chOfficerLink ? `/officer/${chSlugFromLink(o.chOfficerLink) ?? ""}` : null,
    nameFull: o.nameFull,
    role: o.role,
    appointedOn: o.appointedOn,
    resignedOn: o.resignedOn,
    nationality: o.nationality,
    occupation: o.occupation,
  });
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Current officers · {active.length}
        </h2>
        <span className="font-mono text-xs text-amber-400">live from Companies House</span>
      </div>
      {active.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No current officers recorded.</p>
      ) : (
        <OfficerList items={active.map(toItem)} />
      )}
      {former.length > 0 && <FormerOfficers items={former.map(toItem)} />}
    </section>
  );
}

function OfficerList({ items }: { items: { href: string | null; nameFull: string; role: string; appointedOn: string | null; nationality: string | null; occupation: string | null }[] }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
      {items.map((o, i) => (
        <div key={i} className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              {o.href ? (
                <Link href={o.href} className="font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors">
                  {o.nameFull}
                </Link>
              ) : (
                <span className="font-medium text-[var(--text-primary)]">{o.nameFull}</span>
              )}
              {o.nationality && (
                <span className="ml-2 text-xs text-[var(--text-muted)]">{o.nationality}</span>
              )}
            </div>
            <span className="badge shrink-0 border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
              {o.role}
            </span>
          </div>
          <div className="mt-1 font-mono text-xs text-[var(--text-muted)]">
            Appointed {formatDate(o.appointedOn)}
            {o.occupation && ` · ${o.occupation}`}
          </div>
        </div>
      ))}
    </div>
  );
}

function FormerOfficers({ items }: { items: { href: string | null; nameFull: string; role: string; appointedOn: string | null; resignedOn: string | null | undefined }[] }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors select-none font-mono uppercase tracking-wide">
        {items.length} former officer{items.length !== 1 ? "s" : ""} ▸
      </summary>
      <div className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)] opacity-50">
        {items.map((o, i) => (
          <div key={i} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              {o.href ? (
                <Link href={o.href} className="font-medium text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors">
                  {o.nameFull}
                </Link>
              ) : (
                <span className="font-medium text-[var(--text-secondary)]">{o.nameFull}</span>
              )}
              <span className="badge shrink-0 border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">{o.role}</span>
            </div>
            <div className="mt-1 font-mono text-xs text-[var(--text-muted)]">
              {formatDate(o.appointedOn)} – {formatDate(o.resignedOn)}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function LocalPscsSection({ pscs }: { pscs: Awaited<ReturnType<typeof getCompanyPscs>> }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Persons with significant control · {pscs.filter((p) => !p.ceasedOn).length} active
      </h2>
      {pscs.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No PSC records.</p>
      ) : (
        <PscList pscs={pscs.map((p) => ({
          name: p.name,
          kind: p.kind,
          naturesOfControl: p.naturesOfControl,
          notifiedOn: p.notifiedOn ? String(p.notifiedOn) : null,
          ceasedOn: p.ceasedOn ? String(p.ceasedOn) : null,
          nationality: p.nationality,
          isAnonymised: p.isAnonymised,
        }))} />
      )}
    </section>
  );
}

function RestPscsSection({ pscs }: { pscs: ChRestPsc[] }) {
  const active = pscs.filter((p) => !p.ceasedOn).length;
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Persons with significant control · {active} active
      </h2>
      {pscs.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No PSC records.</p>
      ) : (
        <PscList pscs={pscs} />
      )}
    </section>
  );
}

function PscList({ pscs }: { pscs: { name: string | null; kind: string; naturesOfControl: string[]; notifiedOn: string | null; ceasedOn: string | null; nationality: string | null; isAnonymised: boolean }[] }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
      {pscs.map((p, i) => (
        <div key={i} className={`px-4 py-3 ${p.ceasedOn ? "opacity-40" : ""}`}>
          {p.isAnonymised ? (
            <p className="text-sm text-[var(--text-muted)] italic">
              Super-secure PSC — details withheld under legislation
            </p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-[var(--text-primary)]">{p.name}</span>
                <span className="badge shrink-0 border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                  {p.kind.replace(/-?person-with-significant-control$/, "").replace("individual", "person").replace("corporate-entity", "corporate").replace("legal-person", "legal").replace(/^-/, "").trim() || p.kind}
                </span>
              </div>
              {p.naturesOfControl.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {p.naturesOfControl.map((noc) => (
                    <span key={noc} className="badge border border-indigo-900 bg-indigo-950 text-indigo-400">
                      {noc.replace(/-/g, " ")}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-1 font-mono text-xs text-[var(--text-muted)]">
                Notified {formatDate(p.notifiedOn)}
                {p.ceasedOn && ` · Ceased ${formatDate(p.ceasedOn)}`}
                {p.nationality && ` · ${p.nationality}`}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
