"use client";
import { Suspense } from "react";
import { PartnerCreate } from "@/components/workspace/partner-create";
export default function Page() {
  return (
    <Suspense>
      <PartnerCreate />
    </Suspense>
  );
}
