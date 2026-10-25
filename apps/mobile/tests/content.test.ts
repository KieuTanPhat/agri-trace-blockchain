import test from "node:test";
import assert from "node:assert/strict";
import {
  createContentClient,
  isAnnouncement,
  isArticle,
  isContentPage,
  isNews,
} from "../src/api/content";
import {
  ANNOUNCEMENT_READ_KEY,
  createAnnouncementReadStore,
} from "../src/content/read-state";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const news = () => ({
  id: id(1),
  title: "Tin thử",
  summary: "Tóm tắt",
  coverUrl: null,
  publishedAt: "2026-10-19T00:00:00.000Z",
});
const announcement = () => ({
  id: id(2),
  title: "Thông báo thử",
  body: "Thông tin công khai",
  severity: "INFO",
  startsAt: "2026-10-19T00:00:00.000Z",
  endsAt: null,
});
const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      success: status === 200,
      data,
      error: { message: "PRIVATE-SQL-DETAIL" },
    }),
    { status },
  );
test("validates content shape, publication dates and bounded opaque pages", () => {
  assert.ok(isNews(news()));
  assert.ok(isArticle({ ...news(), body: "<script>literal text</script>" }));
  assert.ok(isAnnouncement(announcement()));
  assert.equal(isArticle({ ...news(), body: "" }), false);
  assert.equal(isNews({ ...news(), publishedAt: "bad" }), false);
  assert.equal(isNews({ ...news(), coverUrl: "javascript:alert(1)" }), false);
  assert.equal(isAnnouncement({ ...announcement(), severity: "ADMIN" }), false);
  assert.equal(
    isContentPage(
      { items: [news()], hasMore: true, nextCursor: "opaque_cursor" },
      isNews,
    ),
    true,
  );
  assert.equal(
    isContentPage({ items: [], hasMore: true, nextCursor: "abc" }, isNews),
    false,
  );
  assert.equal(
    isContentPage(
      { items: [news(), news()], hasMore: false, nextCursor: null },
      isNews,
    ),
    false,
  );
  assert.equal(
    isContentPage(
      {
        items: Array.from({ length: 51 }, news),
        hasMore: false,
        nextCursor: null,
      },
      isNews,
    ),
    false,
  );
});
test("content client only reads configured public routes without credentials or redirects", async () => {
  const client = createContentClient(
    "https://api.example/api",
    async (url, options) => {
      assert.equal(
        url,
        "https://api.example/api/public/news?q=rau%20%26%20c%E1%BA%A3i&limit=20",
      );
      assert.equal(options?.method, "GET");
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.redirect, "error");
      return response({ items: [news()], hasMore: false, nextCursor: null });
    },
  );
  assert.equal(
    (await client.news({ q: "rau & cải", limit: 20 })).items[0].title,
    "Tin thử",
  );
});
test("content rejects mismatched IDs, malformed payload and safe HTTP errors", async () => {
  const client = createContentClient("https://api.example/api", async () =>
    response({ ...news(), body: "test" }),
  );
  assert.throws(() => client.article("../private"));
  await assert.rejects(client.article(id(3)), /chưa hợp lệ/);
  for (const status of [404, 429, 500]) {
    const failing = createContentClient("https://api.example/api", async () =>
      response(null, status),
    );
    await assert.rejects(
      failing.news(),
      (error: Error) => !error.message.includes("PRIVATE-SQL-DETAIL"),
    );
  }
});
test("read state serializes concurrent updates, stores only IDs and retains at most 500", async () => {
  let raw: string | null = null;
  const storage = {
    getItem: async (key: string) => {
      assert.equal(key, ANNOUNCEMENT_READ_KEY);
      return raw;
    },
    setItem: async (key: string, value: string) => {
      assert.equal(key, ANNOUNCEMENT_READ_KEY);
      raw = value;
    },
    removeItem: async () => {
      raw = null;
    },
  };
  const store = createAnnouncementReadStore(storage);
  await Promise.all(Array.from({ length: 510 }, (_, n) => store.mark(id(n))));
  const ids = await store.load();
  assert.equal(ids.length, 500);
  assert.equal(ids[0], id(509));
  const data = JSON.parse(raw!);
  assert.deepEqual(Object.keys(data).sort(), ["ids", "version"]);
  assert.equal(
    data.ids.every((item: unknown) => typeof item === "string"),
    true,
  );
  await store.clear();
  assert.deepEqual(await store.load(), []);
});
test("corrupt/unavailable read storage reports failure and does not falsely mark a notice", async () => {
  let raw: string | null = "broken";
  const store = createAnnouncementReadStore({
    getItem: async () => raw,
    setItem: async (_, value) => {
      raw = value;
    },
    removeItem: async () => {
      raw = null;
    },
  });
  await assert.rejects(store.load());
  await assert.rejects(store.mark(id(1)));
  assert.equal(raw, "broken");
  await store.clear();
  await store.mark(id(1));
  assert.deepEqual(await store.load(), [id(1)]);
  const failed = createAnnouncementReadStore({
    getItem: async () => null,
    setItem: async () => {
      throw new Error("Disk full");
    },
    removeItem: async () => {},
  });
  await assert.rejects(failed.mark(id(1)));
});
