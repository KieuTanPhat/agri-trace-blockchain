import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { datasetContext } from "./dataset-context.mjs";
import { seedContentId } from "./seed-recovery.mjs";
const context = datasetContext();
const base = context.base;
// The API image has no sharp: production reads covers pre-rendered by the
// dataset bundle (news-<photo>.jpg) with the same resize settings.
const cover = context.production
  ? (photo) => readFile(`${context.assets}/news-${photo}.jpg`)
  : async (photo) =>
      (await import("sharp")).default(`${context.assets}/${photo}.jpg`)
        .resize({ width: 1000, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
const account = JSON.parse(
  await readFile(`${context.run}/accounts.json`, "utf8"),
).users.find((u) => u.role === "SYSTEM_ADMIN");
let bearer;
async function call(path, body, key) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(bearer
        ? { Authorization: `Bearer ${bearer}` }
        : { "Content-Type": "application/json" }),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await response.json();
  if (!response.ok)
    throw new Error(`News API ${path}: HTTP ${response.status}`);
  return j.data ?? j;
}
bearer = (
  await call("/auth/login", {
    email: account.email,
    password: account.password,
  })
).accessToken;
const rows = (await call("/platform-admin/news")).items;
const photos = ["care", "warehouse1", "harvest", "lot", "warehouse3", "water"];
let count = 0;
for (const [i, row] of rows.entries()) {
  if (row.hasCover) continue;
  const bytes = await cover(photos[i % photos.length]);
  const sha = createHash("sha256").update(bytes).digest("hex");
  await call(
    "/platform-admin/news/" + row.id,
    {
      title: row.title,
      summary: row.summary,
      body: row.body,
      version: row.version,
      coverMimeType: "image/jpeg",
      coverBase64: bytes.toString("base64"),
    },
    seedContentId("fruit-news-cover", row.id + sha + row.version),
  );
  count++;
}
console.log(`Đã thêm ${count} ảnh bìa qua API quản lý bản tin.`);
