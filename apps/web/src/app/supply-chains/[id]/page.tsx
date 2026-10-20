"use client";
import { useParams } from "next/navigation";
import ChainManagement from "@/components/workspace/chains";
export default function Page() {
  const params = useParams<{ id: string }>();
  return <ChainManagement view="detail" initialChainId={params.id} />;
}
