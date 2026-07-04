import appConfig from "../../app.json";
import packageJson from "../../package.json";

/**
 * Thin typed wrapper around app.json — the single, Expo-style source of
 * truth for app identity (name, description, author, icons, theme colors).
 * Everything that needs this info (layout.tsx metadata, manifest.ts,
 * robots.ts, sitemap.ts, the security.txt route, Header.tsx, Footer.tsx)
 * imports from here rather than app.json directly, so a rename/shape change
 * to app.json only has to be reconciled in one place.
 *
 * Version is the one exception — deliberately NOT duplicated into app.json.
 * package.json's version is already the convention every npm tool reads, so
 * app.json defers to it instead of risking the two drifting apart.
 */
export const APP_NAME = appConfig.name;
export const APP_SHORT_NAME = appConfig.shortName;
export const APP_VERSION = packageJson.version;
export const APP_TAGLINE = appConfig.tagline;
export const THEME_COLOR = appConfig.themeColor;
export const BACKGROUND_COLOR = appConfig.backgroundColor;
export const ICONS = appConfig.icons;
export const SCREENSHOTS = appConfig.screenshots;

export const SITE_URL = appConfig.url;
export const SITE_TITLE = appConfig.title;
export const SITE_DESCRIPTION = appConfig.description;
export const SITE_AUTHOR = appConfig.author.name;
export const SITE_AUTHOR_URL = appConfig.author.url;
export const SECURITY_CONTACT = appConfig.author.email;
export const SECURITY_EXPIRES_IN_DAYS = appConfig.security.expiresInDays;
// The project's first commit — a genuine "launch date" rather than a made-up one.
export const PUBLISHED_TIME = appConfig.publishedTime;
export const GA_MEASUREMENT_ID = appConfig.analytics.gaMeasurementId;
