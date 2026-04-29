export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import {
  getCompany,
  getCompanyFilings,
  getCompanyOfficers,
  getCompanyPscs,
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
  const company = await getCompany(number.toUpperCase());
  if (!company) return { title: "Company not found" };
  return { title: company.name };
}

export default async function CompanyPage({ params }: Props) {
  const { number } = await params;
  const cn = number.toUpperCase();

  const [company, filings, officers, pscs] = await Promise.all([
    getCompany(cn),
    getCompanyFilings(cn),
    getCompanyOfficers(cn),
    getCompanyPscs(cn),
  ]);

  if (!company) notFound();

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

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-10">
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

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-[var(--text-muted)]">
          <span className="text-[var(--text-secondary)]">{company.companyNumber}</span>
          <span>{company.type}</span>
          {company.incorporatedOn && (
            <span>Inc. {formatDate(company.incorporatedOn)}</span>
          )}
          {company.dissolvedOn && (
            <span className="text-red-400">Dissolved {formatDate(company.dissolvedOn)}</span>
          )}
          {addressLines.length > 0 && (
            <span>{addressLines.join(", ")}</span>
          )}
        </div>

        {/* SIC codes */}
        {company.sicCodes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {company.sicCodes.map((sic) => (
              <span
                key={sic}
                className="badge border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]"
              >
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

      {/* Divider */}
      <div className="border-t border-[var(--border-subtle)]" />

      {/* Filings */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Filing history · {filings.length}
        </h2>
        {filings.length === 0 ? (
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
                {filings.map((f) => (
                  <tr key={f.transactionId}>
                    <td>
                      <span className={`badge border ${filingCategoryColor(f.category)}`}>
                        {filingCategoryLabel(f.category)}
                      </span>
                    </td>
                    <td className="text-xs text-[var(--text-secondary)]">
                      {f.description || f.type}
                    </td>
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

      {/* Officers */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Current officers · {activeOfficers.length}
        </h2>
        {activeOfficers.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No current officers recorded.</p>
        ) : (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
            {activeOfficers.map((a) => (
              <div key={`${a.officerId}-${a.role}-${String(a.appointedOn)}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="font-medium text-[var(--text-primary)]">
                      {a.officer?.nameFull ?? "Unknown"}
                    </span>
                    {a.officer?.nationality && (
                      <span className="ml-2 text-xs text-[var(--text-muted)]">
                        {a.officer.nationality}
                      </span>
                    )}
                  </div>
                  <span className="badge shrink-0 border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                    {a.role}
                  </span>
                </div>
                <div className="mt-1 font-mono text-xs text-[var(--text-muted)]">
                  Appointed {formatDate(a.appointedOn)}
                  {a.officer?.occupation && ` · ${a.officer.occupation}`}
                </div>
              </div>
            ))}
          </div>
        )}

        {formerOfficers.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors select-none font-mono uppercase tracking-wide">
              {formerOfficers.length} former officer{formerOfficers.length !== 1 ? "s" : ""} ▸
            </summary>
            <div className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)] opacity-50">
              {formerOfficers.map((a) => (
                <div key={`${a.officerId}-${a.role}-${String(a.appointedOn)}`} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium text-[var(--text-secondary)]">
                      {a.officer?.nameFull ?? "Unknown"}
                    </span>
                    <span className="badge shrink-0 border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                      {a.role}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-[var(--text-muted)]">
                    {formatDate(a.appointedOn)} – {formatDate(a.resignedOn)}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* PSCs */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Persons with significant control · {pscs.filter((p) => !p.ceasedOn).length} active
        </h2>
        {pscs.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No PSC records.</p>
        ) : (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
            {pscs.map((p) => (
              <div
                key={p.chPscLink}
                className={`px-4 py-3 ${p.ceasedOn ? "opacity-40" : ""}`}
              >
                {p.isAnonymised ? (
                  <p className="text-sm text-[var(--text-muted)] italic">
                    Super-secure PSC — details withheld under legislation
                  </p>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium text-[var(--text-primary)]">{p.name}</span>
                      <span className="badge shrink-0 border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                        {p.kind.replace("company-psc-", "")}
                      </span>
                    </div>
                    {p.naturesOfControl.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {p.naturesOfControl.map((noc) => (
                          <span
                            key={noc}
                            className="badge border border-indigo-900 bg-indigo-950 text-indigo-400"
                          >
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
        )}
      </section>
    </div>
  );
}
