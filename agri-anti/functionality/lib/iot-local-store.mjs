export const IOT_READING_STORAGE_KEY = "agri-traceability:iot-readings";
export function readStoredIotReadings() {
    if (typeof window === "undefined")
        return [];
    const raw = window.localStorage.getItem(IOT_READING_STORAGE_KEY);
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
export function saveStoredIotReading(reading) {
    const next = [reading, ...readStoredIotReadings()].slice(0, 20);
    window.localStorage.setItem(IOT_READING_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("iot-readings-updated"));
}
