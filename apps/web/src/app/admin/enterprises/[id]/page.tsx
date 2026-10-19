"use client";
import { useParams } from "next/navigation";
import PlatformEnrollment from "@/components/workspace/platform-enrollment";
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <PlatformEnrollment id={id} />;
}
