export interface ChangelogEntry {
  /** Human-readable release label. */
  version: string;
  highlights: string[];
}

/**
 * Real commit history for this build — captured at build time (see
 * next.config.ts's resolveRecentCommits) and baked into
 * NEXT_PUBLIC_BUILD_COMMITS, rather than a hand-maintained list that's
 * accurate on day one and stale forever after. Surfaced in the "Update
 * Available" banner's "What's new" section via /version.json.
 */
export function latestChangelogEntry(): ChangelogEntry | null {
  let highlights: string[] = [];
  try {
    highlights = JSON.parse(process.env.NEXT_PUBLIC_BUILD_COMMITS || "[]");
  } catch {
    highlights = [];
  }
  if (highlights.length === 0) return null;
  return {
    version: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
    highlights,
  };
}
