import { latestChangelogEntry } from "@/lib/changelog";

/**
 * Served at /version.json — a lightweight, SW-independent way to detect a new
 * deploy. Fetched with cache: "no-store" from the client and compared against
 * the build id baked into the currently-loaded page; this is the common
 * pattern most SPAs use for "new version available" banners, and it works
 * even in contexts where a service worker can't (Safari private browsing,
 * SW registration blocked, etc.) — a complement to sw.js-based detection, not
 * a replacement for it. Also carries the real recent commit history so the
 * update banner can show *what* changed, not just "an update exists."
 */
export async function GET() {
  return Response.json(
    {
      buildId: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
      builtAt: new Date().toISOString(),
      latestRelease: latestChangelogEntry(),
    },
    { headers: { "Cache-Control": "no-cache, no-store, must-revalidate" } }
  );
}
