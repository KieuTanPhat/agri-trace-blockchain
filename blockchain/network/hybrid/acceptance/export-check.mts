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
  "tls", "tls/org1-peer-ca.crt", "tls/orderer-ca.crt",
]);

/** Exactly the reviewed identities, complete, and no byte of the protected CA/orderer private material. */
export function verifyExport(exportDir: string, protectedDir: string): string {
  const entries = readdirSync(exportDir, { recursive: true }).map((f) => String(f).replace(/\\/g, "/"));
  const structural = entries.filter((f) => !/\/(signcerts|keystore)\/[^/]+$/.test(f));
  const missing = [...EXPORT_LAYOUT].filter((f) => !entries.includes(f));
  const unexpected = structural.filter((f) => !EXPORT_LAYOUT.has(f));
  if (missing.length) throw new Error(`export is incomplete: ${missing.join(",")}`);
  if (unexpected.length) throw new Error(`export has unreviewed entries: ${unexpected.join(",")}`);
  for (const identity of ["agritrace/relayer", "agritrace/controller", "agritrace/admin"])
    for (const part of ["signcerts", "keystore"])
      if (!entries.some((f) => f.startsWith(`${identity}/${part}/`))) throw new Error(`export lacks ${identity}/${part}`);
  const files = (root: string) => readdirSync(root, { recursive: true }).map((f) => path.join(root, String(f)))
    .filter((f) => statSync(f).isFile());
  const protectedPrivate = files(protectedDir).filter((f) => /[\\/]keystore[\\/]/.test(f)).map((f) => readFileSync(f));
  if (!protectedPrivate.length) throw new Error("Protected private material could not be read for comparison");
  const exported = files(exportDir);
  if (exported.some((f) => { const bytes = readFileSync(f); return protectedPrivate.some((k) => k.equals(bytes)); }))
    throw new Error("protected owner private key bytes found in export");
  return `${exported.length} exported files match the reviewed layout; none carry CA/orderer private keys`;
}
