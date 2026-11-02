import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { verifyExport, wslPath } from "./export-check.mts";

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), "agri-trace-export-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, "export"), protectedOwner = path.join(root, "protectedOwner");
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  for (const identity of ["agritrace/relayer", "agritrace/controller", "agritrace/admin"]) {
    write(path.join(out, identity, "signcerts", "cert.pem"), `cert ${identity}`);
    write(path.join(out, identity, "keystore", "key_sk"), `key ${identity}`);
  }
  for (const name of ["org1-peer-ca.crt", "orderer-ca.crt"])
    write(path.join(out, "tls", name), name);
  write(path.join(protectedOwner, "users", "Admin@protectedOwner.example.com", "msp", "keystore", "priv_sk"), "protectedOwner private key");
  return { out, protectedOwner, write };
}

test("a complete export without protected owner private material passes", (t) => {
  const { out, protectedOwner } = fixture(t);
  assert.match(verifyExport(out, protectedOwner), /match the reviewed layout/);
});

test("a missing or unreadable export fails instead of passing", (t) => {
  const { out, protectedOwner } = fixture(t);
  assert.throws(() => verifyExport(path.join(out, "absent"), protectedOwner), /ENOENT/);
  rmSync(path.join(out, "tls", "orderer-ca.crt"));
  assert.throws(() => verifyExport(out, protectedOwner), /incomplete/);
});

test("an export missing an allowed identity's key fails", (t) => {
  const { out, protectedOwner } = fixture(t);
  rmSync(path.join(out, "agritrace", "relayer", "keystore", "key_sk"));
  assert.throws(() => verifyExport(out, protectedOwner), /lacks agritrace\/relayer\/keystore/);
});

test("protected owner private key bytes or paths in the export fail without printing them", (t) => {
  const { out, protectedOwner, write } = fixture(t);
  write(path.join(out, "agritrace", "admin", "keystore", "copied_sk"), "protectedOwner private key");
  assert.throws(() => verifyExport(out, protectedOwner), (error: Error) =>
    /protected owner private key bytes/.test(error.message) && !error.message.includes("protectedOwner private key"));
  rmSync(path.join(out, "agritrace", "admin", "keystore", "copied_sk"));
  write(path.join(out, "protectedOwner-admin", "keystore", "x"), "x");
  assert.throws(() => verifyExport(out, protectedOwner), /unreviewed entries|protected owner material/);
});

test("the comparison needs readable protected owner private material", (t) => {
  const { out } = fixture(t);
  assert.throws(() => verifyExport(out, path.join(out, "no-protectedOwner")), /ENOENT|could not be read/);
});

test("WSL data roots map to Linux paths and other roots are refused", () => {
  assert.equal(wslPath(String.raw`\\wsl$\Ubuntu\home\ci\agritrace-fabric\x`), "/home/ci/agritrace-fabric/x");
  assert.equal(wslPath(String.raw`\\wsl.localhost\Ubuntu\tmp\a`), "/tmp/a");
  assert.throws(() => wslPath(String.raw`C:\temp\a`), /not a WSL path/);
});
