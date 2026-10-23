import type { components } from "../generated/api";
/** Preserve OpenAPI's bounded tuple without casting an unchecked form array. */
export function certificationsForApi(values: string[]): components["schemas"]["RegistrationProductionDetails"]["certifications"] {
  switch (values.length) {
    case 0: return [];
    case 1: return [values[0]!];
    case 2: return [values[0]!, values[1]!];
    case 3: return [values[0]!, values[1]!, values[2]!];
    case 4: return [values[0]!, values[1]!, values[2]!, values[3]!];
    default: throw new Error("Chọn tối đa bốn chứng nhận");
  }
}
/** Client-generated invitation capability stays in memory and the canonical join URL. */
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
export async function sha256Hex(value: string | Uint8Array<ArrayBuffer>) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
/** Baseline downloads verify the content against its recorded digest before displaying or saving it. */
export async function verifiedEvidenceBlob(file: { mediaType: string; contentBase64: string; sha256: string }) {
  const bytes = Uint8Array.from(atob(file.contentBase64), char => char.charCodeAt(0));
  if (await sha256Hex(bytes) !== file.sha256) throw new Error("File không khớp hash chứng cứ");
  return new Blob([bytes], { type: file.mediaType });
}
