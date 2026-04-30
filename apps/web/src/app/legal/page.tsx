import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Legal & takedown — companieshouse.watch" };

export default function LegalPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 space-y-10">

      <div className="space-y-2">
        <p className="section-label">Legal</p>
        <h1 className="font-mono text-3xl font-bold text-[var(--text-primary)]">
          Legal &amp; takedown
        </h1>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-xl">
          This site republishes public data from the UK Companies House register.
          All information is sourced from Companies House under the{" "}
          <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
            target="_blank" rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline underline-offset-2">
            Open Government Licence v3.0
          </a>.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="section-label">Data source</h2>
        <div className="panel p-5 space-y-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          <p>
            All company, officer, and PSC data displayed on this site is drawn directly from the
            Companies House public register via their official API and streaming service.
            We do not create, alter, or supplement this data.
          </p>
          <p>
            Anomaly scores are computed automatically from patterns in the public register data.
            They are statistical indicators only and <strong className="text-[var(--text-primary)]">are not allegations of wrongdoing</strong>.
            A high score means an unusual pattern was detected — nothing more.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-label">Takedown requests</h2>
        <div className="panel p-5 space-y-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          <p>
            If you believe information displayed here is inaccurate, out-of-date, or is causing
            you harm, please contact us. We aim to respond within <strong className="text-[var(--text-primary)]">24 hours</strong>.
          </p>
          <p>
            Note that because this data is sourced directly from Companies House, the authoritative
            way to correct inaccurate information is to file an amendment with Companies House
            directly at{" "}
            <a href="https://find-and-update.company-information.service.gov.uk"
              target="_blank" rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline underline-offset-2">
              find-and-update.company-information.service.gov.uk
            </a>.
            Once updated there, this site will reflect the change automatically.
          </p>
          <div className="border border-[var(--border)] rounded-md px-4 py-3 bg-[var(--bg-elevated)]">
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1">Takedown email</div>
            <a href="mailto:takedowns@borsoi.co.uk"
              className="font-mono text-sm font-bold text-[var(--accent)] hover:underline underline-offset-2">
              takedowns@borsoi.co.uk
            </a>
            <div className="font-mono text-[10px] text-[var(--text-muted)] mt-1">24-hour response target</div>
          </div>
          <p className="font-mono text-[10px] text-[var(--text-muted)]">
            Please include: the URL of the page in question, the specific information you believe
            is incorrect or harmful, and your contact details.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-label">Disclaimer</h2>
        <div className="panel p-5 space-y-3 text-sm text-[var(--text-secondary)] leading-relaxed">
          <p>
            This is an independent project and is not affiliated with, endorsed by, or operated
            by Companies House or His Majesty&apos;s Government.
          </p>
          <p>
            The anomaly detection on this site identifies statistical patterns — unusual concentrations
            of companies at an address, rapid director turnover, or bulk incorporation events.
            These patterns may have entirely legitimate explanations (formation agents, group
            structures, registered-office services). Nothing on this site constitutes legal advice,
            a finding of fraud, or an allegation of any kind.
          </p>
          <p>
            This site is provided free of charge and without warranty. Use of this data is at
            your own risk.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-label">Open source</h2>
        <div className="panel p-5 text-sm text-[var(--text-secondary)] leading-relaxed">
          <p>
            This project is open source (MIT licence). The source code is available on{" "}
            <a href="https://github.com/mattiaborsoi/companieshouse.watch"
              target="_blank" rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline underline-offset-2">
              GitHub
            </a>.
          </p>
        </div>
      </section>

      <div className="pt-2">
        <Link href="/" className="btn-ghost text-xs">← Back to home</Link>
      </div>
    </div>
  );
}
