export interface ChangelogEntry {
  /** Human-readable release label — a date is enough since this project doesn't run semver. */
  version: string;
  highlights: string[];
}

/**
 * Maintained by hand, one entry per deploy that's worth telling testers
 * about — surfaced in the "Update Available" banner's "What's new" section
 * via /version.json. Newest first. Keep entries short: 3-5 punchy bullets,
 * not a full commit log.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "2026-07-05",
    highlights: [
      "Installable app (PWA) with offline app-shell support",
      "Automatic update detection — reload prompt when a new build ships",
      "OpenAPI/Swagger import now auto-discovers specs behind docs pages and resolves relative server URLs",
      "Security scans can now run fully automatically after every request, with an opt-in for advanced attack-probe checks",
    ],
  },
];
