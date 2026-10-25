"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { exitToHome } from "@/lib/exit-to-home";

// Onboarding links here mid-setup, so leaving puts back what setup changed.
export function LegalBackLink({ style, children }: { style: CSSProperties; children: ReactNode }) {
  const router = useRouter();
  return (
    <Link
      href="/"
      style={style}
      onClick={(e) => {
        e.preventDefault();
        void exitToHome(router, "/");
      }}
    >
      {children}
    </Link>
  );
}
