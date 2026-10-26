import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCommandQueue,
  commandIdentity,
  commandRecovery,
} from "../src/lib/command-queue.ts";
const A = { id: "user-a", organizationId: "org-a" },
  B = { id: "user-b", organizationId: "org-b" };
const command = {
  key: "original-key",
  path: "/production-cycles/cycle/harvests",
  body: { version: 2, quantity: 10 },
  label: "Thu hoạch",
  detail: "Lô riêng",
};
function fixture() {
  const data = new Map<string, string>();
  return {
    data,
    queue: createCommandQueue({
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        data.set(k, v);
      },
    }),
  };
}
test("account B cannot read, modify or delete A commands; A can recover after signing in again", async () => {
  const { queue } = fixture();
  await queue.enqueue(A, command);
  assert.equal((await queue.read(A)).length, 1);
  assert.deepEqual(await queue.read(B), []);
  await queue.remove(B, command.key);
  assert.equal((await queue.read(A))[0].key, command.key);
  await queue.update(B, command.key, { state: "failed" });
  assert.equal((await queue.read(A))[0].state, "unknown");
});
test("unowned legacy rows are never adopted by a new account", async () => {
  const { queue, data } = fixture();
  data.set("staff.commandQueue.v1", JSON.stringify([command]));
  assert.deepEqual(await queue.read(A), []);
  assert.deepEqual(await queue.read(B), []);
});
test("concurrent enqueues retain both original payloads and prevent unresolved duplicate paths", async () => {
  const { queue } = fixture();
  await Promise.all([
    queue.enqueue(A, command),
    queue.enqueue(A, {
      ...command,
      key: "second",
      path: "/production-cycles/other/care",
    }),
  ]);
  assert.equal((await queue.read(A)).length, 2);
  await assert.rejects(
    queue.enqueue(A, { ...command, key: "new-key" }),
    /đối soát/,
  );
  assert.deepEqual((await queue.read(A))[0].body, command.body);
});
test("queue cannot recover another account or organization", async () => {
  const { queue } = fixture();
  await queue.enqueue(A, command);
  const item = (await queue.read(A))[0];
  assert.equal(queue.owns(B, item), false);
  assert.equal(queue.owns({ ...A, organizationId: "other-org" }, item), false);
});
test("command inspection uses the original cycle id and operation", () => {
  assert.deepEqual(commandIdentity(command), {
    operation: "RECORD_HARVEST",
    payload: { cycleId: "cycle", ...command.body },
  });
  assert.equal(
    commandRecovery({ status: "COMMITTED", result: { lot: "one" } }),
    "committed",
  );
  for (const status of ["NOT_FOUND", "PROCESSING", "RECONCILIATION_REQUIRED"])
    assert.equal(commandRecovery({ status }), "unknown");
  assert.equal(commandRecovery({ status: "REJECTED" }), "failed");
});
test("care status uses the controller id normalization, not harvest cycleId", () => {
  assert.deepEqual(
    commandIdentity({ ...command, path: "/production-cycles/cycle/care" }),
    { operation: "RECORD_CARE", payload: { id: "cycle", ...command.body } },
  );
});
