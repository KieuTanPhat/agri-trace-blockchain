"use client";
import { useParams } from "next/navigation";
import { MemberDetail } from "@/components/workspace/member-detail";
export default function Page() {
  const params = useParams<{ id: string }>();
  return <MemberDetail id={params.id} />;
}
