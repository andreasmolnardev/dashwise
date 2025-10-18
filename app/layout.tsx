//app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dashwise",
  description: "Your homelab's ultimate dashboard",
  icons: {
    icon: [
      { url: "/favicons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicons/android-chrome-192x192.png", sizes: "192x192", type: "image/png" }, // Android Chrome
      { url: "/favicons/android-chrome-512x512.png", sizes: "512x512", type: "image/png" }, // Android PWA
    ],
    apple: "/favicons/apple-touch-icon.png",
    shortcut: "/favicons/favicon.ico",
    other: [
      {
        rel: "mask-icon",
        url: "/favicons/safari-pinned-tab.svg",
        color: "#5bbad5", // Safari pinned tabs
      },
      {
        rel: "manifest",
        url: "/favicons/site.webmanifest", // Android + PWA
      },
    ],
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en">
      <head>
         <link rel="shortcut icon" href="/favicons/favicon.ico" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased h-dvh`}
      >
        
          {children}
      
      </body>
    </html>
  );
}
