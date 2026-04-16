import type { Metadata, Viewport } from "next";
import { DM_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import { NsfwProvider } from "@/lib/nsfw-context";
import { OfflineModeProvider } from "@/lib/offline/offline-mode-context";
import { OfflineIndicator } from "@/components/offline-indicator";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

const instrumentSerif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument-serif",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07080c",
};

export const metadata: Metadata = {
  title: "Tachyon",
  description: "A private reading sanctuary",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Tachyon",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${dmSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <PwaRegister />
        <OfflineModeProvider>
          <OfflineIndicator />
          <NsfwProvider>
            {children}
          </NsfwProvider>
        </OfflineModeProvider>
      </body>
    </html>
  );
}
