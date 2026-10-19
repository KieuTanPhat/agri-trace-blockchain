"use client";
import { useParams } from "next/navigation";
import { MemberForm } from "@/components/workspace/member-form";
export default function Page() {
  const params = useParams<{ id: string }>();
  return <MemberForm id={params.id} />;
}
