import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { prepareDeviceCredential } from "./device-credentials";

it("creates independent 256-bit credentials with the server verifier encoding and no secret in command body", async () => {
  const first = await prepareDeviceCredential(7);
  const second = await prepareDeviceCredential(7);
  const [id, secret] = first.token.split(".");
  expect(id).toBe(first.input.credentialId);
  expect(Buffer.from(secret, "base64url")).toHaveLength(32);
  expect(first.input.verifier).toBe(
    createHash("sha256").update(secret, "utf8").digest("hex"),
  );
  expect(first.input.version).toBe(7);
  expect(JSON.stringify(first.input)).not.toContain(secret);
  expect(first.token).not.toBe(second.token);
  expect(
    new Date(first.input.expiresAt).getTime() - Date.now(),
  ).toBeGreaterThan(118 * 60000);
});
