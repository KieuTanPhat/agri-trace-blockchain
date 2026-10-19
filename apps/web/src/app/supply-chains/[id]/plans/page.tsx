"use client";
import { useParams } from "next/navigation";
import ChainManagement from "@/components/workspace/chains";
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <ChainManagement view="plans" initialChainId={id} />;
}
