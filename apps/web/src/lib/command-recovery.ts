import type { components } from "./generated/api";
import { commandRequest, type CommandRequest } from "./command-request";

type Status = components["schemas"]["CommandRequestStatusDto"];
export type SavedCommand = {
  path: string;
  method: string;
  body: string;
  key: string;
};
type Entry = Omit<SavedCommand, "body"> & {
  fingerprint: string;
  status: "PENDING" | "COMMITTED" | "REJECTED";
  body?: string;
  validationRejection?: boolean;
};
type Ledger = { version: 1; owner: string; entries: Record<string, Entry> };
type Context = { owner: string; assertCurrent(): void };
type Transport = {
  send(command: SavedCommand): Promise<unknown>;
  inspect(command: SavedCommand, descriptor: CommandRequest): Promise<Status>;
};
export const COMMAND_STORAGE_PREFIX = "agritrace-command:v1:";
const storageError = {
  status: 409,
  code: "RECOVERY_STORAGE",
  message:
    "Không lưu hoặc đọc được yêu cầu đang chờ. Chưa gửi yêu cầu mới; kiểm tra trình duyệt trước khi thử lại.",
};

function read(context: Context): Ledger {
  context.assertCurrent();
  try {
    const raw = window.localStorage.getItem(
      COMMAND_STORAGE_PREFIX + context.owner,
    );
    if (!raw) return { version: 1, owner: context.owner, entries: {} };
    if (raw.length > 1024 * 1024) throw storageError;
    const ledger = JSON.parse(raw) as Ledger;
    if (
      ledger.version !== 1 ||
      ledger.owner !== context.owner ||
      !ledger.entries ||
      typeof ledger.entries !== "object" ||
      Array.isArray(ledger.entries) ||
      Object.keys(ledger.entries).length > 128
    )
      throw storageError;
    for (const entry of Object.values(ledger.entries)) {
      if (
        !entry ||
        typeof entry.path !== "string" ||
        !["POST", "PATCH"].includes(entry.method) ||
        typeof entry.key !== "string" ||
        !entry.key.trim() ||
        entry.key.length > 255 ||
        !/^[a-f0-9]{64}$/.test(entry.fingerprint) ||
        !["PENDING", "COMMITTED", "REJECTED"].includes(entry.status) ||
        (entry.status === "PENDING" &&
          (typeof entry.body !== "string" || entry.body.length > 65536))
      )
        throw storageError;
    }
    return ledger;
  } catch {
    throw storageError;
  }
}
function write(context: Context, ledger: Ledger) {
  context.assertCurrent();
  try {
    const raw = JSON.stringify(ledger);
    if (raw.length > 1024 * 1024) throw storageError;
    window.localStorage.setItem(COMMAND_STORAGE_PREFIX + context.owner, raw);
    if (
      window.localStorage.getItem(COMMAND_STORAGE_PREFIX + context.owner) !==
      raw
    )
      throw storageError;
  } catch {
    throw storageError;
  }
}
async function locked<T>(context: Context, work: () => Promise<T>): Promise<T> {
  if (!window.navigator.locks)
    throw {
      status: 409,
      code: "RECOVERY_LOCKS",
      message:
        "Trình duyệt chưa hỗ trợ lưu yêu cầu an toàn giữa các tab. Cập nhật trình duyệt trước khi gửi.",
    };
  return window.navigator.locks.request(
    COMMAND_STORAGE_PREFIX + context.owner,
    async () => {
      context.assertCurrent();
      return work();
    },
  );
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, ordered(item)]),
    );
  return value;
}
async function fingerprint(command: SavedCommand) {
  const encoded = JSON.stringify([
    command.path,
    command.method,
    ordered(JSON.parse(command.body)),
  ]);
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(encoded),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function hasSecret(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, item]) =>
      /^(password|passwordHash|accessToken|refreshToken|privateKey|apiKey|secret|credentials)$/i.test(
        key,
      ) || hasSecret(item),
  );
}
function slot(command: SavedCommand, descriptor: CommandRequest) {
  return JSON.stringify([
    command.method,
    command.path,
    descriptor.discriminator,
  ]);
}
function pendingError(
  id: string,
  message = "Yêu cầu trước chưa rõ kết quả. Kiểm tra yêu cầu đó trước khi gửi nội dung mới.",
) {
  return { status: 409, code: "REQUEST_UNRESOLVED", recoveryId: id, message };
}
function rejection(status: Status) {
  const result = status.result as { message?: unknown } | null | undefined;
  return {
    status: status.responseStatus ?? 409,
    code: "REQUEST_REJECTED",
    canRestart: true,
    message:
      typeof result?.message === "string"
        ? result.message
        : "Yêu cầu trước đã bị từ chối. Có thể chuẩn bị yêu cầu mới.",
  };
}
function terminal(
  context: Context,
  ledger: Ledger,
  id: string,
  entry: Entry,
  status: "COMMITTED" | "REJECTED",
) {
  // No response cache or private payload remains once the outcome is known.
  ledger.entries[id] = {
    path: entry.path, method: entry.method, key: entry.key,
    fingerprint: entry.fingerprint, status,
  };
  write(context, ledger);
}
async function inspect(
  context: Context,
  transport: Transport,
  ledger: Ledger,
  id: string,
  entry: Entry,
  command: SavedCommand,
): Promise<Status> {
  if ((await fingerprint(command)) !== entry.fingerprint) throw storageError;
  const descriptor = commandRequest(command.path, command.method, command.body);
  if (
    !descriptor ||
    slot(command, descriptor) !== id ||
    hasSecret(descriptor.payload)
  )
    throw storageError;
  const status = await transport.inspect(command, descriptor);
  context.assertCurrent();
  if (
    !status ||
    ![
      "NOT_FOUND",
      "PROCESSING",
      "COMMITTED",
      "REJECTED",
      "RECONCILIATION_REQUIRED",
    ].includes(status.status) ||
    (status.status === "COMMITTED" &&
      (!("result" in status) ||
        !status.responseStatus ||
        status.responseStatus >= 400))
  )
    throw pendingError(id);
  if (status.status === "COMMITTED" || status.status === "REJECTED")
    terminal(context, ledger, id, entry, status.status);
  if (status.status === "NOT_FOUND" && entry.validationRejection) {
    terminal(context, ledger, id, entry, "REJECTED");
    return { status: "REJECTED" };
  }
  return status;
}
async function send(
  context: Context,
  transport: Transport,
  ledger: Ledger,
  id: string,
  entry: Entry,
  command: SavedCommand,
) {
  context.assertCurrent();
  try {
    const result = await transport.send(command);
    context.assertCurrent();
    terminal(context, ledger, id, entry, "COMMITTED");
    return result;
  } catch (error) {
    context.assertCurrent();
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      [400, 422].includes(Number(error.status))
    ) {
      entry.validationRejection = true;
      ledger.entries[id] = entry;
      write(context, ledger);
    }
    throw {
      ...(error && typeof error === "object" ? error : {}),
      recoveryId: id,
      message:
        error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "Chưa đọc được kết quả yêu cầu. Kiểm tra lại trước khi gửi.",
    };
  }
}

