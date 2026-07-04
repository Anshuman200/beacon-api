import type { MetadataRoute } from "next";
import { APP_NAME, APP_SHORT_NAME, APP_TAGLINE, SITE_DESCRIPTION, THEME_COLOR, BACKGROUND_COLOR, ICONS, SCREENSHOTS } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} — ${APP_TAGLINE}`,
    short_name: APP_SHORT_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: ICONS.icon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: ICONS.icon512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: ICONS.maskable512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: SCREENSHOTS.map((s) => ({
      src: s.src,
      sizes: "1280x800",
      type: "image/png",
      form_factor: "wide",
      label: s.label,
    })),
  };
}
