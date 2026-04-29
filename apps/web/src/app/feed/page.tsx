import type { Metadata } from "next";
import FeedClient from "./FeedClient";

export const metadata: Metadata = { title: "Live feed" };

export default function FeedPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Live filing feed</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Every filing as it hits the Companies House stream
          </p>
        </div>
      </div>
      <FeedClient />
    </div>
  );
}
