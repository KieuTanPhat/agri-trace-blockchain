"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { LegacyScopePanel } from "@/components/legacy-scope-panel";

export default function LegacyScopePage() {
  const { user } = useAuth();
  const { manifestId } = useParams<{ manifestId: string }>();
  if (!user) return null;
  return (
    <LegacyScopePanel
      key={`${getAuthorizationScope(user)}:${manifestId}`}
      manifestId={manifestId}
    />
  );
}
