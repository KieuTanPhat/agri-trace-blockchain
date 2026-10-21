import type { ConsumerProfile } from "./types";

/** The persisted credential shape. Never add access tokens, profile, password or OTP. */
export type RefreshCredential = {
  sessionId: string;
  refreshToken: string;
  refreshExpiresAt: string;
  state: "active" | "logoutPending";
};
export type NativeSession = Omit<RefreshCredential, "state"> & {
  accessToken: string;
};
export interface CredentialStorage {
  /** Native production storage persists a non-secret intent synchronously,
   * before rendering a logout can crash the process. */
  markLogoutIntent?(): void;
  read(): Promise<RefreshCredential | null>;
  write(credential: RefreshCredential): Promise<void>;
  clear(): Promise<void>;
}
/** Stage B supplies native endpoints, never browser cookie endpoints. */
export interface NativeSessionApi {
  refresh(token: string): Promise<NativeSession>;
  me(accessToken: string): Promise<ConsumerProfile>;
  revoke(token: string): Promise<void>;
}
export class SessionFailure extends Error {
  constructor(
    readonly kind: "offline" | "uncertain" | "rejected",
    readonly status?: number,
  ) {
    super("Không thể xác nhận phiên đăng nhập.");
  }
}
export type NativeAuthState = {
  status:
    | "restoring"
    | "signedOut"
    | "authenticating"
    | "authenticated"
    | "temporarilyUnavailable"
    | "logoutPending";
  profile: ConsumerProfile | null;
  message: string;
};
const pendingMessage =
  "Đã thoát trên thiết bị; đang chờ thu hồi phiên máy chủ.";

export function isRefreshCredential(
  value: unknown,
): value is RefreshCredential {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 4 &&
    typeof v.sessionId === "string" &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(v.sessionId) &&
    typeof v.refreshToken === "string" &&
    /^[a-zA-Z0-9._~-]{1,1024}$/.test(v.refreshToken) &&
    typeof v.refreshExpiresAt === "string" &&
    Number.isFinite(Date.parse(v.refreshExpiresAt)) &&
    new Date(v.refreshExpiresAt).toISOString() === v.refreshExpiresAt &&
    (v.state === "active" || v.state === "logoutPending")
  );
}

/** One coordinator per process. All storage/network mutations use one queue.
 * API adapter MUST impose bounded timeouts; unknown outcomes are not retried.
 * The native runtime uses this store; the profile-only demo stays separate.
 */
