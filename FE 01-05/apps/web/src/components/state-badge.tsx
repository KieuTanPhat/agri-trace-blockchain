import { labelForState } from "@/lib/display-labels";

const stateTone: Record<string, string> = {
  CREATED: "neutral",
  PLANTED: "info",
  HARVESTED: "success",
  IN_TRANSPORT: "info",
  RETAIL_RECEIVED: "success",
  FOR_SALE: "success",
  CANCELLED: "danger",
  DAMAGED: "danger",
  REJECTED: "danger",
  verified: "success",
  pending: "warning",
  mismatch: "danger",
  unavailable: "neutral"
};

export function StateBadge({ state }: { state: string }) {
  return <span className={`badge ${stateTone[state] ?? "neutral"}`}>{labelForState(state)}</span>;
}
