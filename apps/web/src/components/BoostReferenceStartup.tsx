"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const Offer = dynamic(
  () => import("./BoostReferenceOffer").then((module) => module.BoostReferenceOffer),
  { ssr: false }
);

/** Keep the optional downloader out of the initial and contest page bundles. */
export function BoostReferenceStartup() {
  const path = usePathname();
  return path === "/" || path === "/login" || path === "/home" ? <Offer /> : null;
}
