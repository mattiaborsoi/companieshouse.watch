import type { Metadata } from "next";
import FeedClient from "./FeedClient";

export const metadata: Metadata = { title: "Live feed" };

export default function FeedPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Live filing feed</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Every filing as it hits the Companies House stream
        </p>
      </div>
      <FeedClient />
    </div>
  );
}
