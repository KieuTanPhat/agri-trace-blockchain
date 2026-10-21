"use client";
import { useParams } from "next/navigation";
import { SupportDetail } from "@/components/workspace/support";

export default function SupportRequestPage() {
  const params = useParams<{ id: string }>();
  return <SupportDetail id={params.id} />;
}
