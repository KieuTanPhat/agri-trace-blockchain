import test from "node:test";
import assert from "node:assert/strict";
import {
  createDirectoryClient,
  isDirectoryPage,
  isDirectoryProduct,
  isDirectoryEnterprise,
  isProductDetail,
  isEnterpriseDetail,
  mergeDirectoryItems,
  DirectoryApiError,
  type DirectoryProduct,
  type ProductDetail,
  type EnterpriseDetail,
} from "../src/api/directory";
import { mergeDirectoryDetail } from "../src/directory/pagination";

const id = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const product = (index = 1): DirectoryProduct => ({
  id: id(index),
  productName: `Rau ${index}`,
  variety: null,
  defaultUnit: "kg",
  description: null,
});
const enterprise = {
  id: id(100),
  name: "Nông trại test",
  type: "FARM" as const,
};
const empty = () => ({ items: [], hasMore: false, nextCursor: null });
const productDetail = (): ProductDetail => ({
  ...product(),
  enterprises: { items: [enterprise], hasMore: false, nextCursor: null },
  lots: empty(),
});
const enterpriseDetail = (): EnterpriseDetail => ({
  ...enterprise,
  products: { items: [product()], hasMore: false, nextCursor: null },
  certificates: empty(),
});
const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      success: status === 200,
      data,
      requestId: "directory-test",
      error: { message: "private SQL error" },
    }),
    { status },
  );

test("validates nullable fields, enterprise enum, nested pages and cursor protocol", () => {
  assert.equal(isDirectoryProduct(product()), true);
  assert.equal(isDirectoryEnterprise(enterprise), true);
  assert.equal(
    isDirectoryEnterprise({ ...enterprise, type: "SYSTEM_ADMIN" }),
    false,
  );
  assert.equal(
    isDirectoryProduct({ ...product(), productName: undefined }),
    false,
  );
  assert.equal(
    isDirectoryPage(
      { items: [product()], hasMore: true, nextCursor: id(1) },
      isDirectoryProduct,
    ),
    true,
  );
  assert.equal(
    isDirectoryPage(
      { items: [product()], hasMore: true, nextCursor: id(2) },
      isDirectoryProduct,
    ),
    false,
  );
  assert.equal(
    isDirectoryPage(
      { items: [product(), product()], hasMore: false, nextCursor: null },
      isDirectoryProduct,
    ),
    false,
  );
  assert.equal(
    isDirectoryPage(
      { items: [], hasMore: false, nextCursor: id(1) },
      isDirectoryProduct,
    ),
    false,
  );
  assert.equal(
    isDirectoryPage(
      {
        items: Array.from({ length: 51 }, (_, index) => product(index)),
        hasMore: false,
        nextCursor: null,
      },
      isDirectoryProduct,
    ),
    false,
  );
  assert.equal(isProductDetail(productDetail()), true);
  assert.equal(isEnterpriseDetail(enterpriseDetail()), true);
});

test("encodes search values and only sends network-only public GETs", async () => {
  const client = createDirectoryClient(
    "https://api.example/api",
    async (url, options) => {
      assert.equal(
        url,
        "https://api.example/api/public/products?q=rau%20%26%20c%E1%BA%A3i&limit=20",
      );
      assert.equal(options?.method, "GET");
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.cache, "no-store");
      assert.equal(options?.redirect, "error");
      assert.deepEqual(options?.headers, { Accept: "application/json" });
      return response({ items: [product()], hasMore: false, nextCursor: null });
    },
  );
  assert.equal(
    (await client.products({ q: "rau & cải", limit: 20 })).items[0].productName,
    "Rau 1",
  );
});

test("uses separate pagination cursors for each detail section", async () => {
  const urls: unknown[] = [];
  const client = createDirectoryClient(
    "https://api.example/api",
    async (url) => {
      urls.push(url);
      return response(
        String(url).includes("/products/")
          ? productDetail()
          : enterpriseDetail(),
      );
    },
  );
  await client.product(id(1), { lotCursor: id(20) });
  await client.enterprise(enterprise.id, { certificateCursor: id(21) });
  assert.equal(
    urls[0],
    `https://api.example/api/public/products/${id(1)}?lotCursor=${id(20)}`,
  );
  assert.equal(
    urls[1],
    `https://api.example/api/public/enterprises/${enterprise.id}?certificateCursor=${id(21)}`,
  );
});

test("rejects invalid identifiers and mismatched detail responses", async () => {
  let calls = 0;
  const client = createDirectoryClient("https://api.example/api", async () => {
    calls++;
    return response(productDetail());
  });
  assert.throws(() => client.product("../private"), /Định danh/);
  assert.equal(calls, 0);
  await assert.rejects(client.product(id(2)), /chưa hợp lệ/);
});

test("HTTP failures never surface private error details; malformed and offline responses are explicit", async () => {
  for (const status of [404, 429, 500]) {
    const client = createDirectoryClient("https://api.example/api", async () =>
      response(null, status),
    );
    await assert.rejects(
      client.products(),
      (error: unknown) =>
        error instanceof DirectoryApiError &&
        error.status === status &&
        error.requestId === "directory-test" &&
        !error.message.includes("SQL"),
    );
  }
  await assert.rejects(
    createDirectoryClient("https://api.example/api", async () =>
      response({ items: "bad" }),
    ).products(),
    /chưa hợp lệ/,
  );
  await assert.rejects(
    createDirectoryClient("https://api.example/api", async () => {
      throw new Error("socket info");
    }).products(),
    /Không kết nối/,
  );
});

test("cancels stale requests and times out unresponsive servers", async () => {
  const hanging: typeof fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      const cancel = () => reject(new Error("aborted"));
      if (options?.signal?.aborted) cancel();
      else options?.signal?.addEventListener("abort", cancel, { once: true });
    });
  const abort = new AbortController();
  const pending = createDirectoryClient(
    "https://api.example/api",
    hanging,
  ).products({}, abort.signal);
  abort.abort();
  await assert.rejects(pending, /aborted/);
  await assert.rejects(
    createDirectoryClient("https://api.example/api", hanging, 10).enterprises(),
    /hết thời gian/,
  );
});

test("merges pages without duplicate IDs and retains a different detail section", () => {
  assert.equal(
    mergeDirectoryItems([product(1)], [product(1), product(2)]).length,
    2,
  );
  const before = productDetail();
  const after = {
    ...productDetail(),
    lots: {
      items: [
        {
          id: id(3),
          lotCode: "LOT-TEST",
          traceToken: "test_trace_token_000000000",
        },
      ],
      hasMore: false,
      nextCursor: null,
    },
    enterprises: empty(),
  };
  const merged = mergeDirectoryDetail(before, after, "lots");
  assert.ok("productName" in merged);
  assert.deepEqual(merged.enterprises, before.enterprises);
  assert.equal(merged.lots.items.length, 1);
  assert.throws(
    () => mergeDirectoryDetail(before, { ...after, id: id(99) }, "lots"),
    /không khớp/,
  );
});

test("accumulated detail can exceed 50 items while each network page stays bounded", () => {
  const before = {
    ...enterpriseDetail(),
    products: {
      items: Array.from({ length: 50 }, (_, index) => product(index)),
      hasMore: true,
      nextCursor: id(49),
    },
  };
  const after = {
    ...enterpriseDetail(),
    products: { items: [product(50)], hasMore: false, nextCursor: null },
  };
  const merged = mergeDirectoryDetail(before, after, "products");
  assert.ok("name" in merged);
  assert.equal(merged.products.items.length, 51);
});
