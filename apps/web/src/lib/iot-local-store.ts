import type { SensorReadingRequest } from "./types";
import { readSession } from "./api-client";

export const IOT_READING_STORAGE_KEY = "agri-traceability:iot-readings:v2";

export function currentIotStorageKey(): string | null {
  const user = readSession()?.user;
  return user
    ? `${IOT_READING_STORAGE_KEY}:${user.id}:${user.organizationId ?? "system"}`
    : null;
}

export type StoredIotReading = SensorReadingRequest & {
  readingId: string;
  acceptedAt: string;
  status: "accepted";
};

export function readStoredIotReadings(): StoredIotReading[] {
  if (typeof window === "undefined") return [];
  const key = currentIotStorageKey();
  if (!key) return [];
  const raw = window.localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredIotReading(reading: StoredIotReading) {
  const key = currentIotStorageKey();
  if (!key) return;
  const next = [reading, ...readStoredIotReadings()].slice(0, 20);
  window.localStorage.setItem(key, JSON.stringify(next));
  window.dispatchEvent(new Event("iot-readings-updated"));
}
