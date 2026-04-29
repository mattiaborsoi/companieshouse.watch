import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-8 prose prose-sm prose-gray">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 not-prose">About companieshouse.watch</h1>
        <p className="mt-3 text-gray-600 not-prose">
          A free, open-source, real-time tracker for the UK Companies House register.
        </p>
      </div>

      <section className="space-y-3 text-sm text-gray-700">
        <h2 className="text-base font-semibold text-gray-900">What this is</h2>
        <p>
          companieshouse.watch consumes the{" "}
          <a
            href="https://developer-specs.company-information.service.gov.uk/streaming-api/guides/overview"
            className="text-brand-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Companies House streaming API
          </a>{" "}
          and surfaces every filing, officer appointment, and ownership change as
          it happens. No polling delay. No paywall.
        </p>
        <p>
          Built for journalists, OSINT researchers, fraud and compliance analysts,
          and anyone who needs to keep an eye on UK companies.
        </p>
      </section>

      <section className="space-y-3 text-sm text-gray-700">
        <h2 className="text-base font-semibold text-gray-900">Data sourcing</h2>
        <p>
          All data is sourced directly from{" "}
          <a
            href="https://www.companieshouse.gov.uk/"
            className="text-brand-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Companies House
          </a>{" "}
          under the{" "}
          <a
            href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
            className="text-brand-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Government Licence v3.0
          </a>
          . We do not modify the underlying data. Every datum links back to its
          source on the Companies House public register.
        </p>
      </section>

      <section className="space-y-3 text-sm text-gray-700">
        <h2 className="text-base font-semibold text-gray-900">AI features</h2>
        <p>
          Where AI-generated summaries appear they are clearly labelled with
          "AI generated" and the generation date. We use fixed prompt templates
          only — users never supply prompts. Summaries use Anthropic Claude
          (Haiku for bulk operations) and are cached to minimise cost and
          environmental impact.
        </p>
        <p>
          Hard daily (£5) and monthly (£100) spend caps are enforced at the
          infrastructure level. AI features pause when caps are hit; cached
          results continue to be served.
        </p>
      </section>

      <section className="space-y-3 text-sm text-gray-700">
        <h2 className="text-base font-semibold text-gray-900">Privacy</h2>
        <p>
          We use minimal analytics (no third-party trackers, no cookies beyond
          what is necessary). All data we display is public record. We do not
          store personal data beyond what is required to operate the service.
        </p>
      </section>

      <section className="space-y-3 text-sm text-gray-700">
        <h2 className="text-base font-semibold text-gray-900">Open source</h2>
        <p>
          The full codebase is MIT-licensed and available on GitHub. We welcome
          contributions, bug reports, and forks.
        </p>
      </section>

      <div className="border-t pt-6">
        <Link href="/" className="text-sm text-brand-600 hover:underline">
          ← Back to live feed
        </Link>
      </div>
    </div>
  );
}
