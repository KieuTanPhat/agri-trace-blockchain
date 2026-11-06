import { Suspense } from "react";
import type { Metadata } from "next";
import { ProductsPage } from "@/features/ledger/public/catalog";

export const metadata: Metadata = { title: "Sản phẩm" };

export default function Page() {
  return (
    <Suspense>
      <ProductsPage />
    </Suspense>
  );
}
