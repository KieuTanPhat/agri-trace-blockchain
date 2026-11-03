import type { Metadata } from "next";
import { NewsPage } from "@/features/ledger/public/news";

export const metadata: Metadata = { title: "Bảng tin" };

export default function Page() {
  return <NewsPage />;
}