export class NativeSessionStore {
  private state: NativeAuthState = {
    status: "restoring",
    profile: null,
    message: "",
  };
  private accessToken: string | null = null;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private flight?: Promise<boolean>;
  private initialized = false;
  private listeners = new Set<() => void>();
  constructor(
    private readonly storage: CredentialStorage,
    private readonly api: NativeSessionApi,
    private readonly now = Date.now,
  ) {}
  readonly snapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(
    status: NativeAuthState["status"],
    message = "",
    profile: ConsumerProfile | null = null,
  ) {
    if (status !== "authenticated") this.accessToken = null;
    this.state = { status, message, profile };
    for (const listener of this.listeners) listener();
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private credential(session: NativeSession): RefreshCredential {
    const record: RefreshCredential = {
      sessionId: session.sessionId,
      refreshToken: session.refreshToken,
      refreshExpiresAt: session.refreshExpiresAt,
      state: "active",
    };
    if (
      !isRefreshCredential(record) ||
      Date.parse(record.refreshExpiresAt) <= this.now() ||
      typeof session.accessToken !== "string" ||
      !session.accessToken ||
      session.accessToken.length > 16384
    ) {
      throw new SessionFailure("uncertain");
    }
    return record;
  }
  /** Keep a durable tombstone BEFORE attempting server revocation. */
  private async retire(record: RefreshCredential): Promise<boolean> {
    await this.storage.write({ ...record, state: "logoutPending" });
    try {
      await this.api.revoke(record.refreshToken);
    } catch {
      return false;
    }
    await this.storage.clear();
    return true;
  }
  private async accept(
    session: NativeSession,
    generation: number,
  ): Promise<boolean> {
    const record = this.credential(session);
    try {
      await this.storage.write(record);
    } catch {
      // Even if persistence failed, try to revoke the newly issued family.
      try {
        await this.api.revoke(record.refreshToken);
      } catch {
        /* unknown; do not expose credentials */
      }
      throw new SessionFailure("uncertain");
    }
    if (generation !== this.generation) {
      await this.storage.write({ ...record, state: "logoutPending" });
      return false;
    }
    const profile = await this.api.me(session.accessToken);
    if (generation !== this.generation) {
      await this.storage.write({ ...record, state: "logoutPending" });
      return false;
    }
    this.accessToken = session.accessToken;
    this.publish("authenticated", "", profile);
    return true;
  }
  /** Explicitly called by lifecycle/foreground, not by rendering public pages. */
  restore(): Promise<boolean> {
    if (this.flight) return this.flight;
    const generation = this.generation;
    if (this.state.status === "logoutPending") return Promise.resolve(false);
    this.publish("restoring");
    this.flight = this.serial(async () => {
      try {
        const record = await this.storage.read();
        this.initialized = true;
        if (generation !== this.generation) return false;
        if (!record) {
          this.publish("signedOut");
          return false;
        }
        if (record.state === "logoutPending") {
          this.publish("logoutPending", pendingMessage);
          return false;
        }
        if (Date.parse(record.refreshExpiresAt) <= this.now()) {
          await this.storage.clear();
          if (generation === this.generation) this.publish("signedOut");
          return false;
        }
        let session: NativeSession;
        try {
          session = await this.api.refresh(record.refreshToken);
        } catch (error) {
          if (!(error instanceof SessionFailure) || error.status !== 409)
            throw error;
          const winner = await this.storage.read();
          if (
            !winner ||
            winner.state !== "active" ||
            winner.sessionId !== record.sessionId ||
            winner.refreshToken === record.refreshToken
          )
            throw new SessionFailure("uncertain");
          // At most ONE recovery with an already persisted winner credential.
          session = await this.api.refresh(winner.refreshToken);
        }
        if (session.sessionId !== record.sessionId)
          throw new SessionFailure("uncertain");
        return await this.accept(session, generation);
      } catch (error) {
        if (generation !== this.generation) return false;
        if (error instanceof SessionFailure && error.kind === "offline") {
          this.publish(
            "temporarilyUnavailable",
            "Chưa kết nối được. Phiên chưa được xác nhận; vui lòng thử lại khi có mạng.",
          );
          return false;
        }
        try {
          const record = await this.storage.read();
          if (error instanceof SessionFailure && error.status === 401)
            await this.storage.clear();
          else if (record && !(await this.retire(record))) {
            if (generation === this.generation)
              this.publish("logoutPending", pendingMessage);
            return false;
          }
          if (generation === this.generation)
            this.publish(
              "signedOut",
              "Không xác nhận được phiên. Vui lòng đăng nhập lại.",
            );
        } catch {
          if (generation === this.generation)
            this.publish(
              "temporarilyUnavailable",
              "Không truy cập được kho bảo mật. Không thể mở tài khoản.",
            );
        }
        return false;
      }
    }).finally(() => {
      this.flight = undefined;
    });
    return this.flight;
  }
  /** Login/register callback uses previousRefreshToken when the native API supports it.
   * No automatic login/register retry after an uncertain response.
   */
  authenticate(
    operation: (previousRefreshToken?: string) => Promise<NativeSession>,
  ): Promise<boolean> {
    if (
      !this.initialized ||
      this.state.status === "authenticating" ||
      this.state.status === "restoring"
    )
      return Promise.resolve(false);
    const generation = ++this.generation;
    this.publish("authenticating");
    return this.serial(async () => {
      try {
        const previous = await this.storage.read();
        if (previous && !(await this.retire(previous))) {
          if (generation === this.generation)
            this.publish("logoutPending", pendingMessage);
          return false;
        }
        if (generation !== this.generation) return false;
        const session = await operation(previous?.refreshToken);
        const accepted = await this.accept(session, generation);
        if (!accepted) {
          const pending = await this.storage.read();
          if (pending) await this.retire(pending);
        }
        return accepted;
      } catch (error) {
        // Do not leave a newly issued session available for automatic restore.
        try {
          const pending = await this.storage.read();
          if (pending && !(await this.retire(pending))) {
            if (generation === this.generation)
              this.publish("logoutPending", pendingMessage);
            return false;
          }
        } catch {
          /* fail closed below; persistence may be unavailable */
        }
        if (generation === this.generation)
          this.publish(
            "temporarilyUnavailable",
            error instanceof SessionFailure && error.status === 401
              ? 'Thông tin đăng nhập hoặc xác minh không hợp lệ.'
              : error instanceof SessionFailure && error.status === 429
                ? 'Có quá nhiều yêu cầu. Vui lòng chờ rồi thử lại.'
                : error instanceof SessionFailure && error.status === 503
                  ? 'Tính năng tài khoản tạm chưa sẵn sàng.'
                  : 'Không thể xác nhận hoặc lưu phiên. Nếu vừa đăng ký, hãy thử đăng nhập; không tự gửi lại yêu cầu.',
          );
        return false;
      }
    });
  }
  /** Clear private UI immediately, even while an older refresh is still in flight. */
  logout(): Promise<boolean> {
    const generation = ++this.generation;
    let intentPersisted = false;
    try {
      if (this.storage.markLogoutIntent) {
        this.storage.markLogoutIntent();
        intentPersisted = true;
      }
    } catch {
      // Fall back to normal durable retirement; never claim the fast marker
      // succeeded when native storage rejected it.
    }
    this.publish("logoutPending", pendingMessage);
    return this.serial(async () => {
      try {
        const record = await this.storage.read();
        // If the fast native marker failed, the normal durable tombstone below
        // must succeed before this method can report a completed logout.
        const done = !record || (await this.retire(record));
        if (generation === this.generation)
          this.publish(
            done ? "signedOut" : "logoutPending",
            done ? "" : pendingMessage,
          );
        return done;
      } catch {
        if (generation === this.generation)
          this.publish(
            "logoutPending",
            intentPersisted
              ? "Chưa thu hồi xong phiên máy chủ. Đã chặn khôi phục phiên trên thiết bị; hãy thử đăng xuất lại."
              : "Không lưu được yêu cầu thu hồi vào kho bảo mật. Hãy thử đăng xuất lại; phiên máy chủ có thể còn hoạt động.",
          );
        return false;
      }
    });
  }
  /** GET only. No retries for 403 or commands; 401 refresh/retry at most once. */
  async privateGet<T>(
    request: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const generation = this.generation;
    if (!this.accessToken || this.state.status !== "authenticated")
      throw new SessionFailure("rejected", 401);
    const token = this.accessToken;
    let value: T;
    try {
      value = await request(token);
    } catch (error) {
      if (
        generation !== this.generation ||
        !(error instanceof SessionFailure) ||
        error.status !== 401
      )
        throw error;
      if (
        (this.flight || this.accessToken === token) &&
        !(await this.restore())
      )
        throw new SessionFailure("rejected", 401);
      if (generation !== this.generation || !this.accessToken)
        throw new SessionFailure("rejected", 401);
      value = await request(this.accessToken);
    }
    if (generation !== this.generation || this.state.status !== "authenticated")
      throw new SessionFailure("rejected", 401);
    return value;
  }
}
