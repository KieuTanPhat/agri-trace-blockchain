import type { AuthService, ConsumerProfile, RegistrationInput } from "./types";

export type AuthState = {
  status: "signedOut" | "authenticating" | "authenticated";
  profile: ConsumerProfile | null;
  error: string;
};
/** Stage A: memory only, no credentials/PII saved to AsyncStorage or URLs. */
export class DemoSessionStore {
  private state: AuthState = { status: "signedOut", profile: null, error: "" };
  private generation = 0;
  private request: AbortController | undefined;
  private listeners = new Set<() => void>();
  constructor(private readonly service: AuthService | null) {}
  readonly available = () => this.service !== null;
  readonly snapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: AuthState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  async login(phone: string, password: string): Promise<boolean> {
    return this.authenticate((signal) =>
      this.service!.login({ phone, password }, signal),
    );
  }
  async register(input: RegistrationInput): Promise<boolean> {
    if (!this.service?.register) return false;
    return this.authenticate((signal) =>
      this.service!.register!(input, signal),
    );
  }
  private async authenticate(
    operation: (signal: AbortSignal) => Promise<ConsumerProfile>,
  ): Promise<boolean> {
    if (!this.service || this.state.status === "authenticating") return false;
    const generation = ++this.generation;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.publish({ status: "authenticating", profile: null, error: "" });
    try {
      const profile = await operation(request.signal);
      if (generation !== this.generation) return false;
      this.publish({ status: "authenticated", profile, error: "" });
      return true;
    } catch {
      if (generation === this.generation) {
        this.publish({
          status: "signedOut",
          profile: null,
          error:
            "Không đăng nhập được bản thử. Kiểm tra thông tin rồi thử lại.",
        });
      }
      return false;
    } finally {
      if (generation === this.generation) this.request = undefined;
    }
  }
  cancelLogin() {
    if (this.state.status !== "authenticating") return;
    ++this.generation;
    this.request?.abort();
    this.request = undefined;
    this.publish({ status: "signedOut", profile: null, error: "" });
  }
  async logout() {
    ++this.generation;
    this.request?.abort();
    this.request = undefined;
    this.publish({ status: "signedOut", profile: null, error: "" });
    await this.service?.logout();
  }
}
