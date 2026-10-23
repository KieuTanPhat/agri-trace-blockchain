import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { verificationInitialization } from "./verification-initialization.mjs";

test("replacement still requires a readable backup receipt", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "seed-receipt-"));
  t.after(async () => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("seed-receipt-"));
    await rm(dir, { recursive: true });
  });
  const local = pathToFileURL(`${dir}/`);
  await assert.rejects(verificationInitialization(local), { code: "ENOENT" });
  await writeFile(new URL("backup.json", local), "broken");
  await assert.rejects(verificationInitialization(local), SyntaxError);
  const backup = { path: "private.dump", sha256: "recorded-checksum" };
  await writeFile(new URL("backup.json", local), JSON.stringify(backup));
  const receipt = await verificationInitialization(local);
  assert.equal(receipt.initialization, "replace-existing-data");
  assert.equal(receipt.newDatabasesCreated, 0);
  assert.deepEqual(receipt.backup, backup);
});

test("explicit fresh verification reports no backup or restore", async () => {
  const receipt = await verificationInitialization(new URL("file:///absent/"), true);
  assert.equal(receipt.initialization, "fresh-cluster");
  assert.equal(receipt.newDatabasesCreated, 1);
  assert.equal(receipt.backup, null);
  assert.match(receipt.limits[0], /no backup or restore was performed/);
});
