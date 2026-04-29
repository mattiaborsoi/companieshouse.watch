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
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">
        <NavBar />
        <main className="flex-1">{children}</main>
        <footer className="border-t py-6 text-center text-xs text-gray-400">
          Data from{" "}
          <a
            href="https://www.companieshouse.gov.uk/"
            className="underline hover:text-gray-600"
            target="_blank"
            rel="noopener noreferrer"
          >
            Companies House
          </a>{" "}
          under the{" "}
          <a
            href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
            className="underline hover:text-gray-600"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Government Licence v3.0
          </a>
          .{" "}
          <a href="/about" className="underline hover:text-gray-600">
            About
          </a>
        </footer>
      </body>
    </html>
  );
}
