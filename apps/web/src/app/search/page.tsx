export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { searchCompanies } from "@/lib/db";
import SearchBox from "@/components/ui/SearchBox";
import { companyStatusClass, formatDate } from "@/lib/utils";

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `Search: ${q}` : "Search" };
}

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const results = query.length >= 2 ? await searchCompanies(query) : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-gray-900">Search</h1>
        <p className="text-sm text-gray-500">Search by company name or number</p>
      </div>

      <SearchBox initialValue={query} />

      {query.length > 0 && query.length < 2 && (
        <p className="text-sm text-gray-400">Enter at least 2 characters to search.</p>
      )}

      {query.length >= 2 && results.length === 0 && (
        <p className="text-sm text-gray-500">
          No companies found for <strong>{query}</strong>.
        </p>
      )}

      {results.length > 0 && (
        <>
          <p className="text-xs text-gray-400">
            {results.length} result{results.length !== 1 ? "s" : ""} for{" "}
            <strong className="text-gray-600">{query}</strong>
          </p>
          <div className="space-y-2">
            {results.map((c) => (
              <Link
                key={c.companyNumber}
                href={`/c/${c.companyNumber}`}
                className="block rounded-lg border bg-white p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900">{c.name}</div>
                    <div className="mt-0.5 font-mono text-xs text-gray-400">
                      {c.companyNumber}
                    </div>
                  </div>
                  <span className={`badge shrink-0 ${companyStatusClass(c.status)}`}>
                    {c.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                  <span>{c.type}</span>
                  {c.incorporatedOn && (
                    <span>Inc. {formatDate(c.incorporatedOn)}</span>
                  )}
                  {c.registeredAddressPostcode && (
                    <span>{c.registeredAddressPostcode.toUpperCase()}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
