import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Methodology" };

interface PatternDoc {
  kind: string;
  label: string;
  description: string;
  rule: string;
}

const PATTERNS: PatternDoc[] = [
  {
    kind: "recently_incorporated",
    label: "New (N days old)",
    description: "Company was registered recently and is still active.",
    rule: "incorporated_on within the last 90 days; status = active.",
  },
  {
    kind: "first_filing_after_gap",
    label: "First filing in N+ years",
    description:
      "After 2+ years without any non-routine filing, the company has filed something other than a confirmation statement or gazette notice.",
    rule: "Most recent non-routine filing's previous filing was ≥2 years earlier. Routine filings excluded: CS01, GAZ1, GAZ2.",
  },
  {
    kind: "switched_to_dormant",
    label: "Switched to dormant",
    description: "Latest annual accounts are dormant (AA01); previous annual accounts were not.",
    rule: "Most recent accounts filing has type AA01; second-most-recent does not.",
  },
  {
    kind: "switched_from_dormant",
    label: "Switched from dormant",
    description: "Latest annual accounts are non-dormant; previous annual accounts were dormant.",
    rule: "Most recent accounts filing has any non-AA01 type; second-most-recent has type AA01.",
  },
  {
    kind: "long_dormant",
    label: "Long dormant",
    description: "Last several annual accounts have all been dormant.",
    rule: "Of the last 5 (or all available, if fewer) accounts filings, every one is type AA01; at least 3 such filings on file.",
  },
  {
    kind: "address_churn",
    label: "Address changed N×",
    description: "The registered office address has changed multiple times in the last 12 months.",
    rule: "≥2 AD01 filings within trailing 12 months.",
  },
  {
    kind: "director_churn",
    label: "Director churn",
    description: "High volume of director appointments and resignations within the last 12 months.",
    rule: "≥3 director appointment OR resignation events within trailing 12 months.",
  },
  {
    kind: "director_velocity",
    label: "Director appointed at N companies / 90 days",
    description: "One of this company's directors has been appointed at multiple other companies recently.",
    rule: "At least one director with ≥3 distinct appointments in the last 90 days. Surfaces the most-active director only.",
  },
  {
    kind: "outstanding_charge",
    label: "Outstanding charge",
    description: "Companies House records at least one outstanding charge against this company.",
    rule: "companies.has_charges = true and status = active.",
  },
];

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 space-y-10">
      <div className="space-y-2">
        <p className="section-label">Methodology</p>
        <h1 className="font-mono text-3xl font-bold text-[var(--text-primary)]">
          How patterns are computed
        </h1>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-xl">
          Every badge on a company profile is computed deterministically from the public
          Companies House register. The exact rules are documented below. Patterns describe
          factual statistical signals — they are <strong className="text-[var(--text-primary)]">not allegations</strong>{" "}
          and have ordinary commercial explanations far more often than not.
        </p>
      </div>

      <section className="space-y-4">
        {PATTERNS.map((p) => (
          <div key={p.kind} className="panel p-5 space-y-2">
            <div className="flex items-baseline gap-3">
              <h2 className="font-mono text-sm font-bold text-[var(--text-primary)]">{p.label}</h2>
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                {p.kind}
              </span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{p.description}</p>
            <p className="font-mono text-[10px] text-[var(--text-muted)] leading-relaxed">
              <span className="uppercase tracking-widest">Rule</span> · {p.rule}
            </p>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="section-label">Refresh cadence</h2>
        <div className="panel p-5 text-sm text-[var(--text-secondary)] leading-relaxed">
          <p>
            All patterns are recomputed nightly across every company in our database. Patterns
            that no longer apply are marked inactive (rather than deleted) so the badges
            reflect the current state of the register.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-label">Data and disclaimers</h2>
        <div className="panel p-5 text-sm text-[var(--text-secondary)] leading-relaxed space-y-2">
          <p>
            All input data comes from Companies House under the Open Government Licence v3.0.
            Patterns are derived from filings, appointments, and company status — never from
            third-party data.
          </p>
          <p>
            See the <Link href="/legal" className="text-[var(--accent)] hover:underline underline-offset-2">legal &amp; takedown</Link> page
            for how to report incorrect or harmful information.
          </p>
        </div>
      </section>

      <div className="pt-2">
        <Link href="/" className="btn-ghost text-xs">← Back to home</Link>
      </div>
    </div>
  );
}
