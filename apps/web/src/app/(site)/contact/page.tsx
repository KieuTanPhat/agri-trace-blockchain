import type { Metadata } from "next";
import { ContactPage } from "@/features/ledger/public/pages";

export const metadata: Metadata = { title: "Liên hệ" };

export default function Page() {
  return <ContactPage />;
}
