import { Suspense } from "react";
import ContestPageClient from "./client";

export default function ContestPage() {
  return (
    <Suspense>
      <ContestPageClient />
    </Suspense>
  );
}
