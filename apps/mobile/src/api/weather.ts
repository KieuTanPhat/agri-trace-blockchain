import type { components } from "./generated/api";
import { createPublicReader, DirectoryApiError } from "./directory";
import { provinces } from "../locations";
export type PublicWeather = components["schemas"]["PublicWeatherDto"];
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const dateTime = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 35 &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const metric = (value: unknown, min: number, max: number) =>
  value === null ||
  (typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max);
export function isWeather(value: unknown): value is PublicWeather {
  if (
    !record(value) ||
    typeof value.provinceCode !== "string" ||
    !provinces.some((p) => p.code === value.provinceCode) ||
    typeof value.provinceName !== "string" ||
    value.timezone !== "Asia/Ho_Chi_Minh" ||
    value.provider !== "Open-Meteo" ||
    value.attributionUrl !== "https://open-meteo.com/" ||
    !dateTime(value.fetchedAt) ||
    !dateTime(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.fetchedAt) ||
    !record(value.point) ||
    typeof value.point.name !== "string" ||
    !metric(value.point.latitude, 8, 24) ||
    value.point.latitude === null ||
    !metric(value.point.longitude, 102, 110) ||
    value.point.longitude === null ||
    !record(value.current) ||
    !dateTime(value.current.time) ||
    !metric(value.current.temperatureC, -90, 70) ||
    !metric(value.current.humidityPercent, 0, 100) ||
    !metric(value.current.windKmh, 0, 500) ||
    !metric(value.current.weatherCode, 0, 99) ||
    !Array.isArray(value.daily) ||
    value.daily.length !== 3
  )
    return false;
  const days = value.daily;
  const first = new Date(Date.parse(value.fetchedAt as string) + 25200000)
    .toISOString()
    .slice(0, 10);
  return days.every(
    (day, index) =>
      record(day) &&
      typeof day.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
      day.date ===
        new Date(Date.parse(`${first}T00:00:00Z`) + index * 86400000)
          .toISOString()
          .slice(0, 10) &&
      metric(day.minimumC, -90, 70) &&
      metric(day.maximumC, -90, 70) &&
      (day.minimumC === null ||
        day.maximumC === null ||
        Number(day.minimumC) <= Number(day.maximumC)) &&
      metric(day.precipitationProbabilityPercent, 0, 100) &&
      metric(day.weatherCode, 0, 99),
  );
}
export function createWeatherClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
) {
  const read = createPublicReader(baseUrl, fetcher, 12000, "thời tiết");
  return {
    get: (province: string, signal?: AbortSignal) => {
      if (!provinces.some((p) => p.code === province))
        throw new DirectoryApiError("Chọn tỉnh/thành hợp lệ.");
      return read(
        "weather",
        { province },
        (value): value is PublicWeather =>
          isWeather(value) && value.provinceCode === province,
        signal,
      ).catch((error) => {
        if (error instanceof DirectoryApiError && error.status === 503)
          throw new DirectoryApiError(
            "Thời tiết tạm chưa sẵn sàng hoặc chưa được cấu hình.",
            503,
            error.requestId,
          );
        throw error;
      });
    },
  };
}
