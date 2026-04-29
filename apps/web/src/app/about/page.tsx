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

      {[
        {
          heading: "What this is",
          body: `companieshouse.watch consumes the Companies House streaming API and surfaces every
filing, officer appointment, and ownership change as it happens. No polling delay. No paywall.
Built for journalists, OSINT researchers, fraud and compliance analysts, and anyone who needs
to keep a close eye on UK companies.`,
        },
        {
          heading: "Data sourcing",
          body: `All data comes directly from Companies House under the Open Government Licence v3.0.
We do not modify the underlying data. Every datum links back to its source on the
public register.`,
        },
        {
          heading: "AI features",
          body: `Where AI-generated summaries appear they are clearly labelled with the generation date.
We use fixed prompt templates only — users never supply prompts. Hard daily (£5) and monthly
(£100) spend caps are enforced at the infrastructure level.`,
        },
        {
          heading: "Privacy",
          body: `Minimal analytics, no third-party trackers. All data displayed is public record.
We do not store personal data beyond what is required to operate the service.`,
        },
      ].map(({ heading, body }) => (
        <section key={heading} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {heading}
          </h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">
            {body}
          </p>
        </section>
      ))}

      <div className="border-t border-[var(--border-subtle)] pt-6">
        <Link href="/" className="btn-ghost text-xs">
          ← Live feed
        </Link>
      </div>
    </div>
  );
}
