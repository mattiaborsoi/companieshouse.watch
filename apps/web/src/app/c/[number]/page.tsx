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
  if (local) return { title: local.name };
  const remote = await getCompanyFromChRest(cn);
  if (remote) return { title: remote.name };
  return { title: "Company not found" };
}

export default async function CompanyPage({ params }: Props) {
  const { number } = await params;
  const cn = number.toUpperCase();

  // Try local DB first; fall back to CH REST
  const localCompany = await getCompany(cn);

  if (localCompany) {
    const [filings, officers, pscs] = await Promise.all([
      getCompanyFilings(cn),
      getCompanyOfficers(cn),
      getCompanyPscs(cn),
    ]);
    // If the local DB has no filings yet, pull them from CH REST as fallback
    const restFilings = filings.length === 0 ? await getFilingsFromChRest(cn) : [];
    return (
      <CompanyProfile
        company={localCompany}
        filings={filings}
        restFilings={restFilings}
        officers={officers}
        pscs={pscs}
        fromRest={false}
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
}: {
  company: AnyCompany;
  filings: Awaited<ReturnType<typeof getCompanyFilings>>;
  restFilings?: ChRestFiling[];
  officers: Awaited<ReturnType<typeof getCompanyOfficers>>;
  pscs: Awaited<ReturnType<typeof getCompanyPscs>>;
  restOfficers?: ChRestOfficer[];
  restPscs?: ChRestPsc[];
  fromRest: boolean;
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

      {/* Officers */}
      {fromRest ? (
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

function LocalOfficersSection({
  active,
  former,
}: {
  active: Awaited<ReturnType<typeof getCompanyOfficers>>;
  former: Awaited<ReturnType<typeof getCompanyOfficers>>;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Current officers · {active.length}
      </h2>
      {active.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No current officers recorded.</p>
      ) : (
        <OfficerList items={active.map((a) => {
          const flat = a as typeof a & { nameFull?: string; nationality?: string; occupation?: string };
          return {
            officerId: a.officerId,
            nameFull: flat.nameFull ?? a.officer?.nameFull ?? "Unknown",
            role: a.role,
            appointedOn: a.appointedOn ? String(a.appointedOn) : null,
            resignedOn: a.resignedOn ? String(a.resignedOn) : null,
            nationality: flat.nationality ?? a.officer?.nationality ?? null,
            occupation: flat.occupation ?? a.officer?.occupation ?? null,
          };
        })} />
      )}
      {former.length > 0 && (
        <FormerOfficers items={former.map((a) => {
          const flat = a as typeof a & { nameFull?: string };
          return {
            officerId: a.officerId,
            nameFull: flat.nameFull ?? a.officer?.nameFull ?? "Unknown",
            role: a.role,
            appointedOn: a.appointedOn ? String(a.appointedOn) : null,
            resignedOn: a.resignedOn ? String(a.resignedOn) : null,
          };
        })} />
      )}
    </section>
  );
}

function RestOfficersSection({ active, former }: { active: ChRestOfficer[]; former: ChRestOfficer[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Current officers · {active.length}
      </h2>
      {active.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No current officers recorded.</p>
      ) : (
        <OfficerList items={active} />
      )}
      {former.length > 0 && <FormerOfficers items={former} />}
    </section>
  );
}

function OfficerList({ items }: { items: { officerId?: string; nameFull: string; role: string; appointedOn: string | null; nationality: string | null; occupation: string | null }[] }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
      {items.map((o, i) => (
        <div key={i} className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              {o.officerId ? (
                <Link href={`/officer/${o.officerId}`} className="font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors">
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

function FormerOfficers({ items }: { items: { officerId?: string; nameFull: string; role: string; appointedOn: string | null; resignedOn: string | null | undefined }[] }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors select-none font-mono uppercase tracking-wide">
        {items.length} former officer{items.length !== 1 ? "s" : ""} ▸
      </summary>
      <div className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)] opacity-50">
        {items.map((o, i) => (
          <div key={i} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              {o.officerId ? (
                <Link href={`/officer/${o.officerId}`} className="font-medium text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors">
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
