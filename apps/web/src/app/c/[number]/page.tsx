export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import {
  getCompany,
  getCompanyFilings,
  getCompanyOfficers,
  getCompanyPscs,
  getCompanyFromChRest,
  getOfficersFromChRest,
  getPscsFromChRest,
  getFilingsFromChRest,
  getAnomalyForAddress,
  chSlugFromLink,
  type Company,
  type ChRestCompany,
  type ChRestFiling,
  type ChRestOfficer,
  type ChRestPsc,
} from "@/lib/db";
import {
  formatDate,
  companyStatusClass,
  filingCategoryLabel,
  filingCategoryColor,
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
    const [filings, officers, pscs, clusterAnomaly] = await Promise.all([
      getCompanyFilings(cn),
      getCompanyOfficers(cn),
      getCompanyPscs(cn),
      addrHash ? getAnomalyForAddress(addrHash) : Promise.resolve(null),
    ]);
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
      />
    );
  }

  // Not in local DB — fetch live from CH REST
  const [restCompany, restOfficers, restPscs] = await Promise.all([
    getCompanyFromChRest(cn),
    getOfficersFromChRest(cn),
    getPscsFromChRest(cn),
  ]);

  if (!restCompany) notFound();

  const restFilings = await getFilingsFromChRest(cn);
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
          <h1 className="text-2xl font-bold text-[var(--text-primary)] leading-tight">
            {company.name}
          </h1>
          <span className={`badge mt-1 border ${companyStatusClass(company.status)}`}>
            {company.status}
          </span>
        </div>

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
            {company.sicCodes.map((sic: string) => (
              <span key={sic} className="badge border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                SIC {sic}
              </span>
            ))}
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

      {/* Filing history */}
      <FilingsSection filings={filings} restFilings={restFilings} />

      {/* Officers — prefer local data; fall back to REST when local is empty */}
      {(fromRest || officers.length === 0) && restOfficers.length > 0 ? (
        <RestOfficersSection active={activeRestOfficers} former={formerRestOfficers} />
      ) : (
        <LocalOfficersSection active={activeOfficers} former={formerOfficers} />
      )}

      {/* PSCs */}
      {fromRest ? (
        <RestPscsSection pscs={restPscs} />
      ) : (
        <LocalPscsSection pscs={pscs} />
      )}
    </div>
  );
}

function FilingsSection({
  filings,
  restFilings,
}: {
  filings: Awaited<ReturnType<typeof getCompanyFilings>>;
  restFilings: ChRestFiling[];
}) {
  const hasLocal = filings.length > 0;
  const hasRest = restFilings.length > 0;
  const count = hasLocal ? filings.length : restFilings.length;

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
              {hasLocal
                ? filings.map((f) => (
                    <tr key={f.transactionId}>
                      <td>
                        <span className={`badge border ${filingCategoryColor(f.category)}`}>
                          {filingCategoryLabel(f.category)}
                        </span>
                      </td>
                      <td className="text-xs text-[var(--text-secondary)]">{f.description || f.type}</td>
                      <td className="text-right font-mono text-xs text-[var(--text-muted)]">
                        {formatDate(f.filingDate)}
                      </td>
                    </tr>
                  ))
                : restFilings.map((f) => (
                    <tr key={f.transactionId}>
                      <td>
                        <span className={`badge border ${filingCategoryColor(f.category)}`}>
                          {filingCategoryLabel(f.category)}
                        </span>
                      </td>
                      <td className="text-xs text-[var(--text-secondary)]">{f.description || f.type}</td>
                      <td className="text-right font-mono text-xs text-[var(--text-muted)]">
                        {formatDate(f.filingDate)}
                      </td>
                    </tr>
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
