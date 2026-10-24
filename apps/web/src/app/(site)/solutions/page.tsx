import type { Metadata } from "next";
import { SolutionsPage } from "@/features/ledger/public/pages";

export const metadata: Metadata = { title: "Giải pháp" };

export default function Page() {
  return <SolutionsPage />;
}
