import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { SITE_URL, SITE_TITLE, SITE_DESCRIPTION, SITE_AUTHOR, SITE_AUTHOR_URL, PUBLISHED_TIME, THEME_COLOR, ICONS, APP_SHORT_NAME } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Required so relative OG/Twitter image paths below resolve to absolute
  // URLs — link-preview crawlers (iMessage, Slack, X, etc.) won't fetch a
  // relative path. Override with NEXT_PUBLIC_SITE_URL if a custom domain
  // replaces the default Amplify one.
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  authors: [{ name: SITE_AUTHOR, url: SITE_AUTHOR_URL }],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: ICONS.icon192, sizes: "192x192", type: "image/png" },
      { url: ICONS.icon512, sizes: "512x512", type: "image/png" },
    ],
    shortcut: ICONS.favicon,
    apple: ICONS.appleTouchIcon,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_SHORT_NAME,
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: APP_SHORT_NAME,
    images: [{ url: ICONS.ogImage, width: 1200, height: 630, alt: APP_SHORT_NAME }],
    // "article" (rather than "website") is what unlocks the author/publishedTime
    // OG fields below — it's what LinkedIn's Post Inspector was asking for.
    type: "article",
    authors: [SITE_AUTHOR],
    publishedTime: PUBLISHED_TIME,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [ICONS.ogImage],
  },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
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
