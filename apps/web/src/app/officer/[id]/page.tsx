export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getOfficer, getOfficerAppointments } from "@/lib/db";
import { formatDate, companyStatusClass } from "@/lib/utils";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const officer = await getOfficer(id);
  if (!officer) return { title: "Officer not found" };
  return { title: officer.nameFull };
}

export default async function OfficerPage({ params }: Props) {
  const { id } = await params;
  const [officer, appointments] = await Promise.all([
    getOfficer(id),
    getOfficerAppointments(id),
  ]);

  if (!officer) notFound();

  const active = appointments.filter((a) => !a.resignedOn);
  const former = appointments.filter((a) => a.resignedOn);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-10">
      {/* Header */}
      <div className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)]">Person</p>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">{officer.nameFull}</h1>
        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-[var(--text-muted)]">
          {officer.occupation && <span>{officer.occupation}</span>}
          {officer.nationality && <span>{officer.nationality}</span>}
          {officer.countryOfResidence && <span>Resident: {officer.countryOfResidence}</span>}
          {officer.dateOfBirthYear && (
            <span>
              b.{" "}
              {officer.dateOfBirthMonth
                ? new Date(officer.dateOfBirthYear, officer.dateOfBirthMonth - 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
                : officer.dateOfBirthYear}
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--border-subtle)]" />

      {/* Current appointments */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Current appointments · {active.length}
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No current appointments.</p>
        ) : (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)]">
            {active.map((a, i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/c/${a.companyNumber}`}
                      className="font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors"
                    >
                      {a.companyName}
                    </Link>
                    <div className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">{a.companyNumber}</div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <span className="badge border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                      {a.role}
                    </span>
                    <span className={`badge border ${companyStatusClass(a.companyStatus)}`}>
                      {a.companyStatus}
                    </span>
                  </div>
                </div>
                <div className="mt-1 font-mono text-xs text-[var(--text-muted)]">
                  Appointed {formatDate(a.appointedOn)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Former appointments */}
      {former.length > 0 && (
        <section className="space-y-3">
          <details>
            <summary className="cursor-pointer text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors select-none font-mono uppercase tracking-wide">
              {former.length} former appointment{former.length !== 1 ? "s" : ""} ▸
            </summary>
            <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)] opacity-60">
              {former.map((a, i) => (
                <div key={i} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/c/${a.companyNumber}`}
                        className="font-medium text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
                      >
                        {a.companyName}
                      </Link>
                      <div className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">{a.companyNumber}</div>
                    </div>
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
        </section>
      )}
    </div>
  );
}
