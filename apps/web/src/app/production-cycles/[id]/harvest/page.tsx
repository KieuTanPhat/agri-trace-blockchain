"use client";
import { useParams } from "next/navigation";
import { CycleDetail } from "@/components/workspace/production";
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <CycleDetail id={id} view="harvest" />;
}
