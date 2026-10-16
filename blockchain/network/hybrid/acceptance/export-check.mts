/** AC-13 export check, kept free of ledger side effects so it can be unit tested. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Linux path of a file under the WSL data root seen from Windows (UNC). */
export function wslPath(hostPath: string): string {
  const match = /^\\\\wsl(?:\.localhost|\$)\\[^\\]+(\\.+)$/i.exec(hostPath);
  if (!match) throw new Error("FABRIC_ROOT is not a WSL path; set it to the \\\\wsl$ data root");
  return match[1]!.replace(/\\/g, "/");
}

const EXPORT_LAYOUT = new Set([
  "agritrace", "agritrace/relayer", "agritrace/relayer/signcerts", "agritrace/relayer/keystore",
  "agritrace/controller", "agritrace/controller/signcerts", "agritrace/controller/keystore",
  "agritrace/admin", "agritrace/admin/signcerts", "agritrace/admin/keystore",
  "org2-admin", "org2-admin/signcerts", "org2-admin/keystore",
  "tls", "tls/org1-peer-ca.crt", "tls/org2-peer-ca.crt", "tls/org3-peer-ca.crt", "tls/orderer-ca.crt",
]);

/** Exactly the reviewed identities, complete, and no byte of Org3 private material. */
export function verifyExport(exportDir: string, org3Dir: string): string {
  const entries = readdirSync(exportDir, { recursive: true }).map((f) => String(f).replace(/\\/g, "/"));
  const structural = entries.filter((f) => !/\/(signcerts|keystore)\/[^/]+$/.test(f));
  const missing = [...EXPORT_LAYOUT].filter((f) => !entries.includes(f));
  const unexpected = structural.filter((f) => !EXPORT_LAYOUT.has(f));
  if (missing.length) throw new Error(`export is incomplete: ${missing.join(",")}`);
  if (unexpected.length) throw new Error(`export has unreviewed entries: ${unexpected.join(",")}`);
  for (const identity of ["agritrace/relayer", "agritrace/controller", "agritrace/admin", "org2-admin"])
    for (const part of ["signcerts", "keystore"])
      if (!entries.some((f) => f.startsWith(`${identity}/${part}/`))) throw new Error(`export lacks ${identity}/${part}`);
  if (entries.some((f) => /org3/i.test(f) && f !== "tls/org3-peer-ca.crt")) throw new Error("Org3 material found in export");
  const files = (root: string) => readdirSync(root, { recursive: true }).map((f) => path.join(root, String(f)))
    .filter((f) => statSync(f).isFile());
  const org3Private = files(org3Dir).filter((f) => /[\\/]keystore[\\/]/.test(f)).map((f) => readFileSync(f));
  if (!org3Private.length) throw new Error("Org3 private material could not be read for comparison");
  const exported = files(exportDir);
  if (exported.some((f) => { const bytes = readFileSync(f); return org3Private.some((k) => k.equals(bytes)); }))
    throw new Error("Org3 private key bytes found in export");
  return `${exported.length} exported files match the reviewed layout; none carry Org3 private keys`;
}
