import { apiBaseUrl } from "../config";
import { NativeSessionStore, type NativeAuthState } from "./native-session";
import { secureCredentialStorage } from "./secure-credential-storage";
import { createMobileAuthApi } from "./mobile-auth-api";
import type { AuthService, ConsumerProfile, RegistrationInput } from "./types";

export function createNativeRuntime() {
  const api = createMobileAuthApi(
    apiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, __DEV__),
  );
  const store = new NativeSessionStore(secureCredentialStorage, api);
  let state: NativeAuthState & { error: string } = {
    status: "restoring",
    profile: null,
    message: "",
    error: "",
  };
  const update = () => {
    const native = store.snapshot();
    state = { ...native, error: native.message };
  };
  store.subscribe(update);
  update();
  async function accept(
    operation: () => Promise<boolean>,
    signal: AbortSignal,
  ): Promise<ConsumerProfile> {
    const cancel = () => {
      if (store.snapshot().status === "authenticating") void store.logout();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      if (
        signal.aborted ||
        !(await operation()) ||
        signal.aborted ||
        !store.snapshot().profile
      )
        throw new Error("Không xác nhận được phiên. Vui lòng đăng nhập lại.");
      return store.snapshot().profile!;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
  const auth: AuthService = {
    login(input, signal) {
      return accept(
        () =>
          store.authenticate((previousRefreshToken) =>
            api.login({ ...input, previousRefreshToken }, signal),
          ),
        signal,
      );
    },
    register(input, signal) {
      return accept(
        () => store.authenticate(() => api.register(input, signal)),
        signal,
      );
    },
    async logout() {
      await store.logout();
    },
    async resetPassword(input, signal) {
      await api.reset(
        {
          phone: input.phone,
          newPassword: input.password,
          firebaseIdToken: input.phoneProof,
        },
        signal,
      );
    },
  };
  return {
    auth,
    facade: {
      available: () => true,
      snapshot: () => state,
      subscribe: store.subscribe,
      login: (phone: string, password: string) =>
        store.authenticate((previousRefreshToken) =>
          api.login({ phone, password, previousRefreshToken }),
        ),
      register: (input: RegistrationInput) =>
        store.authenticate(() => api.register(input)),
      cancelLogin() {
        if (store.snapshot().status === "authenticating") void store.logout();
      },
      logout: async () => {
        await store.logout();
      },
      restore: () => store.restore(),
    },
  };
}
