import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://main.d35klirppq94rz.amplifyapp.com";
const SITE_TITLE = "Beacon API — Advanced Client, Sandboxed Testing & Scripting Suite";
const SITE_DESCRIPTION = "A beautiful tool to test and seed data through API endpoints with sandboxed scripting";

export const metadata: Metadata = {
  // Required so relative OG/Twitter image paths below resolve to absolute
  // URLs — link-preview crawlers (iMessage, Slack, X, etc.) won't fetch a
  // relative path. Override with NEXT_PUBLIC_SITE_URL if a custom domain
  // replaces the default Amplify one.
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/BeaconAPI.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Beacon API",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: "Beacon API",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Beacon API" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#040509",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} min-h-dvh antialiased`}>
      <head>
        {/* Blocking theme script — runs before paint to prevent flash */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            try {
              // Only "light" opts out — no value yet, or a stale "system" from
              // before that option was removed, both default to dark.
              var dark = localStorage.getItem('beacon-theme') !== 'light';
              if (dark) document.documentElement.classList.add('dark');
            } catch(e){}
          })();
        `}} />
      </head>
      <body className="h-dvh flex flex-col overflow-hidden antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
