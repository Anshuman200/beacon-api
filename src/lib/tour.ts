import type { DriveStep } from "driver.js";

/**
 * Anchored via `data-tour="..."` attributes sprinkled on the real UI
 * (Header.tsx, RequestSidebar.tsx, SeederWorkspace.tsx) rather than fragile
 * class-name/text selectors, so styling changes don't silently break the tour.
 *
 * Titles carry an emoji rather than a separate icon component — driver.js
 * renders title/description as plain markup, so a leading emoji is the
 * cheapest way to make each step feel distinct instead of a wall of
 * identical-looking text boxes.
 */
export const TOUR_STEPS: DriveStep[] = [
  {
    popover: {
      title: "👋 Welcome to Beacon API",
      description: "Let's get you building in under a minute — a request, a run, and a security scan that happens without you lifting a finger.",
      nextBtnText: "Let's go →",
    },
  },
  {
    element: '[data-tour="sidebar"]',
    popover: {
      title: "📁 Collections",
      description: "Every request lives here, organized into folders. Flip to History to replay anything you've already run.",
      side: "right",
    },
  },
  {
    element: '[data-tour="new-collection"]',
    popover: {
      title: "➕ Start fresh",
      description: "Spin up a new collection to group related requests — or skip the typing entirely and import one (next up).",
      side: "bottom",
    },
  },
  {
    element: '[data-tour="method-url"]',
    popover: {
      title: "🌐 Any request, one bar",
      description: "Method + endpoint. Drop in {{base_url}} or any other variable and it'll resolve from whichever environment is active.",
      side: "bottom",
    },
  },
  {
    element: '[data-tour="request-tabs"]',
    popover: {
      title: "🛠️ Everything lives here",
      description: "Params, headers, auth, body, scripts, test assertions — and a Security tab that scans automatically the moment you hit Execute.",
      side: "top",
    },
  },
  {
    element: '[data-tour="execute-btn"]',
    popover: {
      title: "▶️ Fire away",
      description: "Sends the request through Beacon's SSRF-guarded proxy — any public API, zero CORS pain, ever.",
      side: "top",
    },
  },
  {
    element: '[data-tour="response-panel"]',
    popover: {
      title: "📬 The full picture",
      description: "Headers, body, test results, ready-to-paste code snippets in other languages, and a live console for your scripts.",
      side: "left",
    },
  },
  {
    element: '[data-tour="env-selector"]',
    popover: {
      title: "🌍 Dev, staging, prod",
      description: "Swap environments without touching a single request — that's the whole point of {{variables}}.",
      side: "bottom",
    },
  },
  {
    element: '[data-tour="import-btn"]',
    popover: {
      title: "📥 Skip the busywork",
      description: "Drop in a Postman export or an OpenAPI/Swagger spec — by file or URL — and every endpoint, auth rule, and variable carries over.",
      side: "bottom",
    },
  },
  {
    element: '[data-tour="theme-toggle"]',
    popover: {
      title: "🎨 Your call",
      description: "Light or dark. That's everything — you're ready to build. Hit Help anytime to run this again.",
      side: "bottom",
      nextBtnText: "🎉 Let's build",
    },
  },
];
