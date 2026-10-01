import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AccessThemeProvider } from "@/components/AccessThemeProvider";
import { buildThemeBridgeBody } from "@/lib/theme-bridge-core";
import "./globals.css";
// KaTeX stylesheet — imported through JS so Next/webpack rewrites its
// url(fonts/KaTeX_*.woff2) references and emits the fonts into the static
// export (_next/static/media), letting the offline exam shell render math.
import "katex/dist/katex.min.css";
import { buildInitBody } from "@/lib/theme-core";
import { DARK_LOCKED_ROUTES, buildDarkLockBody } from "@/lib/theme-dark-lock-core";
import { DarkLockController } from "@/lib/theme-dark-lock";
import { STORAGE_KEYS } from "@/constants/storage-keys";

export const metadata: Metadata = {
  title: "Access · AMS",
  description: "Secure exam shell",
};

const THEME_INIT_SCRIPT = `(function(){${buildInitBody(STORAGE_KEYS.THEME)}${buildDarkLockBody(DARK_LOCKED_ROUTES)}${buildThemeBridgeBody()}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <DarkLockController />
        <AccessThemeProvider>{children}</AccessThemeProvider>
      </body>
    </html>
  );
}
