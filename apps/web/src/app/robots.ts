import type { MetadataRoute } from "next";

// We're a free public CH register surfaced for journalists / researchers /
// curious citizens. Real search-engine crawlers (Google, Bing, DuckDuckGo,
// Brave, Apple) are welcome — getting indexed for "<company name> companies
// house" is the whole point.
//
// Everything AI-flavoured is declined. As of 2026-10-02 bots were ~92% of all
// traffic (96.8k req/day) against 1-8 human searches/day, and ExaSearchBot
// alone was 56.5k req/day — pure cost, no users. robots.txt is only a polite
// request, so the same list is enforced with a 403 in
// /etc/nginx/conf.d/badbots.conf for the ones that ignore it.
const AI_CRAWLERS_DISALLOWED = [
  // OpenAI
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  // Anthropic
  "ClaudeBot",
  "Claude-Web",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  // Perplexity
  "PerplexityBot",
  "Perplexity-User",
  // Exa — by far the largest single crawler hitting us
  "ExaSearchBot",
  "Exabot",
  // Google / Apple AI opt-outs (leaves Googlebot and Applebot search intact)
  "Google-Extended",
  "Applebot-Extended",
  // Meta
  "FacebookBot",
  "facebookexternalhit",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
  "meta-webindexer",
  // Other AI labs / assistants
  "cohere-ai",
  "cohere-training-data-crawler",
  "MistralAI-User",
  "DeepSeekBot",
  "YouBot",
  "AI2Bot",
  "AI2Bot-Dolma",
  "Devin",
  "NovaAct",
  "Operator",
  "LinerBot",
  "iaskspider",
  "PanguBot",
  "SBIntuitionsBot",
  "Timpibot",
  "Webzio-Extended",
  "Kangaroo Bot",
  "Poseidon Research Crawler",
  // Dataset / scrape-for-training infrastructure
  "CCBot",
  "Bytespider",
  "Diffbot",
  "ImagesiftBot",
  "Omgili",
  "omgilibot",
  "img2dataset",
  "Scrapy",
  "VelenPublicWebCrawler",
  "TurnitinBot",
  // Commercial SEO / data resellers — no user-facing value to us
  "DataForSeoBot",
  "SemrushBot",
  "AhrefsBot",
  "MJ12bot",
  "DotBot",
  "Barkrowler",
  "BacklinksExtendedBot",
  "InsightBaseBot",
  "ShapBot",
  "PetalBot",
  "Amazonbot",
  "Amzn-SearchBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Search engines + ordinary clients: allow everything but ask for a polite gap.
      { userAgent: "*", allow: "/", crawlDelay: 5 },
      // AI scrapers and data resellers: declined.
      ...AI_CRAWLERS_DISALLOWED.map((ua) => ({
        userAgent: ua,
        disallow: "/",
      })),
    ],
    sitemap: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3030"}/sitemap.xml`,
  };
}
