import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createNewsImageClient,
  isNewsImage,
  newsImageSource,
} from "../src/api/news-image";

const id = "12345678-1234-4234-9234-123456789abc";
const image = {
  mimeType: "image/png" as const,
  dataBase64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWPgqLL/DwADEAHBRHIeYAAAAABJRU5ErkJggg==",
  width: 1,
  height: 1,
};
test("image guard only accepts bounded base64 raster content and honest dimensions", () => {
  assert.equal(isNewsImage(image), true);
  assert.equal(
    newsImageSource(image),
    `data:image/png;base64,${image.dataBase64}`,
  );
  for (const invalid of [
    null,
    { ...image, width: 0 },
    { ...image, width: 2049 },
    { ...image, width: 2048, height: 2048 },
    { ...image, height: 1.5 },
    { ...image, mimeType: "image/svg+xml" },
    { ...image, dataBase64: "https://evil.example/img" },
    { ...image, dataBase64: "A".repeat(524292) },
    {
      ...image,
      dataBase64: Buffer.from("<svg onload='bad'>attack</svg>").toString(
        "base64",
      ),
    },
    { ...image, dataBase64: image.dataBase64 + "!" },
  ])
    assert.equal(isNewsImage(invalid), false);
});
test("cover client only calls our API by article UUID, omitting credentials and rejecting redirects", async () => {
  let calls = 0;
  const client = createNewsImageClient(
    "https://api.example.test/api",
    async (input, init) => {
      calls++;
      assert.equal(
        input,
        `https://api.example.test/api/public/news/${id}/cover`,
      );
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      assert.deepEqual(init?.headers, { Accept: "application/json" });
      return Response.json({ success: true, data: image });
    },
  );
  await client.cover(id);
  assert.throws(() => client.cover("https://cdn.example/image.png"));
  assert.equal(calls, 1);
});
test("image failures cannot surface upstream URLs/secrets; malformed response is not rendered", async () => {
  for (const status of [404, 429, 502, 503]) {
    const client = createNewsImageClient(
      "https://api.example.test/api",
      async () =>
        Response.json(
          { success: false, error: { message: "secret-upstream-url" } },
          { status },
        ),
    );
    await assert.rejects(
      client.cover(id),
      (error: Error) => !error.message.includes("secret-upstream"),
    );
  }
  const malformed = createNewsImageClient(
    "https://api.example.test/api",
    async () =>
      Response.json({
        success: true,
        data: { ...image, mimeType: "text/html" },
      }),
  );
  await assert.rejects(malformed.cover(id), /chưa hợp lệ/);
});
test("leaving a screen cancels the image request; timeout is bounded", async () => {
  const fetcher: typeof fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new Error("aborted"));
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      );
    });
  const abort = new AbortController();
  const client = createNewsImageClient(
    "https://api.example.test/api",
    fetcher,
    10,
  );
  const pending = client.cover(id, abort.signal);
  abort.abort();
  await assert.rejects(pending);
  await assert.rejects(client.cover(id), /hết thời gian/);
});
test("real HTTP fixture returns raster JSON through the API envelope, not an external image request", async () => {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url!);
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ success: true, data: image }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const result = await createNewsImageClient(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,
    ).cover(id);
    assert.deepEqual(result, image);
    assert.deepEqual(paths, [`/api/public/news/${id}/cover`]);
  } finally {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});
