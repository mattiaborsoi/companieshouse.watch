import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/layout/NavBar";
import Link from "next/link";

export const metadata: Metadata = {
  title: {
    template: "%s | companieshouse.watch",
    default: "companieshouse.watch — Real-time UK Companies House tracker",
  },
  description:
    "Live feed of every UK company filing, officer change, and PSC update. Free, open-source, with anomaly detection.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full dark">
      <body className="flex min-h-full flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
        <NavBar />
        <main className="flex-1">{children}</main>

        <footer className="mt-16 border-t border-[var(--border)] bg-[var(--bg-surface)]">
          {/* Support strip */}
          <div className="border-b border-[var(--border-subtle)] py-3 px-4">
            <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-2">
              <p className="font-mono text-xs text-[var(--text-muted)] text-center sm:text-left">
                Running on{" "}
                <span className="text-[var(--text-secondary)]">~£48/mo</span>
                {" "}in infrastructure.{" "}
                <span className="text-[var(--text-secondary)]">0 sponsors</span>
                {" "}covering it so far.
              </p>
              <Link
                href="/support"
                className="font-mono text-xs uppercase tracking-widest shrink-0"
                style={{ color: "var(--alert)" }}
              >
                Support the project ♥
              </Link>
            </div>
          </div>

          {/* Main footer links */}
          <div className="py-5 px-4">
            <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                Data from{" "}
                <a href="https://www.companieshouse.gov.uk/" target="_blank" rel="noopener noreferrer"
                   className="text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors">
                  Companies House
                </a>
                {" "}under the{" "}
                <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
                   target="_blank" rel="noopener noreferrer"
                   className="text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors">
                  OGL v3.0
                </a>
              </p>
              <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                <Link href="/about"   className="hover:text-[var(--accent)] transition-colors">About</Link>
                <Link href="/support" className="hover:text-[var(--accent)] transition-colors">Support</Link>
                <a href="https://github.com/companieshouse-watch/companieshouse.watch"
                   target="_blank" rel="noopener noreferrer"
                   className="hover:text-[var(--accent)] transition-colors">
                  Open source
                </a>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
