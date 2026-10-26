export type CommandOwner = { id: string; organizationId?: string | null };
export type QueuedCommand = {
  key: string;
  path: string;
  body: object;
  label: string;
  detail: string;
  createdAt: string;
  state: "unknown" | "failed";
  error?: string;
  ownerId: string;
  organizationId: string | null;
};
type Storage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<unknown>;
};
type Input = Pick<QueuedCommand, "key" | "path" | "body" | "label" | "detail">;
export function commandIdentity(command: Pick<QueuedCommand, "path" | "body">) {
  const match = /^\/production-cycles\/([^/]+)\/(care|harvests)$/.exec(
    command.path,
  );
  if (!match) throw new Error("Lệnh không hỗ trợ đối soát trên ứng dụng.");
  return {
    operation: match[2] === "care" ? "RECORD_CARE" : "RECORD_HARVEST",
    payload: {
      [match[2] === "care" ? "id" : "cycleId"]: match[1],
      ...command.body,
    },
  };
}
export function commandRecovery(result: { status: string }) {
  return result.status === "COMMITTED"
    ? "committed"
    : result.status === "REJECTED"
      ? "failed"
      : "unknown";
}
/** Mutations serialize locally to avoid lost writes from concurrent screens. */
export function createCommandQueue(storage: Storage) {
  let tail: Promise<unknown> = Promise.resolve();
  const locked = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };
  const key = (owner: CommandOwner) => {
    if (!owner.id) throw new Error("Cần đăng nhập trước khi ghi lệnh.");
    return `staff.commandQueue.v2.${encodeURIComponent(owner.id)}.${encodeURIComponent(owner.organizationId ?? "none")}`;
  };
  const owns = (owner: CommandOwner, item: QueuedCommand) =>
    item.ownerId === owner.id &&
    item.organizationId === (owner.organizationId ?? null);
  const read = async (owner: CommandOwner): Promise<QueuedCommand[]> => {
    const raw = await storage.getItem(key(owner));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed))
      throw new Error(
        "Không đọc được hàng đợi; cần đối soát trước khi gửi thêm.",
      );
    return parsed.filter(
      (item): item is QueuedCommand =>
        !!item &&
        typeof item === "object" &&
        owns(owner, item) &&
        typeof item.key === "string",
    );
  };
  const write = (owner: CommandOwner, items: QueuedCommand[]) =>
    storage.setItem(key(owner), JSON.stringify(items));
  return {
    read,
    owns,
    enqueue: (owner: CommandOwner, input: Input) =>
      locked(async () => {
        const items = await read(owner);
        const existing = items.find(
          (i) => i.path === input.path && i.state === "unknown",
        );
        if (existing && existing.key !== input.key)
          throw new Error(
            "Có lệnh chưa rõ kết quả cho mùa vụ này. Mở Lệnh chờ gửi để đối soát trước.",
          );
        if (items.some((i) => i.key === input.key))
          throw new Error("Không thay đổi nội dung lệnh đã lưu.");
        await write(owner, [
          ...items,
          {
            ...input,
            createdAt: new Date().toISOString(),
            state: "unknown",
            ownerId: owner.id,
            organizationId: owner.organizationId ?? null,
          },
        ]);
      }),
    update: (
      owner: CommandOwner,
      id: string,
      patch: Pick<Partial<QueuedCommand>, "state" | "error">,
    ) =>
      locked(async () =>
        write(
          owner,
          (await read(owner)).map((i) =>
            i.key === id ? { ...i, ...patch } : i,
          ),
        ),
      ),
    remove: (owner: CommandOwner, id: string) =>
      locked(async () =>
        write(
          owner,
          (await read(owner)).filter((i) => i.key !== id),
        ),
      ),
  };
}
