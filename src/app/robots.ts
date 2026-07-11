import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Not content — the SSRF-guarded generic proxy and the OAuth redirect target,
// neither of which are meant to be indexed or read by anything.
const DISALLOW = ["/api/", "/oauth/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },

      // Mainstream search crawlers — explicit entries (rather than relying on
      // the "*" catch-all) so each is unambiguous about being welcome here.
      { userAgent: "Googlebot", allow: "/", disallow: DISALLOW },
      { userAgent: "Bingbot", allow: "/", disallow: DISALLOW },
      { userAgent: "Applebot", allow: "/", disallow: DISALLOW },

      // AI crawlers — both the "read this page for a live answer" bots and the
      // "train on this" bots. Beacon wants to be readable and understood
      // by AI tools, so these are allowed rather than the more common default
      // of blocking them; see /llms.txt and /ai.txt for the AI-facing summary.
      { userAgent: "GPTBot", allow: "/", disallow: DISALLOW }, // OpenAI — training
      { userAgent: "ChatGPT-User", allow: "/", disallow: DISALLOW }, // OpenAI — live browsing
      { userAgent: "ClaudeBot", allow: "/", disallow: DISALLOW }, // Anthropic — training
      { userAgent: "Claude-User", allow: "/", disallow: DISALLOW }, // Anthropic — live browsing
      { userAgent: "Claude-SearchBot", allow: "/", disallow: DISALLOW }, // Anthropic — search
      { userAgent: "Google-Extended", allow: "/", disallow: DISALLOW }, // Google — Gemini training
      { userAgent: "Applebot-Extended", allow: "/", disallow: DISALLOW }, // Apple — AI training
      { userAgent: "PerplexityBot", allow: "/", disallow: DISALLOW },
      { userAgent: "CCBot", allow: "/", disallow: DISALLOW }, // Common Crawl — widely reused as AI training data
      { userAgent: "Bytespider", allow: "/", disallow: DISALLOW },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
