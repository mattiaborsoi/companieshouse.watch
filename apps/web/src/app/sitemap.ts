import type { MetadataRoute } from "next";
import { getSitemapCompanies, getAnomalies } from "@/lib/db";

// robots.ts advertises /sitemap.xml; without this route it 404'd, so crawlers
// fell back to brute-force link-walking every /c/* and /officer/* page — the
// bulk of our bot load. This gives them a bounded, freshness-ranked list.
//
// Next serves this at /sitemap.xml. We revalidate hourly so it isn't
// regenerated (a 5k-row query) on every crawler hit.
export const revalidate = 3600;

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ch.borsoi.co.uk";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, changeFrequency: "hourly", priority: 1.0 },
    { url: `${BASE}/feed`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${BASE}/anomalies`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/search`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${BASE}/about`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE}/methodology`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE}/support`, changeFrequency: "monthly", priority: 0.2 },
    { url: `${BASE}/legal`, changeFrequency: "yearly", priority: 0.2 },
  ];

  // Degrade gracefully — a sitemap with just the static pages is better than a
  // 500 if the DB is briefly unavailable.
  let companies: MetadataRoute.Sitemap = [];
  let anomalies: MetadataRoute.Sitemap = [];
  try {
    const rows = await getSitemapCompanies(5000);
    companies = rows.map((c) => ({
      url: `${BASE}/c/${c.companyNumber}`,
      lastModified: c.lastMod ?? undefined,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));
  } catch {
    /* fall through with empty company list */
  }
  try {
    const rows = await getAnomalies(200);
    anomalies = rows.map((a) => ({
      url: `${BASE}/anomalies/${a.id}`,
      lastModified: a.lastDetectedAt ?? undefined,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    }));
  } catch {
    /* fall through with empty anomaly list */
  }

  return [...staticPages, ...anomalies, ...companies];
}
