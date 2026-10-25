import test from "node:test";
import assert from "node:assert/strict";
import {
  createHistoryStore,
  HISTORY_KEY,
  type HistoryEntry,
  type HistoryStorage,
} from "../src/scan/history";

const entry = (index: number): HistoryEntry => ({
  token: `test_token_${String(index).padStart(20, "0")}`,
  productName: `Rau ${index}`,
  viewedAt: "2026-10-17T00:00:00.000Z",
});
function memory() {
  const values = new Map<string, string>();
  const storage: HistoryStorage = {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
  return { values, storage, store: createHistoryStore(storage) };
}

test("concurrent history writes retain the latest 50 unique tokens", async () => {
  const { store } = memory();
  await Promise.all(
    Array.from({ length: 55 }, (_, index) => store.add(entry(index))),
  );
  const items = await store.list();
  assert.equal(items.length, 50);
  assert.equal(items[0].token, entry(54).token);
  assert.equal(items.at(-1)?.token, entry(5).token);
  await store.add({ ...entry(20), productName: "Đã cập nhật" });
  assert.equal((await store.list())[0].productName, "Đã cập nhật");
  assert.equal(
    (await store.list()).filter((item) => item.token === entry(20).token)
      .length,
    1,
  );
});

test("history stores only its three public fields and can clear queued writes", async () => {
  const { values, store } = memory();
  await store.add({
    ...entry(1),
    privatePayload: "must-not-be-stored",
  } as HistoryEntry);
  assert.deepEqual(
    Object.keys(JSON.parse(values.get(HISTORY_KEY)!).items[0]).sort(),
    ["productName", "token", "viewedAt"],
  );
  const adding = store.add(entry(2));
  const clearing = store.clear();
  await Promise.all([adding, clearing]);
  assert.deepEqual(await store.list(), []);
});

test("corrupt or unavailable storage is visible, clear recovers corrupt history", async () => {
  const { values, store, storage } = memory();
  values.set(HISTORY_KEY, "{bad-json");
  await assert.rejects(store.list());
  await store.clear();
  await store.add(entry(1));
  assert.equal((await store.list()).length, 1);
  storage.setItem = async () => {
    throw new Error("Full storage");
  };
  await assert.rejects(store.add(entry(2)), /Full storage/);
  assert.equal((await store.list()).length, 1);
});
