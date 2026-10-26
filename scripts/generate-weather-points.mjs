import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const locations = JSON.parse(
  await readFile(
    new URL("apps/api/src/common/locations/vietnam.json", root),
    "utf8",
  ),
);
const names = {
  "01": "Hà Nội",
  "04": "Cao Bằng",
  "08": "Tuyên Quang",
  11: "Điện Biên Phủ",
  12: "Lai Châu",
  14: "Sơn La",
  15: "Lào Cai",
  19: "Thái Nguyên",
  20: "Lạng Sơn",
  22: "Hạ Long",
  24: "Bắc Ninh",
  25: "Việt Trì",
  31: "Hải Phòng",
  33: "Hưng Yên",
  37: "Ninh Bình",
  38: "Thanh Hóa",
  40: "Vinh",
  42: "Hà Tĩnh",
  44: "Đồng Hới",
  46: "Huế",
  48: "Đà Nẵng",
  51: "Quảng Ngãi",
  52: "Plây Cu",
  56: "Nha Trang",
  66: "Buôn Ma Thuột",
  68: "Đà Lạt",
  75: "Biên Hòa",
  79: "Hồ Chí Minh",
  80: "Tây Ninh",
  82: "Cao Lãnh",
  86: "Vĩnh Long",
  91: "Long Xuyên",
  92: "Cần Thơ",
  96: "Cà Mau",
};
const normalize = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đð]/gi, "d")
    .toLowerCase()
    .replace(/^thanh pho /, "")
    .trim();
const output = new URL(
  "apps/api/src/common/locations/weather-points.json",
  root,
);
if (process.argv.includes("--check")) {
  const data = JSON.parse(await readFile(output, "utf8"));
  assert.equal(data.locationRevision, locations.revision);
  assert.deepEqual(
    data.points.map((p) => p.provinceCode).sort(),
    locations.provinces.map((p) => p.code).sort(),
  );
  assert.equal(
    data.sha256,
    createHash("sha256").update(JSON.stringify(data.points)).digest("hex"),
  );
  for (const point of data.points) {
    const province = locations.provinces.find(
      (p) => p.code === point.provinceCode,
    );
    assert.equal(point.provinceName, province.label);
    const clean = (value) =>
      normalize(value)
        .replace(/^tinh /, "")
        .replaceAll(" ", "");
    assert.ok(
      clean(point.sourceAdmin1) === clean(province.name) ||
        (point.provinceCode === "46" &&
          clean(point.sourceAdmin1) === "thuathienhue"),
    );
    assert.ok(
      point.latitude >= 8 &&
        point.latitude <= 24 &&
        point.longitude >= 102 &&
        point.longitude <= 110,
    );
  }
  console.log("Weather point coverage/hash passed.");
} else {
  const previous = JSON.parse(
    await readFile(output, "utf8").catch(() => '{"points":[]}'),
  );
  const points = [];
  for (const province of locations.provinces) {
    const query = province.code === "37" ? "Tam Điệp" : names[province.code];
    assert.ok(query);
    const adminName = (value) =>
      normalize(value)
        .replace(/^tinh /, "")
        .replaceAll(" ", "");
    const sameAdmin = (value) =>
      adminName(value ?? "") === adminName(province.name) ||
      (province.code === "46" && adminName(value ?? "") === "thuathienhue");
    const cached = previous.points.find(
      (p) =>
        p.provinceCode === province.code &&
        new URL(p.queryUrl).searchParams.get("name") === normalize(query) &&
        sameAdmin(p.sourceAdmin1),
    );
    if (cached && !process.argv.includes("--refresh")) {
      points.push(cached);
      continue;
    }
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({
      name: normalize(query),
      countryCode: "VN",
      count: "100",
      language: "vi",
    });
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    const rank = (p) =>
      p.feature_code === "PPLC" ? 3 : p.feature_code === "PPLA" ? 2 : 1;
    const matches = (data.results ?? [])
      .filter(
        (p) =>
          p.country_code === "VN" &&
          normalize(p.name) === normalize(query) &&
          sameAdmin(p.admin1) &&
          ["PPL", "PPLA", "PPLC", "PPLA2"].includes(p.feature_code),
      )
      .sort(
        (a, b) =>
          rank(b) - rank(a) || (b.population ?? 0) - (a.population ?? 0),
      );
    assert.ok(
      matches.length,
      `No exact populated-place match for ${province.code} ${query}`,
    );
    const place = matches[0];
    assert.ok(
      place.latitude >= 8 &&
        place.latitude <= 24 &&
        place.longitude >= 102 &&
        place.longitude <= 110,
    );
    points.push({
      provinceCode: province.code,
      provinceName: province.label,
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      geonamesId: place.id,
      sourceAdmin1: place.admin1,
      sourceUrl: `https://www.geonames.org/${place.id}/`,
      queryUrl: url.href,
    });
    console.log(`${province.code}: ${place.name} (${place.admin1})`);
  }
  await writeFile(
    output,
    JSON.stringify({
      retrievedDate: "2026-10-19",
      locationRevision: locations.revision,
      source: "Open-Meteo Geocoding / GeoNames",
      disclaimer:
        "Named representative populated places, not province-wide measurements or official administrative seats. Administrative labels from GeoNames can be historical; review mapping before production.",
      sha256: createHash("sha256").update(JSON.stringify(points)).digest("hex"),
      points,
    }) + "\n",
  );
}
