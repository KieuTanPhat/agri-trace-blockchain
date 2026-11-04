import type { Metadata } from "next";
import { NewsDetail } from "@/features/ledger/public/news";

export const metadata: Metadata = { title: "Bảng tin" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <NewsDetail id={(await params).id} />;
}
