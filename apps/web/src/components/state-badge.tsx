import { labelForState } from "@/lib/display-labels";

const stateTone: Record<string, string> = {
  CREATED: "neutral",
  PLANTED: "info",
  GROWING: "info",
  COMPLETED: "success",
  HARVESTED: "success",
  IN_TRANSPORT: "info",
  ARRIVED: "info",
  RETAIL_RECEIVED: "success",
  FOR_SALE: "success",
  CANCELLED: "danger",
  DAMAGED: "danger",
  REJECTED: "danger",
  RECALLED: "danger",
  EXPIRED: "danger",
  SOLD: "neutral",
  VERIFIED: "success",
  PENDING: "warning",
  INTEGRITY_WARNING: "danger",
  BLOCKCHAIN_UNAVAILABLE: "warning",
  verified: "success",
  pending: "warning",
  mismatch: "danger",
  unavailable: "neutral"
};

export function StateBadge({ state }: { state: string }) {
  return <span className={`badge ${stateTone[state] ?? "neutral"}`}>{labelForState(state)}</span>;
}
