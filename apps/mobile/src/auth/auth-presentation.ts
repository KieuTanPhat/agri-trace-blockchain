export type AuthFlowStep =
  "credentials" | "profile" | "otp" | "password" | "done";
export function authPresentation(
  mode: "register" | "reset",
  step: AuthFlowStep,
) {
  if (mode === "register")
    return {
      title:
        step === "profile"
          ? "Thêm một chút về bạn"
          : step === "otp"
            ? "Xác nhận số điện thoại"
            : "Bắt đầu cùng ACheck",
      subtitle:
        step === "profile"
          ? "Hoàn thiện hồ sơ trước khi xác nhận số điện thoại."
          : step === "otp"
            ? "Nhập mã 6 số để hoàn tất luồng đăng ký thử nghiệm."
            : "Tạo tài khoản người tiêu dùng chỉ với vài bước đơn giản.",
      steps: ["Tài khoản", "Hồ sơ", "Xác nhận"],
      current: step === "profile" ? 1 : step === "otp" ? 2 : 0,
    };
  return {
    title:
      step === "otp"
        ? "Kiểm tra mã xác nhận"
        : step === "password"
          ? "Tạo mật khẩu mới"
          : step === "done"
            ? "Bạn đã hoàn tất bản thử"
            : "Quên mật khẩu?",
    subtitle:
      step === "otp"
        ? "Nhập mã 6 số để tiếp tục khôi phục tài khoản thử nghiệm."
        : step === "password"
          ? "Chọn mật khẩu mới và nhập lại để xác nhận."
          : step === "done"
            ? "Quay lại đăng nhập để tiếp tục khám phá."
            : "Không sao, cùng lấy lại quyền truy cập từng bước nhé.",
    steps: ["Số điện thoại", "Xác nhận", "Mật khẩu mới"],
    current:
      step === "otp" ? 1 : step === "password" || step === "done" ? 2 : 0,
  };
}
