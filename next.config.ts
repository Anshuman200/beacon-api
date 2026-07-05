import type { NextConfig } from "next";
import { execSync } from "node:child_process";

/**
 * A short, stable identifier for this build — the git commit it was built
 * from, or a timestamp when git isn't available (e.g. some deploy platforms
 * ship a source tarball with no .git directory). Baked into the service
 * worker's content (via NEXT_PUBLIC_BUILD_ID) so a new deploy produces
 * byte-different sw.js — that's what lets the browser detect an update.
 */
function resolveBuildId(): string {
  // Explicit override first — lets a deploy platform inject its own id
  // (e.g. a Vercel deployment id) without relying on a git checkout being present.
  if (process.env.BEACON_BUILD_ID) return process.env.BEACON_BUILD_ID;
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return Date.now().toString(36);
  }
}

/**
 * The real recent commit history, for the "What's new" section of the
 * update banner — captured here (build time, where a full git checkout is
 * guaranteed to exist) rather than hand-maintained, which always drifts out
 * of date, or read at request time, which would require `.git` to still be
 * present in the deployed runtime container (often stripped for image size).
 */
function resolveRecentCommits(count = 5): string[] {
  try {
    const raw = execSync(`git log -${count} --pretty=format:%s`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
    return raw
      .split("\n")
      .map((line) => line.trim().replace(/^(feat|fix|chore|docs|refactor|test|perf|style)(\([^)]*\))?:\s*/i, ""))
      .map((line) => (line ? line[0].toUpperCase() + line.slice(1) : line))
      .filter(Boolean);
  } catch {
    return [];
  }
}

const buildId = resolveBuildId();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
    NEXT_PUBLIC_BUILD_COMMITS: JSON.stringify(resolveRecentCommits()),
  },
  generateBuildId: async () => buildId,
};

export default nextConfig;
