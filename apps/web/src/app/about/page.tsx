import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          companieshouse<span className="text-[var(--accent)]">.</span>watch
        </h1>
        <p className="mt-2 text-[var(--text-secondary)]">
          A free, open-source, real-time tracker for the UK Companies House register.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">What this is</h2>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          companieshouse.watch consumes the Companies House streaming API and surfaces every
          filing, officer appointment, and ownership change as it happens — no polling delay,
          no paywall. Built for journalists, OSINT researchers, fraud and compliance analysts,
          and anyone who needs to keep a close eye on UK companies.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">How to use it</h2>

        <div className="space-y-4">
          <div className="border-l-2 border-[var(--border)] pl-4 space-y-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Search for a company</p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Type a company name, registration number, postcode, or person into the search box.
              You&apos;ll get the company&apos;s current status, registered address, filing history,
              officers, and persons with significant control — all in one place.
            </p>
          </div>

          <div className="border-l-2 border-[var(--border)] pl-4 space-y-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Watch the live feed</p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              The <Link href="/feed" className="text-[var(--accent)] hover:underline">live feed</Link> shows
              every event streaming from Companies House in real time: new filings, officer
              appointments, PSC changes, and incorporations. Filter by category to focus on
              what matters to you.
            </p>
          </div>

          <div className="border-l-2 border-[var(--border)] pl-4 space-y-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Read a profile end-to-end</p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Each company profile shows the registered identity (favicon, website, description),
              <Link href="/methodology" className="text-[var(--accent)] hover:underline"> filing-pattern badges</Link>{" "}
              like &quot;director churn&quot; or &quot;long dormant&quot;, recent press mentions,
              other companies the directors are involved with, full filing history with direct
              links to the Companies House PDFs, and the live PSC structure.
            </p>
          </div>

          <div className="border-l-2 border-[var(--border)] pl-4 space-y-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Investigate anomalies</p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              The <Link href="/anomalies" className="text-[var(--accent)] hover:underline">anomaly
              detection</Link> page automatically flags statistical outliers in the register.
              Each anomaly is scored 0–100: higher scores indicate a more unusual pattern.
              Click any anomaly for the full data and an optional AI-generated plain-English
              summary of the pattern.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Anomaly types explained</h2>

        <div className="space-y-4">
          <div className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-4 space-y-2">
            <p className="text-xs font-mono font-semibold uppercase tracking-wider text-[var(--accent)]">Address cluster</p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              An unusually large number of companies share a single registered address.
              This is common at registered-office service providers, formation agents, and
              virtual offices — but can also appear at addresses associated with rapid
              company formation activity. The score reflects the total company count,
              recent incorporations, and how many directors appear across multiple companies
              at the same address.
            </p>
          </div>

          <div className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-4 space-y-2">
            <p className="text-xs font-mono font-semibold uppercase tracking-wider text-[var(--accent)]">Director velocity</p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              A single officer holds an unusually high number of active directorships,
              with a concentration of recent appointments. Legitimate nominees, company
              secretarial services, and group holding structures can produce this pattern —
              but so can rapid formation activity where one person is named director across
              many newly-created companies in a short window.
            </p>
          </div>

          <div className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-4 space-y-2">
            <p className="text-xs font-mono font-semibold uppercase tracking-wider text-[var(--accent)]">Officer churn</p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              A company with an unusually high rate of officer appointments and resignations
              within a 90-day window. Sustained churn — particularly where terminations
              outnumber appointments — can indicate instability, nominee cycling, or a
              phoenix-style pattern where control is rapidly transferred. Legitimate
              restructuring can produce similar numbers.
            </p>
          </div>

          <div className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-4 space-y-2">
            <p className="text-xs font-mono font-semibold uppercase tracking-wider text-[var(--accent)]">Bulk registration</p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Ten or more companies were incorporated at the same registered address on the
              same calendar day. This is the defining signature of formation-agent activity
              and coordinated shell company creation. Registered-office service providers
              handling legitimate client registrations can trigger this pattern — but so
              can addresses used for mass nominee incorporation.
            </p>
          </div>
        </div>

        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          Anomaly scores are statistical only. They indicate an unusual pattern in the
          public register — not wrongdoing. Always consult the underlying Companies House
          records and seek professional advice before drawing conclusions.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Data sourcing</h2>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          All Companies House data — filings, officers, PSCs, registered addresses — comes
          directly from the Companies House public register under the Open Government Licence
          v3.0. We do not modify the underlying data; every datum links back to its source.
        </p>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          The <em>In the news</em> section on company profiles is sourced from the public
          GDELT global news index. Headlines appear verbatim, links open the original article on
          the publisher&apos;s site. We don&apos;t curate, rank, or summarise these mentions —
          they&apos;re a passthrough.
        </p>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          Company website + description + favicon (where shown) is resolved by searching for the
          official site and verifying the company name and registration number appear on the page.
          A &quot;report incorrect website&quot; link on every profile takes feedback at any time.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">AI features</h2>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          Where AI-generated summaries appear they are clearly labelled with the model and
          generation date. We use fixed prompt templates only — users never supply prompts.
          Hard daily (£5) and monthly (£100) spend caps are enforced at the infrastructure
          level. AI summaries are factual descriptions of the data pattern only; they do not
          constitute legal or investigative conclusions.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Privacy</h2>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          Minimal analytics, no third-party trackers. All data displayed is public record.
          We do not store personal data beyond what is required to operate the service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Open source</h2>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          companieshouse.watch is open source under the MIT licence.{" "}
          <a
            href="https://github.com/mattiaborsoi/companieshouse.watch"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            View the source on GitHub →
          </a>
        </p>
      </section>

      <div className="border-t border-[var(--border-subtle)] pt-6 flex gap-4">
        <Link href="/" className="btn-ghost text-xs">← Home</Link>
        <Link href="/anomalies" className="btn-ghost text-xs">View anomalies →</Link>
      </div>
    </div>
  );
}
