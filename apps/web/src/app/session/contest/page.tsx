import { Suspense } from "react";
import dynamic from "next/dynamic";

const ContestPageClient = dynamic(() => import("./client"), {
  loading: () => null,
});

export default function ContestPage() {
  return (
    <Suspense>
      <ContestPageClient />
    </Suspense>
  );
}
