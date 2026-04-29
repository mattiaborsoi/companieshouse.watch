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
    addr.country,
  ].filter(Boolean);

  const activeOfficers = officers.filter((o) => !o.resignedOn);
  const formerOfficers = officers.filter((o) => o.resignedOn);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{company.name}</h1>
          <span className={`badge mt-1 ${companyStatusClass(company.status)}`}>
            {company.status}
          </span>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-gray-500">
          <span>
            <span className="font-mono">{company.companyNumber}</span>
          </span>
          <span>{company.type}</span>
          {company.incorporatedOn && (
            <span>Incorporated {formatDate(company.incorporatedOn)}</span>
          )}
          {company.dissolvedOn && (
            <span className="text-red-500">Dissolved {formatDate(company.dissolvedOn)}</span>
          )}
        </div>

        {addressLines.length > 0 && (
          <address className="not-italic text-sm text-gray-600">
            {addressLines.join(", ")}
          </address>
        )}

        {company.sicCodes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {company.sicCodes.map((sic) => (
              <span key={sic} className="badge border-gray-200 bg-gray-50 text-gray-600">
                SIC {sic}
              </span>
            ))}
          </div>
        )}

        <a
          href={`https://find-and-update.company-information.service.gov.uk/company/${company.companyNumber}`}
          className="inline-text text-xs text-brand-600 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          View on Companies House ↗
        </a>
      </div>

      {/* Filings */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Filing history ({filings.length})
        </h2>
        {filings.length === 0 ? (
          <p className="text-sm text-gray-400">No filings recorded yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-xs text-gray-500">
                  <th className="px-4 py-2 text-left">Category</th>
                  <th className="px-4 py-2 text-left">Description</th>
                  <th className="px-4 py-2 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filings.map((f) => (
                  <tr key={f.transactionId} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <span className={`badge ${filingCategoryColor(f.category)}`}>
                        {filingCategoryLabel(f.category)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {f.description || f.type}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">
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
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Current officers ({activeOfficers.length})
        </h2>
        {activeOfficers.length === 0 ? (
          <p className="text-sm text-gray-400">No current officers recorded.</p>
        ) : (
          <div className="rounded-lg border bg-white divide-y text-sm">
            {activeOfficers.map((a) => (
              <div key={`${a.officerId}-${a.role}-${String(a.appointedOn)}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-medium text-gray-900">{a.officer?.nameFull ?? "Unknown"}</span>
                    {a.officer?.nationality && (
                      <span className="ml-2 text-gray-500">{a.officer.nationality}</span>
                    )}
                  </div>
                  <span className="badge border-gray-200 bg-gray-50 text-gray-600 shrink-0">
                    {a.role}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-gray-400">
                  Appointed {formatDate(a.appointedOn)}
                  {a.officer?.occupation && ` · ${a.officer.occupation}`}
                </div>
              </div>
            ))}
          </div>
        )}

        {formerOfficers.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
              {formerOfficers.length} former officer{formerOfficers.length !== 1 ? "s" : ""}
            </summary>
            <div className="mt-2 rounded-lg border bg-white divide-y text-sm opacity-60">
              {formerOfficers.map((a) => (
                <div key={`${a.officerId}-${a.role}-${String(a.appointedOn)}`} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-gray-700">{a.officer?.nameFull ?? "Unknown"}</span>
                    <span className="badge border-gray-200 bg-gray-50 text-gray-600 shrink-0">
                      {a.role}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-gray-400">
                    {formatDate(a.appointedOn)} – {formatDate(a.resignedOn)}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* PSCs */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Persons with significant control ({pscs.filter((p) => !p.ceasedOn).length} active)
        </h2>
        {pscs.length === 0 ? (
          <p className="text-sm text-gray-400">No PSC records.</p>
        ) : (
          <div className="rounded-lg border bg-white divide-y text-sm">
            {pscs.map((p) => (
              <div key={p.chPscLink} className={`px-4 py-3 ${p.ceasedOn ? "opacity-50" : ""}`}>
                {p.isAnonymised ? (
                  <div className="text-gray-500 italic">
                    Super-secure PSC (details withheld under legislation)
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-gray-900">{p.name}</span>
                      <span className="badge border-gray-200 bg-gray-50 text-gray-600 shrink-0">
                        {p.kind.replace("company-psc-", "")}
                      </span>
                    </div>
                    {p.naturesOfControl.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.naturesOfControl.map((noc) => (
                          <span key={noc} className="badge border-indigo-200 bg-indigo-50 text-indigo-700">
                            {noc.replace(/-/g, " ")}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-0.5 text-xs text-gray-400">
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
