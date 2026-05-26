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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} min-h-dvh antialiased`}>
      <body className="h-dvh flex flex-col overflow-hidden antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
