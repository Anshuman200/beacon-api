import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Beacon API — Advanced Client, Sandboxed Testing & Scripting Suite",
  description: "A beautiful tool to test and seed data through API endpoints with sandboxed scripting",
  icons: {
    icon: "/BeaconAPI.png",
    shortcut: "/BeaconAPI.png",
    apple: "/BeaconAPI.png",
  },
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
              var t = localStorage.getItem('beacon-theme') || 'system';
              var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
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
