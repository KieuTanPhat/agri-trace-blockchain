import { canonicalize } from "json-canonicalize";

import { contractError } from "./errors";

export const KEY_TYPES = {
  event: "traceEvent",
  proof: "traceProof",
  batch: "traceBatch",
  batchEvent: "batchEvent"
} as const;

export function toLedgerBytes(value: unknown): Buffer {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw contractError("INVALID_INPUT", "Value cannot be canonicalized as JSON");
  }
  const serialized = canonicalize(value);
  if (serialized === undefined) {
    throw contractError("INVALID_INPUT", "Value cannot be canonicalized as JSON");
  }
  return Buffer.from(serialized, "utf8");
}

export function fromLedgerBytes<T>(value: Uint8Array, label: string): T {
  if (value.length === 0) {
    throw contractError("NOT_FOUND", `${label} does not exist`);
  }
  return JSON.parse(Buffer.from(value).toString("utf8")) as T;
}

export function timestampToIso(timestamp: { seconds: number | LongLike; nanos: number }): string {
  const seconds = typeof timestamp.seconds === "number"
    ? timestamp.seconds
    : Number(timestamp.seconds.toString());
  const milliseconds = seconds * 1000 + Math.floor(timestamp.nanos / 1_000_000);
  const date = new Date(milliseconds);
  if (!Number.isFinite(milliseconds) || Number.isNaN(date.valueOf())) {
    throw contractError("INVALID_INPUT", "Fabric transaction timestamp is invalid");
  }
  return date.toISOString();
}

interface LongLike {
  toString(): string;
}
