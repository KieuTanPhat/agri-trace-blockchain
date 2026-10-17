import type { components } from "./generated/api";

/** The secret stays with the caller in memory; only input may enter recovery storage. */
export async function prepareDeviceCredential(version: number): Promise<{
  token: string;
  input: components["schemas"]["IssueDeviceCredentialDto"];
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
  );
  const credentialId = crypto.randomUUID();
  return {
    token: `${credentialId}.${secret}`,
    input: {
      version,
      credentialId,
      verifier: Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(
        "",
      ),
      // Leave a small margin for client/server clock drift within the two-hour cap.
      expiresAt: new Date(Date.now() + 119 * 60000).toISOString(),
    },
  };
}
