import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createWeatherClient, isWeather } from "../src/api/weather";
import { provinces } from "../src/locations";
import {
  weatherLabel,
  weatherMetric,
  weatherTime,
} from "../src/weather/presentation";
const weather = () => ({
  provinceCode: "01",
  provinceName: "Thành phố Hà Nội",
  timezone: "Asia/Ho_Chi_Minh",
  provider: "Open-Meteo",
  attributionUrl: "https://open-meteo.com/",
  fetchedAt: "2026-10-19T05:00:00.000Z",
  expiresAt: "2026-10-19T05:10:00.000Z",
  point: { name: "Hà Nội", latitude: 21.0245, longitude: 105.84117 },
  current: {
    time: "2026-10-19T05:00:00.000Z",
    temperatureC: 27,
    humidityPercent: 80,
    windKmh: 6,
    weatherCode: 3,
  },
  daily: [19, 20, 21].map((day) => ({
    date: `2026-10-${day}`,
    minimumC: 24,
    maximumC: 30,
    precipitationProbabilityPercent: 50,
    weatherCode: 61,
  })),
});
test("validates bounded weather, explicit units, Vietnam dates and nullable readings", () => {
  assert.ok(isWeather(weather()));
  assert.ok(
    isWeather({
      ...weather(),
      current: { ...weather().current, temperatureC: null },
    }),
  );
  assert.equal(isWeather({ ...weather(), timezone: "UTC" }), false);
  assert.equal(
    isWeather({
      ...weather(),
      current: { ...weather().current, humidityPercent: 200 },
    }),
    false,
  );
  assert.equal(isWeather({ ...weather(), daily: [] }), false);
  assert.equal(
    isWeather({
      ...weather(),
      daily: weather().daily.map((day) => ({ ...day, date: "2026-99-99" })),
    }),
    false,
  );
  assert.equal(
    isWeather({ ...weather(), attributionUrl: "https://evil.invalid" }),
    false,
  );
});
test("all province codes have sourced representative points, including unambiguous Ninh Binh", async () => {
  const data = JSON.parse(
    await readFile(
      new URL(
        "../../api/src/common/locations/weather-points.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(
    data.points.map((p: { provinceCode: string }) => p.provinceCode).sort(),
    provinces.map((p) => p.code).sort(),
  );
  for (const p of data.points) {
    assert.ok(p.latitude >= 8 && p.latitude <= 24);
    assert.ok(p.longitude >= 102 && p.longitude <= 110);
    assert.ok(p.sourceUrl.startsWith("https://www.geonames.org/"));
  }
  assert.equal(
    data.points.find((p: { provinceCode: string }) => p.provinceCode === "37")
      .sourceAdmin1,
    "Ninh Binh",
  );
});
test("only calls the configured public proxy, never GPS or upstream APIs", async () => {
  const client = createWeatherClient(
    "https://api.example/api",
    async (url, options) => {
      assert.equal(url, "https://api.example/api/public/weather?province=01");
      assert.equal(options?.method, "GET");
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.redirect, "error");
      assert.deepEqual(options?.headers, { Accept: "application/json" });
      return new Response(JSON.stringify({ success: true, data: weather() }));
    },
  );
  assert.equal((await client.get("01")).provinceCode, "01");
  assert.throws(() => client.get("http://internal"));
});
test("rejects a late mismatched province response and safely explains disabled service", async () => {
  const wrong = createWeatherClient(
    "https://api.example/api",
    async () =>
      new Response(JSON.stringify({ success: true, data: weather() })),
  );
  await assert.rejects(wrong.get("31"), /chưa hợp lệ/);
  const disabled = createWeatherClient(
    "https://api.example/api",
    async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { message: "PRIVATE-KEY-AND-URL" },
        }),
        { status: 503 },
      ),
  );
  await assert.rejects(
    disabled.get("01"),
    (error: Error) =>
      error.message.includes("chưa được cấu hình") &&
      !error.message.includes("PRIVATE"),
  );
});
test("labels missing/unknown weather honestly and does not confuse zero with no data", () => {
  assert.equal(weatherLabel(null), "Chưa có dữ liệu");
  assert.equal(weatherLabel(0), "Trời quang");
  assert.equal(weatherLabel(99), "Dông kèm mưa đá");
  assert.equal(weatherLabel(4), "Chưa rõ trạng thái");
  assert.equal(weatherMetric(0, "°C"), "0 °C");
  assert.equal(weatherMetric(null, "%"), "Chưa có dữ liệu");
  assert.ok(weatherTime("2026-10-19T05:00:00.000Z").includes("12:00"));
});
