import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { verifyExport, wslPath } from "./export-check.mts";

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), "agri-trace-export-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, "export"), org3 = path.join(root, "org3");
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  for (const identity of ["agritrace/relayer", "agritrace/controller", "agritrace/admin", "org2-admin"]) {
    write(path.join(out, identity, "signcerts", "cert.pem"), `cert ${identity}`);
    write(path.join(out, identity, "keystore", "key_sk"), `key ${identity}`);
  }
  for (const name of ["org1-peer-ca.crt", "org2-peer-ca.crt", "org3-peer-ca.crt", "orderer-ca.crt"])
    write(path.join(out, "tls", name), name);
  write(path.join(org3, "users", "Admin@org3.example.com", "msp", "keystore", "priv_sk"), "org3 private key");
  return { out, org3, write };
}

test("a complete export without Org3 private material passes", (t) => {
  const { out, org3 } = fixture(t);
  assert.match(verifyExport(out, org3), /match the reviewed layout/);
});

test("a missing or unreadable export fails instead of passing", (t) => {
  const { out, org3 } = fixture(t);
  assert.throws(() => verifyExport(path.join(out, "absent"), org3), /ENOENT/);
  rmSync(path.join(out, "tls", "orderer-ca.crt"));
  assert.throws(() => verifyExport(out, org3), /incomplete/);
});

test("an export missing an allowed identity's key fails", (t) => {
  const { out, org3 } = fixture(t);
  rmSync(path.join(out, "agritrace", "relayer", "keystore", "key_sk"));
  assert.throws(() => verifyExport(out, org3), /lacks agritrace\/relayer\/keystore/);
});

test("Org3 private key bytes or paths in the export fail without printing them", (t) => {
  const { out, org3, write } = fixture(t);
  write(path.join(out, "agritrace", "admin", "keystore", "copied_sk"), "org3 private key");
  assert.throws(() => verifyExport(out, org3), (error: Error) =>
    /Org3 private key bytes/.test(error.message) && !error.message.includes("org3 private key"));
  rmSync(path.join(out, "agritrace", "admin", "keystore", "copied_sk"));
  write(path.join(out, "org3-admin", "keystore", "x"), "x");
  assert.throws(() => verifyExport(out, org3), /unreviewed entries|Org3 material/);
});

test("the comparison needs readable Org3 private material", (t) => {
  const { out } = fixture(t);
  assert.throws(() => verifyExport(out, path.join(out, "no-org3")), /ENOENT|could not be read/);
});

test("WSL data roots map to Linux paths and other roots are refused", () => {
  assert.equal(wslPath(String.raw`\\wsl$\Ubuntu\home\ci\agritrace-fabric\x`), "/home/ci/agritrace-fabric/x");
  assert.equal(wslPath(String.raw`\\wsl.localhost\Ubuntu\tmp\a`), "/tmp/a");
  assert.throws(() => wslPath(String.raw`C:\temp\a`), /not a WSL path/);
});
