import type { Metadata } from "next";
import { AboutPage } from "@/features/ledger/public/pages";

export const metadata: Metadata = { title: "Giới thiệu" };

export default function Page() {
  return <AboutPage />;
}
