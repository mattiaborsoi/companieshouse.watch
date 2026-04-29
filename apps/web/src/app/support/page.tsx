import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Support the project" };

const COSTS = [
  { item: "Server (VPS + Postgres)",  monthly: "~£25",  note: "Hetzner CX21 + managed DB" },
  { item: "Anthropic API (AI)",        monthly: "~£15",  note: "Capped at £100/mo hard limit" },
  { item: "Domain + CDN",             monthly: "~£3",   note: "companieshouse.watch via Cloudflare" },
  { item: "Monitoring + backups",      monthly: "~£5",   note: "Healthchecks.io + nightly dump" },
  { item: "Developer time",           monthly: "∞",     note: "Nights and weekends, purely volunteer" },
];

const TOTAL_MONTHLY = "~£48";

export default function SupportPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 space-y-12">

      {/* Header */}
      <div className="space-y-3">
        <p className="section-label">Support the project</p>
        <h1 className="font-mono text-3xl font-bold text-[var(--text-primary)]">
          Keep the register open.
        </h1>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          companieshouse.watch is free, open-source, and has no paywall. It runs 24/7,
          streams every change from Companies House as it happens, and stores nothing beyond
          what's already public record. It costs real money to operate. If it's useful to
          you — for journalism, research, compliance, or curiosity — consider helping cover
          the running costs.
        </p>
      </div>

      <div className="border-t border-[var(--border)]" />

      {/* Running costs */}
      <section className="space-y-4">
        <h2 className="section-label">What it actually costs</h2>

        <div className="panel overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Per month</th>
                <th className="hidden sm:table-cell">Notes</th>
              </tr>
            </thead>
            <tbody>
              {COSTS.map((c) => (
                <tr key={c.item}>
                  <td className="text-[var(--text-primary)] font-medium text-sm">{c.item}</td>
                  <td className="text-right font-mono text-sm text-[var(--accent)]">{c.monthly}</td>
                  <td className="hidden sm:table-cell font-mono text-xs text-[var(--text-muted)]">{c.note}</td>
                </tr>
              ))}
              <tr className="border-t border-[var(--border)]">
                <td className="font-mono font-bold text-sm uppercase tracking-wide text-[var(--text-secondary)]">Total (infra)</td>
                <td className="text-right font-mono font-bold text-sm text-[var(--text-primary)]">{TOTAL_MONTHLY}</td>
                <td className="hidden sm:table-cell font-mono text-xs text-[var(--text-muted)]">Excluding developer time</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="font-mono text-xs text-[var(--text-muted)]">
          All AI spend is hard-capped in code — the gateway service enforces a £5/day,
          £100/month ceiling and cannot be exceeded. No runaway bills.
        </p>
      </section>

      <div className="border-t border-[var(--border)]" />

      {/* CTAs */}
      <section className="space-y-4">
        <h2 className="section-label">How to help</h2>

        <div className="grid gap-4 sm:grid-cols-3">

          {/* GitHub Sponsors */}
          <a
            href="https://github.com/sponsors"
            target="_blank"
            rel="noopener noreferrer"
            className="panel p-5 space-y-3 hover:border-[var(--border-bright)] transition-colors group block"
          >
            <div className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors">
              Recommended
            </div>
            <div className="font-mono text-lg font-bold text-[var(--text-primary)]">GitHub Sponsors</div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Recurring monthly contribution. Most direct way to fund ongoing development.
            </p>
            <div className="font-mono text-xs text-[var(--accent)] group-hover:underline underline-offset-2">
              github.com/sponsors →
            </div>
          </a>

          {/* Buy Me a Coffee */}
          <a
            href="https://buymeacoffee.com"
            target="_blank"
            rel="noopener noreferrer"
            className="panel p-5 space-y-3 hover:border-[var(--border-bright)] transition-colors group block"
          >
            <div className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors">
              One-off
            </div>
            <div className="font-mono text-lg font-bold text-[var(--text-primary)]">Buy Me a Coffee</div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              A one-time contribution. Covers an hour of server costs and is genuinely appreciated.
            </p>
            <div className="font-mono text-xs text-[var(--accent)] group-hover:underline underline-offset-2">
              buymeacoffee.com →
            </div>
          </a>

          {/* Pro plan */}
          <div className="panel p-5 space-y-3 opacity-60">
            <div className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)]">
              Coming soon
            </div>
            <div className="font-mono text-lg font-bold text-[var(--text-primary)]">Pro plan</div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              £8/mo. More AI generations, CSV exports, watchlist alerts, read API.
              Same data — just higher limits.
            </p>
            <div className="font-mono text-xs text-[var(--text-muted)]">
              In development
            </div>
          </div>

        </div>
      </section>

      <div className="border-t border-[var(--border)]" />

      {/* Principles */}
      <section className="space-y-3">
        <h2 className="section-label">What we promise</h2>
        <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
          {[
            "The live feed, search, and all profile pages are free forever. No paywalls.",
            "No advertising, no tracking pixels, no third-party analytics beyond minimal self-hosted stats.",
            "No dark patterns — no email popups, no upsell modals, no cookie walls.",
            "Every AI-generated summary is clearly labelled with the date it was generated.",
            "The source code is MIT-licensed and publicly available. You can self-host the entire stack.",
            "Companies House data is published under the Open Government Licence v3.0. We attribute it and pass it through.",
          ].map((p) => (
            <li key={p} className="flex items-start gap-2">
              <span className="text-[var(--accent)] mt-0.5 shrink-0">·</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="border-t border-[var(--border)] pt-6">
        <Link href="/" className="btn-ghost text-xs">
          ← Back to live feed
        </Link>
      </div>
    </div>
  );
}
