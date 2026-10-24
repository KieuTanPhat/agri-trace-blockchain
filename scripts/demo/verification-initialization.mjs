import { readFile } from "node:fs/promises";

// Verification records what happened; this does not authorize or perform a reset.
export async function verificationInitialization(local, fresh = false) {
  if (fresh) {
    return {
      initialization: "fresh-cluster",
      newDatabasesCreated: 1,
      backup: null,
      limits: [
        "Disposable local data was discarded with owner authorization; no backup or restore was performed.",
      ],
    };
  }
  return {
    initialization: "replace-existing-data",
    newDatabasesCreated: 0,
    backup: JSON.parse(await readFile(new URL("backup.json", local), "utf8")),
    limits: [
      "Original full-data restore was not rehearsed on a second DB; backup schema and reference data were restored into this same DB.",
    ],
  };
}
