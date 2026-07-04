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

const buildId = resolveBuildId();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
  generateBuildId: async () => buildId,
};

export default nextConfig;
