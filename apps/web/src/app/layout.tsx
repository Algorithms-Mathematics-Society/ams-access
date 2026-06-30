import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
// KaTeX stylesheet — imported through JS so Next/webpack rewrites its
// url(fonts/KaTeX_*.woff2) references and emits the fonts into the static
// export (_next/static/media), letting the offline exam shell render math.
import "katex/dist/katex.min.css";
import { buildInitBody } from "@/lib/theme-core";
import { STORAGE_KEYS } from "@/constants/storage-keys";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Access · AMS",
  description: "Secure exam shell",
};

const THEME_INIT_SCRIPT = `(function(){${buildInitBody(STORAGE_KEYS.THEME)}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
