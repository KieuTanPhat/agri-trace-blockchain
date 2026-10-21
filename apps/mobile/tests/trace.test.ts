import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createTraceClient,
  isPublicLot,
  TraceApiError,
} from "../src/api/trace";
import { traceWarnings } from "../src/trace/presentation";
import { TOKEN, publicLot } from "./fixtures";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("validates the public projection and refuses unsupported or malformed data", () => {
  assert.equal(isPublicLot(publicLot()), true);
  for (const patch of [
    { currentState: "UNKNOWN" },
    { allowedCommands: ["WRITE"] },
    { sensorEvidence: null },
    { timeline: [{}] },
    { initialQuantity: "100" },
    { certificates: [{}] },
  ])
    assert.equal(isPublicLot({ ...publicLot(), ...patch }), false);
});

test("only GETs public trace; never sends credentials or follows redirects", async () => {
  let calls = 0;
  const client = createTraceClient(
    "https://api.example/api",
    async (url, init) => {
      calls++;
      assert.equal(url, `https://api.example/api/public/trace/${TOKEN}`);
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.redirect, "error");
      assert.deepEqual(init?.headers, { Accept: "application/json" });
      return json({ success: true, data: publicLot() });
    },
  );
  assert.equal((await client(TOKEN)).traceToken, TOKEN);
  await assert.rejects(client("invalid"));
  assert.equal(calls, 1);
});

test("404, throttling, malformed body and network failures have safe Vietnamese errors", async () => {
  for (const status of [404, 429, 500]) {
    const client = createTraceClient("https://api.example/api", async () =>
      json({ error: "private SQL details", requestId: "request-test" }, status),
    );
    await assert.rejects(
      client(TOKEN),
      (error: unknown) =>
        error instanceof TraceApiError &&
        error.status === status &&
        error.requestId === "request-test" &&
        !error.message.includes("SQL"),
    );
  }
  await assert.rejects(
    createTraceClient("https://api.example/api", async () =>
      json({
        success: true,
        data: publicLot({ traceToken: "different_token_000000000" }),
      }),
    )(TOKEN),
    /chưa hợp lệ/,
  );
  await assert.rejects(
    createTraceClient(
      "https://api.example/api",
      async () => new Response("not json"),
    )(TOKEN),
    /chưa hợp lệ/,
  );
  await assert.rejects(
    createTraceClient("https://api.example/api", async () => {
      throw new Error("raw socket details");
    })(TOKEN),
    /Không kết nối/,
  );
});

test("leaving the screen aborts a request and timeout cancels hanging fetch", async () => {
  const hanging: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      const abort = () => reject(new Error("aborted"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  const controller = new AbortController();
  const request = createTraceClient("https://api.example/api", hanging)(
    TOKEN,
    controller.signal,
  );
  controller.abort();
  await assert.rejects(request, /aborted/);
  await assert.rejects(
    createTraceClient("https://api.example/api", hanging, 10)(TOKEN),
    /hết thời gian/,
  );
});

test("recall, expiry, integrity and no-data warnings persist even when proof says VERIFIED", () => {
  const warnings = traceWarnings(
    publicLot({
      currentState: "RECALLED",
      isExpired: true,
      proofStatus: "VERIFIED",
      quantityReconciled: false,
    }),
  );
  assert.match(warnings[0], /thu hồi/);
  assert.match(warnings[1], /hết hạn/);
  assert.ok(warnings.some((warning) => warning.includes("đối soát")));
  assert.ok(
    warnings.some((warning) => warning.includes("Không có dữ liệu cảm biến")),
  );
});

test("real HTTP transport consumes the API envelope on an isolated local server", async () => {
  const server = createServer((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.url, `/api/public/trace/${TOKEN}`);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        success: true,
        data: publicLot(),
        timestamp: new Date().toISOString(),
        requestId: "http-test",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const result = await createTraceClient(`http://127.0.0.1:${port}/api`)(
      TOKEN,
    );
    assert.equal(result.productName, "Rau cải thử nghiệm");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
