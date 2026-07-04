import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Beacon API — Advanced Client, Sandboxed Testing & Scripting Suite",
    short_name: "Beacon API",
    description: "A client-only API testing, seeding, and security-analysis workbench with sandboxed scripting.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#040509",
    theme_color: "#040509",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
