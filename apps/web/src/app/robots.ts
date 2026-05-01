import type { MetadataRoute } from "next";

// We're a free public CH register surfaced for journalists / researchers /
// curious citizens. Real search-engine crawlers (Google, Bing, DuckDuckGo,
// Brave) are welcome — getting indexed for "<company name> companies house"
// is the whole point. AI training crawlers, however, hit us hard for very
// little user-facing value, so we politely ask them not to.

const AI_CRAWLERS_DISALLOWED = [
  "GPTBot",                  // OpenAI training crawler
  "ChatGPT-User",            // OpenAI on-demand fetch
  "OAI-SearchBot",           // OpenAI search index
  "ClaudeBot",               // Anthropic training
  "Claude-Web",              // older Anthropic UA
  "anthropic-ai",            // Anthropic alt
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",         // opt-out of Bard/Gemini training (still allows Googlebot)
  "CCBot",                   // Common Crawl (used by many AI vendors)
  "Bytespider",              // ByteDance / TikTok
  "Amazonbot",
  "Applebot-Extended",       // opt-out of Apple Intelligence training
  "Diffbot",
  "FacebookBot",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
  "ImagesiftBot",
  "Omgili",
  "DataForSeoBot",
  "PetalBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Search engines + ordinary clients: allow everything but ask for a polite gap.
      { userAgent: "*", allow: "/", crawlDelay: 5 },
      // AI scrapers: politely declined.
      ...AI_CRAWLERS_DISALLOWED.map((ua) => ({
        userAgent: ua,
        disallow: "/",
      })),
    ],
    sitemap: "https://ch.borsoi.co.uk/sitemap.xml",
  };
}
