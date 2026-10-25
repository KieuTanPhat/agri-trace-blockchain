import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const revision = "8b78ba5118715e1fa81769286724db79346abf52";
const source = `https://raw.githubusercontent.com/thanglequoc/vietnamese-provinces-database/${revision}/json/simplified_json_generated_data_vn_units.json`;
const sourceHash =
  "f624138116bde151c860cbd25a84cd6b9b38250e8a049ed371c55dee729ac286";
const targets = [
  "apps/mobile/src/locations/vietnam.json",
  "apps/api/src/common/locations/vietnam.json",
].map((path) => fileURLToPath(new URL(`../${path}`, import.meta.url)));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const compare = (a, b) =>
  a.name.localeCompare(b.name, "vi") || a.code.localeCompare(b.code);
if (process.argv.includes("--check")) {
  const files = await Promise.all(
    targets.map((path) => readFile(path, "utf8")),
  );
  assert.equal(files[0], files[1], "API/mobile location snapshots differ");
  const data = JSON.parse(files[0]);
  assert.equal(data.revision, revision);
  assert.equal(data.sourceSha256, sourceHash);
  assert.equal(data.sha256, hash(JSON.stringify(data.provinces)));
  assert.deepEqual(data.provinces, [...data.provinces].sort(compare));
  for (const province of data.provinces)
    assert.deepEqual(province.wards, [...province.wards].sort(compare));
  console.log("Location snapshot parity/hash/order passed.");
} else {
  const response = await fetch(source);
  assert.equal(response.status, 200);
  const raw = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(raw), sourceHash, "Pinned source changed");
  const provinces = JSON.parse(raw)
    .map((p) => ({
      code: p.Code,
      name: p.Name,
      label: p.FullName,
      wards: p.Wards.map((w) => {
        assert.equal(w.ProvinceCode, p.Code);
        return { code: w.Code, name: w.Name, label: w.FullName };
      }).sort(compare),
    }))
    .sort(compare);
  assert.equal(new Set(provinces.map((p) => p.code)).size, provinces.length);
  assert.equal(
    new Set(provinces.flatMap((p) => p.wards.map((w) => w.code))).size,
    provinces.reduce((n, p) => n + p.wards.length, 0),
  );
  const data =
    JSON.stringify({
      version: "v5.2.0",
      effectiveDate: "2026-09-20",
      retrievedDate: "2026-10-19",
      source,
      revision,
      sourceSha256: sourceHash,
      license: "MIT",
      sha256: hash(JSON.stringify(provinces)),
      provinces,
    }) + "\n";
  const licenseResponse = await fetch(
    `https://raw.githubusercontent.com/thanglequoc/vietnamese-provinces-database/${revision}/LICENSE`,
  );
  assert.equal(licenseResponse.status, 200);
  const license = await licenseResponse.text();
  for (const target of targets) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    await writeFile(
      fileURLToPath(new URL("./LICENSE-vietnam-data.txt", `file://${target}`)),
      license,
    );
  }
  console.log(
    `Generated ${provinces.length} provinces / ${provinces.reduce((n, p) => n + p.wards.length, 0)} wards for API/mobile.`,
  );
}
