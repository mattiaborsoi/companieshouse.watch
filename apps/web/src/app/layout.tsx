import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/layout/NavBar";

export const metadata: Metadata = {
  title: {
    template: "%s | companieshouse.watch",
    default: "companieshouse.watch — Real-time UK Companies House tracker",
  },
  description:
    "Live feed of every UK company filing, officer change, and PSC update. Free, open-source, with anomaly detection.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full dark">
      <body className="flex min-h-full flex-col bg-[var(--bg-base)] text-[var(--text-primary)]">
        <NavBar />
        <main className="flex-1">{children}</main>
        <footer className="mt-16 border-t border-[var(--border-subtle)] py-6 text-center text-xs text-[var(--text-muted)]">
          Data from{" "}
          <a
            href="https://www.companieshouse.gov.uk/"
            className="text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--accent)] hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Companies House
          </a>{" "}
          under the Open Government Licence v3.0.{" "}
          <a href="/about" className="text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--accent)] hover:underline">
            About
          </a>
          {" · "}
          <a
            href="https://github.com"
            className="text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--accent)] hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open source
          </a>
        </footer>
      </body>
    </html>
  );
}
