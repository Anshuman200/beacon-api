import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Beacon is a single-page, client-only app — there's genuinely only one
 * indexable URL. Kept as its own file (rather than skipped) because it's
 * also what /robots.ts points crawlers at.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
