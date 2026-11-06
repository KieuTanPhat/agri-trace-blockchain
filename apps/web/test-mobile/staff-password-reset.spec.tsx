import { createElement, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { discardStaffRecovery } from "../../mobile/src/lib/staff-recovery-draft";
import StaffForgotPassword from "../../mobile/src/app/staff/forgot-password";
const mock = vi.hoisted(() => ({
  api: vi.fn(),
  id: 0,
  signOut: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("../../mobile/src/api/client", () => ({
  api: mock.api,
  newIdempotencyKey: () => `request-${++mock.id}`,
  errorText: (error: Error) => error.message,
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly retryAfterSeconds?: number,
    ) {
      super(message);
    }
  },
}));
vi.mock("../../mobile/src/auth/session", () => ({
  useSession: () => ({ signOut: mock.signOut }),
}));
vi.mock("../../mobile/node_modules/expo-router", () => ({
  router: { replace: mock.replace },
}));
vi.mock("../../mobile/node_modules/react-native", () => ({
  TextInput: ({
    accessibilityLabel,
    value,
    onChangeText,
    onKeyPress,
    editable,
    onFocus,
    onBlur,
    ref,
  }: {
    accessibilityLabel: string;
    value: string;
    onChangeText: (v: string) => void;
    onKeyPress: (e: { nativeEvent: { key: string } }) => void;
    editable: boolean;
    onFocus: () => void;
    onBlur: () => void;
    ref: React.Ref<HTMLInputElement>;
  }) =>
    createElement("input", {
      ref,
      "aria-label": accessibilityLabel,
      value,
      disabled: !editable,
      onFocus,
      onBlur,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        onChangeText(e.target.value),
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) =>
        onKeyPress({ nativeEvent: { key: e.key } }),
    }),
  Platform: { OS: "android" },
  View: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  ScrollView: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));
vi.mock("../../mobile/src/components/staff/ui", () => ({
  Card: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  T: ({ children }: { children: ReactNode }) =>
    createElement("span", null, children),
  Header: ({ title }: { title: string }) => createElement("h1", null, title),
  Field: ({
    label,
    value,
    onChangeText,
    secure,
    editable,
  }: {
    label: string;
    value: string;
    onChangeText: (v: string) => void;
    secure?: boolean;
    editable?: boolean;
  }) =>
    createElement(
      "label",
      null,
      label,
      createElement("input", {
        value,
        type: secure ? "password" : "text",
        disabled: editable === false,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText(e.target.value),
      }),
    ),
  Notice: ({ title, body }: { title: string; body?: string }) =>
    createElement(
      "div",
      { role: "status" },
      createElement("strong", null, title),
      createElement("p", null, body),
    ),
  Button: ({
    label,
    onPress,
    disabled,
    loading,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) =>
    createElement(
      "button",
      { onClick: onPress, disabled: disabled || loading },
      label,
    ),
}));
async function requestCode() {
  fireEvent.change(screen.getByLabelText("Email nhân viên"), {
    target: { value: "Staff@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Gửi mã xác minh" }));
  await screen.findByLabelText("Chữ số 1");
}
async function verifyCode() {
  fireEvent.change(screen.getByLabelText("Chữ số 1"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Xác minh mã" }));
  await screen.findByLabelText("Mật khẩu mới");
}
function fillPassword() {
  fireEvent.change(screen.getByLabelText("Mật khẩu mới"), {
    target: { value: "New-password-2026!" },
  });
  fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), {
    target: { value: "New-password-2026!" },
  });
}
beforeEach(() => {
  discardStaffRecovery("staff@example.test");
  vi.clearAllMocks();
  mock.id = 0;
  mock.api.mockImplementation(async (path: string) =>
    path.endsWith("/verify")
      ? { resetToken: "verified-proof", expiresInSeconds: 300 }
      : path.endsWith("/confirm")
        ? { changed: true }
        : {
            message:
              "Nếu email thuộc nhân viên đang hoạt động, hãy kiểm tra email.",
            resendAfterSeconds: 60,
            expiresInSeconds: 600,
          },
  );
  mock.signOut.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("does not automatically send a code and rejects an invalid email locally", () => {
  render(<StaffForgotPassword />);
  expect(mock.api).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Email nhân viên"), {
    target: { value: "bad-email" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Gửi mã xác minh" }));
  expect(screen.getByText("Nhập email đăng nhập hợp lệ.")).toBeInTheDocument();
  expect(mock.api).not.toHaveBeenCalled();
});
it("normalizes staff email and shows an explicit resend cooldown after requesting", async () => {
  render(<StaffForgotPassword />);
  await requestCode();
  expect(mock.api.mock.calls[0]).toEqual([
    "/auth/staff/password-reset/request",
    { body: { email: "staff@example.test", requestId: "request-1" } },
  ]);
  expect(screen.getByRole("button", { name: /Gửi lại mã sau/ })).toBeDisabled();
});
it("reuses the original request ID after a lost request response", async () => {
  const { ApiError } = await import("../../mobile/src/api/client");
  mock.api.mockRejectedValueOnce(new ApiError(0, "Mất kết nối"));
  render(<StaffForgotPassword />);
  fireEvent.change(screen.getByLabelText("Email nhân viên"), {
    target: { value: "staff@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Gửi mã xác minh" }));
  await screen.findByText("Mất kết nối");
  fireEvent.click(screen.getByRole("button", { name: "Gửi mã xác minh" }));
  await screen.findByLabelText("Chữ số 1");
  expect(mock.api.mock.calls[1][1].body).toEqual(
    mock.api.mock.calls[0][1].body,
  );
});
it("requires matching passwords before confirming and returns to login after success", async () => {
  render(<StaffForgotPassword />);
  await requestCode();
  await verifyCode();
  fillPassword();
  fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), {
    target: { value: "not-matching-2026" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Đặt lại mật khẩu" }));
  expect(
    screen.getByText("Hai lần nhập mật khẩu mới chưa khớp."),
  ).toBeInTheDocument();
  expect(mock.api).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), {
    target: { value: "New-password-2026!" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Đặt lại mật khẩu" }));
  await screen.findByText("Đã đặt lại mật khẩu");
  expect(mock.api.mock.calls[2]).toEqual([
    "/auth/staff/password-reset/confirm",
    {
      body: {
        requestId: "request-1",
        email: "staff@example.test",
        resetToken: "verified-proof",
        newPassword: "New-password-2026!",
      },
    },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Về đăng nhập" }));
  await waitFor(() =>
    expect(mock.replace).toHaveBeenCalledWith("/staff/login"),
  );
  expect(mock.signOut).toHaveBeenCalledOnce();
});
it("does not resend a reset automatically when the confirmation response is lost", async () => {
  const { ApiError } = await import("../../mobile/src/api/client");
  mock.api
    .mockResolvedValueOnce({
      message: "Kiểm tra email",
      resendAfterSeconds: 60,
      expiresInSeconds: 600,
    })
    .mockResolvedValueOnce({
      resetToken: "verified-proof",
      expiresInSeconds: 300,
    })
    .mockRejectedValueOnce(new ApiError(0, "Mất kết nối"));
  render(<StaffForgotPassword />);
  await requestCode();
  await verifyCode();
  fillPassword();
  fireEvent.click(screen.getByRole("button", { name: "Đặt lại mật khẩu" }));
  await screen.findByRole("button", { name: "Thử đăng nhập" });
  expect(
    screen.queryByRole("button", { name: "Đặt lại mật khẩu" }),
  ).not.toBeInTheDocument();
  expect(mock.api).toHaveBeenCalledTimes(3);
});

it("counts Unicode password characters consistently with the API", async () => {
  render(<StaffForgotPassword />);
  await requestCode();
  await verifyCode();
  fillPassword();
  fireEvent.change(screen.getByLabelText("Mật khẩu mới"), {
    target: { value: "😀".repeat(6) },
  });
  fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), {
    target: { value: "😀".repeat(6) },
  });
  fireEvent.click(screen.getByRole("button", { name: "Đặt lại mật khẩu" }));
  expect(
    screen.getByText("Mật khẩu mới dài từ 12 ký tự, tối đa 72 byte."),
  ).toBeInTheDocument();
  expect(mock.api).toHaveBeenCalledTimes(2);
});

it("resumes the same request after navigating away without sending another email", async () => {
  const first = render(<StaffForgotPassword />);
  await requestCode();
  first.unmount();
  render(<StaffForgotPassword />);
  expect(screen.getByLabelText("Email nhân viên")).toHaveValue("");
  await requestCode();
  expect(mock.api).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: /Gửi lại mã sau/ })).toBeDisabled();
});

it("keeps password fields hidden on incorrect OTP and only advances on server verification", async () => {
  const { ApiError } = await import("../../mobile/src/api/client");
  render(<StaffForgotPassword />);
  await requestCode();
  expect(screen.queryByLabelText("Mật khẩu mới")).not.toBeInTheDocument();
  expect(screen.getAllByRole("textbox")).toHaveLength(6);
  expect(screen.getByRole("button", { name: "Xác minh mã" })).toBeDisabled();
  mock.api.mockRejectedValueOnce(new ApiError(400, "Mã không đúng"));
  fireEvent.change(screen.getByLabelText("Chữ số 1"), {
    target: { value: "654321" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Xác minh mã" }));
  await screen.findByText("Mã không đúng");
  expect(screen.queryByLabelText("Mật khẩu mới")).not.toBeInTheDocument();
  await verifyCode();
  expect(screen.queryByLabelText("Chữ số 1")).not.toBeInTheDocument();
  expect(mock.api.mock.calls[2]).toEqual([
    "/auth/staff/password-reset/verify",
    {
      body: {
        email: "staff@example.test",
        requestId: "request-1",
        code: "123456",
      },
    },
  ]);
});
it("advances focus per digit, handles backspace and distributes pasted digits", async () => {
  render(<StaffForgotPassword />);
  await requestCode();
  fireEvent.change(screen.getByLabelText("Chữ số 1"), {
    target: { value: "1" },
  });
  expect(screen.getByLabelText("Chữ số 2")).toHaveFocus();
  fireEvent.keyDown(screen.getByLabelText("Chữ số 2"), { key: "Backspace" });
  expect(screen.getByLabelText("Chữ số 1")).toHaveValue("");
  expect(screen.getByLabelText("Chữ số 1")).toHaveFocus();
  fireEvent.change(screen.getByLabelText("Chữ số 1"), {
    target: { value: "12a3456" },
  });
  for (let i = 1; i <= 6; i++)
    expect(screen.getByLabelText(`Chữ số ${i}`)).toHaveValue(String(i));
  expect(mock.api).toHaveBeenCalledTimes(1);
});
it("requires verification again when a grant expires", async () => {
  render(<StaffForgotPassword />);
  await requestCode();
  await verifyCode();
  fillPassword();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
  fireEvent.click(screen.getByRole("button", { name: "Đặt lại mật khẩu" }));
  await screen.findByLabelText("Chữ số 1");
  expect(screen.queryByLabelText("Mật khẩu mới")).not.toBeInTheDocument();
  expect(mock.api).toHaveBeenCalledTimes(2);
});
it("allows retrying verification after a lost response without exposing password fields", async () => {
  const { ApiError } = await import("../../mobile/src/api/client");
  render(<StaffForgotPassword />);
  await requestCode();
  mock.api.mockRejectedValueOnce(new ApiError(0, "Mất kết nối"));
  fireEvent.change(screen.getByLabelText("Chữ số 1"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Xác minh mã" }));
  await screen.findByText("Mất kết nối");
  expect(screen.queryByLabelText("Mật khẩu mới")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Xác minh mã" }));
  await screen.findByLabelText("Mật khẩu mới");
  expect(mock.api.mock.calls[2]).toEqual(mock.api.mock.calls[1]);
});