export async function recoverableCommand(
  context: Context,
  command: SavedCommand,
  transport: Transport,
) {
  const descriptor = commandRequest(command.path, command.method, command.body);
  if (!descriptor) return transport.send(command);
  if (
    !command.key.trim() ||
    command.key.length > 255 ||
    command.body.length > 65536 ||
    hasSecret(descriptor.payload)
  )
    throw storageError;
  return locked(context, async () => {
    const ledger = read(context),
      id = slot(command, descriptor),
      hash = await fingerprint(command);
    context.assertCurrent();
    const old = ledger.entries[id];
    if (old?.status === "PENDING") {
      const saved: SavedCommand = {
        path: old.path,
        method: old.method,
        key: old.key,
        body: old.body!,
      };
      const status = await inspect(context, transport, ledger, id, old, saved);
      if (status.status === "COMMITTED") {
        if (hash !== old.fingerprint)
          throw {
            status: 409,
            code: "PREVIOUS_COMMITTED",
            message:
              "Yêu cầu trước đã được ghi nhận. Tải lại kết quả trước khi gửi nội dung mới.",
          };
        return status.result;
      }
      if (status.status === "REJECTED") throw rejection(status);
      if (status.status !== "NOT_FOUND" || hash !== old.fingerprint)
        throw pendingError(id);
      return send(context, transport, ledger, id, old, saved);
    }
    if (old?.status === "COMMITTED" && hash === old.fingerprint) {
      const status = await inspect(context, transport, ledger, id, old, {
        ...command,
        key: old.key,
      });
      if (status.status === "COMMITTED") return status.result;
      throw pendingError(id);
    }
    if (old?.status === "REJECTED" && old.key === command.key)
      throw rejection({ status: "REJECTED" });
    // Keep uncertain entries; prune only terminal metadata at the bounded limit.
    if (!old && Object.keys(ledger.entries).length >= 128) {
      const removable = Object.keys(ledger.entries).find(
        (key) => ledger.entries[key].status !== "PENDING",
      );
      if (!removable) throw storageError;
      delete ledger.entries[removable];
    }
    const entry: Entry = { ...command, fingerprint: hash, status: "PENDING" };
    ledger.entries[id] = entry;
    write(context, ledger); // Before any domain write.
    return send(context, transport, ledger, id, entry, command);
  });
}

/** Explicit recovery action reads current server authority and uses only the
 * saved original body/key. NOT_FOUND is retried; uncertain PROCESSING is held. */
export function retrySavedCommand(
  context: Context,
  id: string,
  transport: Transport,
) {
  return locked(context, async () => {
    const ledger = read(context),
      entry = ledger.entries[id];
    if (!entry || entry.status !== "PENDING" || !entry.body)
      throw {
        status: 409,
        code: "RECOVERY_REFRESH",
        message: "Yêu cầu đã được đối soát ở tab khác. Tải lại kết quả.",
      };
    const command: SavedCommand = {
      path: entry.path,
      method: entry.method,
      key: entry.key,
      body: entry.body,
    };
    const status = await inspect(
      context,
      transport,
      ledger,
      id,
      entry,
      command,
    );
    if (status.status === "COMMITTED") return status.result;
    if (status.status === "REJECTED") throw rejection(status);
    if (status.status === "NOT_FOUND")
      return send(context, transport, ledger, id, entry, command);
    throw pendingError(
      id,
      "Yêu cầu vẫn cần đối soát. Chưa gửi lại hoặc tạo yêu cầu thay thế.",
    );
  });
}
