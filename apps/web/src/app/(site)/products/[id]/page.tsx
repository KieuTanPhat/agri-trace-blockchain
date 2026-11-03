import type { Metadata } from "next";
import { ProductDetail } from "@/features/ledger/public/catalog";

export const metadata: Metadata = { title: "Chi tiết sản phẩm" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProductDetail id={(await params).id} />;
}
