import type { SensorReadingRequest } from "./types";

export const IOT_READING_STORAGE_KEY = "agri-traceability:iot-readings:v3";

export type StoredIotReading = SensorReadingRequest & {
  readingId: string;
  acceptedAt: string;
  status: "accepted";
};

export function clearStoredIotReadings(scope: string): void {
  if (typeof window === "undefined" || scope === "null") return;
  try {
    window.localStorage.removeItem(`${IOT_READING_STORAGE_KEY}:${scope}`);
    window.dispatchEvent(new Event("iot-readings-updated"));
  } catch {
    // Cache removal must not prevent session invalidation.
  }
}

export function readStoredIotReadings(scope: string): StoredIotReading[] {
  if (typeof window === "undefined" || scope === "null") return [];
  // Legacy v2 readings have no owner and cannot be assigned to a logged-in user.
  try {
    const raw = window.localStorage.getItem(
      `${IOT_READING_STORAGE_KEY}:${scope}`,
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredIotReading(reading: StoredIotReading, scope: string) {
  if (typeof window === "undefined" || scope === "null") return;
  try {
    const next = [reading, ...readStoredIotReadings(scope)].slice(0, 20);
    window.localStorage.setItem(
      `${IOT_READING_STORAGE_KEY}:${scope}`,
      JSON.stringify(next),
    );
    window.dispatchEvent(new Event("iot-readings-updated"));
  } catch {
    // This cache is optional; an accepted API write must not become a failed command.
  }
}
