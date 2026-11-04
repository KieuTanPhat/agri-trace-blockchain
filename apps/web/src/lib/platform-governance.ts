import type { components } from "./generated/api";

type Schemas = components["schemas"];
export type PlatformCase = Schemas["PlatformCaseDto"];
export type PlatformCasePage = Schemas["PlatformCasePageDto"];
/** Saves text produced by the API (CSV export) without a server round trip. */
export function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Human-readable duration for queue ages (seconds in, Vietnamese out). */
