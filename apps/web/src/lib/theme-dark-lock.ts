"use client";
import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { isRouteDarkLocked } from "./theme-dark-lock-core";

/** JS facet: a not-yet-tokenized ternary screen clamps its theme read to dark while this is true. */
export function useDarkLocked(): boolean {
  return isRouteDarkLocked(usePathname() ?? "/");
}

/**
 * CSS-facet SPA sync: keeps the `theme-dark-locked` html class in step with the client route.
 * useLayoutEffect fires after DOM commit but BEFORE paint, so nav into a locked route is flash-free.
 * Renders nothing. Composes with the pre-paint script (both idempotent, same source).
 */
export function DarkLockController(): null {
  const pathname = usePathname();
  useLayoutEffect(() => {
    document.documentElement.classList.toggle(
      "theme-dark-locked",
      isRouteDarkLocked(pathname ?? "/")
    );
  }, [pathname]);
  return null;
}
