import {
  staffRecoveryDraft,
  rememberStaffRecovery,
  discardStaffRecovery,
} from "../../lib/staff-recovery-draft";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import {
  api,
  ApiError,
  errorText,
  newIdempotencyKey,
  type Schemas,
} from "../../api/client";
import { useSession } from "../../auth/session";
import {
  Button,
  Card,
  Field,
  Header,
  Notice,
  T,
} from "../../components/staff/ui";
import { OtpInput } from "../../components/staff/otp-input";
import { color } from "../../theme/staff";

type Request = { requestId: string; email: string };
/** Public staff email recovery. No request is sent automatically or retried on focus. */
export default function StaffForgotPassword() {
  const { signOut } = useSession();
  const [email, setEmail] = useState("");
  const [request, setRequest] = useState<Request | null>(null);
  const requestAttempt = useRef<Request | null>(null);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const code = digits.join("");
  const [proof, setProof] = useState<{
    token: string;
    expiresAt: number;
  } | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    if (!retryAt) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  async function send(resend = false) {
    if (sending.current || remaining > 0) return;
    const address = (request?.email ?? email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
      return setError("Nhập email đăng nhập hợp lệ.");
    const remembered = staffRecoveryDraft(address);
    if (!request && remembered?.acknowledged) {
      requestAttempt.current = remembered.attempt;
      setRequest(remembered.attempt);
      setMessage(
        remembered.message ??
          "Bạn có thể dùng mã trong email vừa nhận hoặc yêu cầu mã mới khi hết thời gian chờ.",
      );
      setRemaining(
        Math.max(0, Math.ceil((remembered.retryAt - Date.now()) / 1000)),
      );
      setRetryAt(remembered.retryAt);
      setError(null);
      return;
    }
    if (
      requestAttempt.current?.email !== address ||
      (resend && requestAttempt.current?.requestId === request?.requestId)
    )
      requestAttempt.current = null;
    const attempt = requestAttempt.current ??
      (!request ? remembered?.attempt : null) ?? {
        email: address,
        requestId: newIdempotencyKey(),
      };
    requestAttempt.current = attempt;
    rememberStaffRecovery({
      attempt,
      retryAt: 0,
      expiresAt: Date.now() + 600000,
      acknowledged: false,
    });
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api<Schemas["StaffPasswordResetRequestResultDto"]>(
        "/auth/staff/password-reset/request",
        { body: attempt },
      );
      rememberStaffRecovery({
        attempt,
        retryAt: Date.now() + result.resendAfterSeconds * 1000,
        expiresAt: Date.now() + result.expiresInSeconds * 1000,
        acknowledged: true,
        message: result.message,
      });
      if (!mounted.current) return;
      setRequest(attempt);
      setMessage(result.message);
      setDigits(Array(6).fill(""));
      setProof(null);
      setRemaining(result.resendAfterSeconds);
      setRetryAt(Date.now() + result.resendAfterSeconds * 1000);
    } catch (cause) {
      if (mounted.current) {
        setError(errorText(cause));
        if (cause instanceof ApiError && cause.status === 429)
          setRetryAt(Date.now() + (cause.retryAfterSeconds ?? 60) * 1000);
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function verify() {
    if (sending.current || !request || !/^\d{6}$/.test(code)) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api<Schemas["StaffPasswordResetVerifyResultDto"]>(
        "/auth/staff/password-reset/verify",
        { body: { ...request, code } },
      );
      if (mounted.current) {
        setProof({
          token: result.resetToken,
          expiresAt: Date.now() + result.expiresInSeconds * 1000,
        });
        setDigits(Array(6).fill(""));
      }
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function confirm() {
    if (sending.current || !request || !proof) return;
    if (proof.expiresAt <= Date.now()) {
      setProof(null);
      setPassword("");
      setConfirmation("");
      return setError(
        "Phiên xác minh đã hết hạn. Nhập lại mã trong email hoặc yêu cầu mã mới.",
      );
    }
    const length = new TextEncoder().encode(password).length;
    if (Array.from(password).length < 12 || length > 72)
      return setError("Mật khẩu mới dài từ 12 ký tự, tối đa 72 byte.");
    if (password !== confirmation)
      return setError("Hai lần nhập mật khẩu mới chưa khớp.");
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await api<Schemas["StaffPasswordResetResultDto"]>(
        "/auth/staff/password-reset/confirm",
        {
          body: { ...request, resetToken: proof.token, newPassword: password },
        },
      );
      discardStaffRecovery(request.email);
      if (mounted.current) {
        setPassword("");
        setConfirmation("");
        setDigits(Array(6).fill(""));
        setProof(null);
        setDone(true);
      }
    } catch (cause) {
      if (mounted.current) {
        if (cause instanceof ApiError && cause.status === 0) {
          setUncertain(true);
          setError(
            "Chưa xác nhận được kết quả đổi mật khẩu. Hãy thử đăng nhập bằng mật khẩu mới trước khi yêu cầu mã khác.",
          );
        } else setError(errorText(cause));
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function returnToLogin() {
    await signOut();
    router.replace("/staff/login");
  }
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Header
        title={proof ? "Đặt mật khẩu mới" : "Quên mật khẩu"}
        subtitle="Ứng dụng AgriTrace Nhân viên"
        back
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}
        >
          <Card style={{ gap: 16, padding: 20 }}>
            {done ? (
              <>
                <Notice
                  kind="success"
                  title="Đã đặt lại mật khẩu"
                  body="Các phiên đăng nhập cũ đã kết thúc. Đăng nhập lại bằng mật khẩu mới để tiếp tục."
                />
                <Button
                  label="Về đăng nhập"
                  onPress={() => void returnToLogin()}
                />
              </>
            ) : uncertain ? (
              <>
                <Notice
                  kind="warn"
                  title={error ?? "Chưa xác nhận được kết quả"}
                />
                <Button
                  label="Thử đăng nhập"
                  onPress={() => void returnToLogin()}
                />
              </>
            ) : (
              <>
                {!request ? (
                  <>
                    <T c={color.inkSoft}>
                      Nhập email đăng nhập nhân viên để nhận mã xác minh. Mã chỉ
                      dùng để khôi phục mật khẩu của tài khoản nhân viên.
                    </T>
                    <Field
                      label="Email nhân viên"
                      icon="mail"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      placeholder="ten@doanhnghiep.vn"
                      editable={!busy}
                    />
                  </>
                ) : (
                  <>
                    <T size={13} c={color.inkSoft}>
                      {request.email}
                    </T>
                    {!proof ? (
                      <>
                        {message && (
                          <Notice
                            kind="info"
                            title="Kiểm tra email"
                            body={message}
                          />
                        )}
                        <OtpInput
                          digits={digits}
                          onChange={setDigits}
                          disabled={busy}
                        />
                      </>
                    ) : (
                      <>
                        <Notice
                          kind="success"
                          title="Đã xác minh email"
                          body="Nhập mật khẩu mới để hoàn tất khôi phục tài khoản."
                        />
                        <Field
                          label="Mật khẩu mới"
                          secure
                          value={password}
                          onChangeText={setPassword}
                          autoCapitalize="none"
                          autoComplete="new-password"
                          textContentType="newPassword"
                          placeholder="Tối thiểu 12 ký tự"
                          editable={!busy}
                        />
                        <Field
                          label="Nhập lại mật khẩu mới"
                          secure
                          value={confirmation}
                          onChangeText={setConfirmation}
                          autoCapitalize="none"
                          autoComplete="new-password"
                          textContentType="newPassword"
                          editable={!busy}
                        />
                      </>
                    )}
                  </>
                )}
                {error && <Notice kind="error" title={error} />}
                {!request ? (
                  <Button
                    label={
                      remaining
                        ? `Thử lại sau ${remaining}s`
                        : "Gửi mã xác minh"
                    }
                    loading={busy}
                    disabled={busy || !email.trim() || remaining > 0}
                    onPress={() => void send()}
                  />
                ) : (
                  <>
                    <Button
                      label={proof ? "Đặt lại mật khẩu" : "Xác minh mã"}
                      loading={busy}
                      disabled={
                        busy ||
                        (proof ? !password || !confirmation : code.length !== 6)
                      }
                      onPress={() => void (proof ? confirm() : verify())}
                    />
                    {proof && (
                      <Button
                        kind="outline"
                        label="Xác minh lại"
                        disabled={busy}
                        onPress={() => {
                          setProof(null);
                          setPassword("");
                          setConfirmation("");
                          setError(null);
                        }}
                      />
                    )}
                    {!proof && (
                      <>
                        <Button
                          kind="outline"
                          label={
                            remaining
                              ? `Gửi lại mã sau ${remaining}s`
                              : "Gửi lại mã"
                          }
                          disabled={busy || remaining > 0}
                          onPress={() => void send(true)}
                        />
                        <Button
                          kind="outline"
                          label="Dùng email khác"
                          disabled={busy}
                          onPress={() => {
                            setRequest(null);
                            requestAttempt.current = null;
                            setError(null);
                            setMessage(null);
                            setDigits(Array(6).fill(""));
                            setProof(null);
                            setPassword("");
                            setConfirmation("");
                          }}
                        />
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
