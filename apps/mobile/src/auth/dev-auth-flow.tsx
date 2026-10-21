import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { BackHandler, Modal, Pressable, Text, View } from "react-native";
import {
  Button,
  KeyValue,
  Notice,
  Screen,
  Title,
  styles,
} from "../components/ui";
import { AuthField } from "./auth-field";
import { authWorkflow, demoSession, useAuth } from "./use-auth";
import { normalizePhone, passwordError } from "./validation";
import {
  changeProvince,
  credentialErrors,
  emptyRegistration,
  profileErrors,
  type RegistrationDraft,
} from "./registration-validation";
import { provinces } from "../locations";
import { LocationPicker } from "../locations/location-picker";
import { colors, space } from "../theme/tokens";
import { AuthScaffold } from "./auth-scaffold";
import { authPresentation } from "./auth-presentation";

type Step = "credentials" | "profile" | "otp" | "password" | "done";
export default function AuthFlow({
  mode,
  demo,
  document,
}: {
  mode: "register" | "reset";
  demo: boolean;
  document: {
    version: string;
    sections: readonly { title: string; body: string }[];
  };
}) {
  const register = mode === "register";
  const [step, setStep] = useState<Step>("credentials");
  const [draft, setDraft] = useState(emptyRegistration);
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<{
    challengeId: string;
    resendAt: number;
  } | null>(null);
  const proof = useRef<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [legal, setLegal] = useState(false);
  const locked = useRef(false);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const { auth, phone } = authWorkflow();
  const session = useAuth();
  const credential = credentialErrors(draft);
  const profile = profileErrors(draft);
  const province = provinces.find((item) => item.code === draft.provinceCode);
  const presentation = authPresentation(mode, step);
  const remaining = Math.max(
    0,
    Math.ceil(((challenge?.resendAt ?? 0) - now) / 1000),
  );
  const patch = (key: keyof RegistrationDraft, value: string | boolean) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      ++generation.current;
      abort.current?.abort();
      demoSession.cancelLogin();
      phone.cancel?.();
    };
  }, []);
  function transition(next: Step) {
    setStep(next);
    setSubmitted(false);
    setError("");
  }
  function back() {
    ++generation.current;
    abort.current?.abort();
    demoSession.cancelLogin();
    locked.current = false;
    setBusy(false);
    setCode("");
    proof.current = null;
    phone.cancel?.();
    if (step === "profile") transition("credentials");
    else if (step === "otp") transition(register ? "profile" : "credentials");
    else if (step === "password") {
      setDraft((previous) => ({ ...previous, password: "", confirmation: "" }));
      transition("credentials");
    } else router.back();
  }
  useEffect(() => {
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      if (legal) {
        setLegal(false);
        return true;
      }
      back();
      return true;
    });
    return () => handler.remove();
  });
  async function run(
    operation: (signal: AbortSignal, current: () => boolean) => Promise<void>,
  ) {
    if (locked.current) return;
    if (
      ["restoring", "authenticating", "logoutPending"].includes(session.status)
    ) {
      setError(
        "Vui lòng chờ xác nhận hoặc thu hồi phiên hiện tại trước khi tiếp tục.",
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    const epoch = ++generation.current;
    const controller = new AbortController();
    abort.current = controller;
    const current = () =>
      generation.current === epoch && !controller.signal.aborted;
    try {
      await operation(controller.signal, current);
    } catch (cause) {
      if (current())
        setError(
          cause instanceof Error
            ? cause.message
            : "Chưa thực hiện được. Vui lòng thử lại.",
        );
    } finally {
      if (current()) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  function send() {
    void run(async (signal, current) => {
      const next = await phone.send(normalizePhone(draft.phone)!, signal);
      if (!current()) return;
      proof.current = null;
      setChallenge(next);
      setCode("");
      setNow(Date.now());
      transition("otp");
    });
  }
  function credentialsNext() {
    setSubmitted(true);
    if (register) {
      if (Object.values(credential).some(Boolean)) return;
      transition("profile");
    } else if (!credential.phone) send();
  }
  function profileNext() {
    setSubmitted(true);
    if (
      Object.values(profile).some(Boolean) ||
      Object.values(credential).some(Boolean)
    )
      return;
    send();
  }
  function confirm() {
    setSubmitted(true);
    if (!/^\d{6}$/.test(code) || !challenge) return;
    void run(async (signal, current) => {
      const token =
        proof.current ??
        (await phone.confirm(challenge.challengeId, code, signal));
      if (!current()) return;
      proof.current = token;
      if (!register) {
        setCode("");
        transition("password");
        return;
      }
      const success = await demoSession.register({
        phone: normalizePhone(draft.phone)!,
        password: draft.password,
        fullName: draft.fullName.trim(),
        contactEmail: draft.contactEmail.trim().toLowerCase() || undefined,
        provinceCode: draft.provinceCode,
        wardCode: draft.wardCode,
        businessAddress: draft.businessAddress.trim() || undefined,
        consentVersion: document.version,
        phoneProof: token,
      });
      if (!current()) return;
      if (!success)
        throw new Error(
          "Chưa xác nhận đăng ký. Nếu đã gửi yêu cầu, hãy thử đăng nhập; không tự gửi lại nhiều lần.",
        );
      proof.current = null;
      setDraft(emptyRegistration());
      setCode("");
      router.replace("/account");
    });
  }
  function resetPassword() {
    setSubmitted(true);
    if (
      passwordError(draft.password) ||
      draft.password !== draft.confirmation ||
      !proof.current ||
      !auth.resetPassword
    )
      return;
    void run(async (signal, current) => {
      await auth.resetPassword!(
        {
          phone: normalizePhone(draft.phone)!,
          password: draft.password,
          phoneProof: proof.current!,
        },
        signal,
      );
      if (!current()) return;
      await demoSession.logout();
      if (!current()) return;
      proof.current = null;
      setDraft(emptyRegistration());
      setChallenge(null);
      transition("done");
    });
  }
  const passwords = (
    <>
      <Text style={styles.small}>
        Ít nhất 12 ký tự, tối đa 72 byte UTF-8. Không tự cắt hoặc đổi mật khẩu.
      </Text>
      <AuthField
        label={step === "password" ? "Mật khẩu mới" : "Mật khẩu"}
        value={draft.password}
        onChangeText={(value) => patch("password", value)}
        password
        newPassword
        disabled={busy}
        error={submitted ? passwordError(draft.password) : undefined}
      />
      <AuthField
        label="Nhập lại mật khẩu"
        value={draft.confirmation}
        onChangeText={(value) => patch("confirmation", value)}
        password
        newPassword
        disabled={busy}
        error={
          submitted && draft.password !== draft.confirmation
            ? "Mật khẩu nhập lại chưa khớp."
            : undefined
        }
      />
    </>
  );
  return (
    <AuthScaffold
      key={step}
      {...presentation}
      subtitle={
        demo
          ? presentation.subtitle
          : step === "otp"
            ? "Nhập mã SMS từ Firebase để xác minh số điện thoại."
            : presentation.subtitle.replace(" thử nghiệm", "")
      }
      title={
        !demo && step === "done" ? "Đã đặt lại mật khẩu" : presentation.title
      }
      onBack={back}
    >
      <Notice>
        {demo
          ? "Bản mô phỏng: không gửi SMS, không tạo tài khoản thật."
          : "Bản dev dùng Firebase thật. Chỉ dùng số của bạn và hồ sơ thử nghiệm. SMS có thể phát sinh phí cho dự án."}
      </Notice>
      {error ? <Notice danger>{error}</Notice> : null}
      {step === "credentials" && (
        <>
          <AuthField
            label="Số điện thoại"
            value={draft.phone}
            onChangeText={(value) => patch("phone", value)}
            disabled={busy}
            error={submitted ? credential.phone : undefined}
          />
          {register && passwords}
          <Button
            label={
              register
                ? "Tiếp tục bước 2"
                : demo
                  ? "Gửi mã thử nghiệm"
                  : "Gửi mã SMS"
            }
            busy={busy}
            onPress={credentialsNext}
          />
        </>
      )}
      {step === "profile" && (
        <>
          <Text style={styles.heading}>Bước 2 — Hồ sơ</Text>
          <KeyValue
            label="Số điện thoại"
            value={normalizePhone(draft.phone) ?? draft.phone}
          />
          <AuthField
            label="Họ tên"
            kind="text"
            value={draft.fullName}
            onChangeText={(value) => patch("fullName", value)}
            disabled={busy}
            error={submitted ? profile.fullName : undefined}
          />
          <AuthField
            label="Email liên hệ (không bắt buộc)"
            kind="email"
            value={draft.contactEmail}
            onChangeText={(value) => patch("contactEmail", value)}
            disabled={busy}
            error={submitted ? profile.contactEmail : undefined}
          />
          <Text style={styles.small}>
            Email chưa xác minh, không dùng đăng nhập/khôi phục.
          </Text>
          <LocationPicker
            label="Tỉnh/thành"
            value={draft.provinceCode}
            items={provinces}
            disabled={busy}
            onSelect={(value) =>
              setDraft((previous) => changeProvince(previous, value))
            }
          />
          <LocationPicker
            label="Phường/xã"
            value={draft.wardCode}
            items={province?.wards ?? []}
            disabled={busy || !province}
            onSelect={(value) => patch("wardCode", value)}
          />
          {submitted && profile.location && (
            <Notice danger>{profile.location}</Notice>
          )}
          <AuthField
            label="Địa chỉ doanh nghiệp (không bắt buộc)"
            kind="text"
            value={draft.businessAddress}
            onChangeText={(value) => patch("businessAddress", value)}
            disabled={busy}
            error={submitted ? profile.businessAddress : undefined}
          />
          <Button
            label={
              demo
                ? "Đọc bản giữ chỗ Điều khoản và Chính sách"
                : "Đọc thông báo xử lý dữ liệu bản dev"
            }
            secondary
            onPress={() => setLegal(true)}
          />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: draft.consent, disabled: busy }}
            disabled={busy}
            accessibilityLabel={
              demo
                ? "Đồng ý bản giữ chỗ chỉ để thử luồng"
                : "Đồng ý xử lý dữ liệu thử nghiệm như thông báo đã đọc"
            }
            onPress={() => patch("consent", !draft.consent)}
            style={{
              minHeight: 48,
              padding: space.md,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 16,
              backgroundColor: draft.consent ? colors.pale : colors.paper,
            }}
          >
            <Text style={styles.value}>
              {draft.consent ? "☑" : "☐"}{" "}
              {demo
                ? "Tôi đồng ý bản giữ chỗ chỉ để thử luồng."
                : "Tôi đã đọc thông báo và đồng ý dùng dữ liệu của mình cho thử nghiệm này."}
            </Text>
          </Pressable>
          {submitted && profile.consent && (
            <Notice danger>{profile.consent}</Notice>
          )}
          <Button
            label={demo ? "Đăng ký và gửi mã thử" : "Đăng ký và gửi SMS"}
            busy={busy}
            onPress={profileNext}
          />
        </>
      )}
      {step === "otp" && (
        <>
          <Text style={styles.body}>
            {demo
              ? "Nhập mã mô phỏng đã cấu hình cho bản demo."
              : `Nhập mã 6 số Firebase gửi tới ${draft.phone}. Không chia sẻ mã này.`}
          </Text>
          <AuthField
            label="Mã OTP 6 số"
            kind="otp"
            value={code}
            onChangeText={setCode}
            disabled={busy}
            error={
              submitted && !/^\d{6}$/.test(code)
                ? "Nhập đủ 6 chữ số."
                : undefined
            }
          />
          <Button
            label={demo ? "Xác nhận mã thử" : "Xác nhận mã SMS"}
            busy={busy}
            onPress={confirm}
          />
          <Button
            label={remaining ? `Gửi lại sau ${remaining} giây` : "Gửi lại mã"}
            secondary
            disabled={remaining > 0}
            busy={busy}
            onPress={send}
          />
        </>
      )}
      {step === "password" && (
        <>
          {passwords}
          <Button
            label={demo ? "Đặt lại mật khẩu bản thử" : "Đặt lại mật khẩu"}
            busy={busy}
            onPress={resetPassword}
          />
        </>
      )}
      {step === "done" && (
        <>
          <Notice>
            {demo
              ? "Đã mô phỏng đặt lại mật khẩu, thông tin demo không thay đổi."
              : "Đã đặt lại mật khẩu và thu hồi các phiên cũ. Vui lòng đăng nhập lại."}
          </Notice>
          <Button
            label="Về đăng nhập"
            onPress={() => router.replace("/login")}
          />
        </>
      )}
      {step !== "done" && (
        <Button
          label={step === "otp" ? "Đổi số / quay lại" : "Quay lại"}
          secondary
          onPress={back}
        />
      )}
      <Modal
        visible={legal}
        animationType="none"
        onRequestClose={() => setLegal(false)}
      >
        <Screen>
          <Title>{demo ? "Bản giữ chỗ pháp lý" : "Thông báo thử nghiệm"}</Title>
          <Text style={styles.small}>Phiên bản: {document.version}</Text>
          {document.sections.map((section) => (
            <View key={section.title} style={{ gap: space.sm }}>
              <Text style={styles.heading}>{section.title}</Text>
              <Text style={styles.body}>{section.body}</Text>
            </View>
          ))}
          <Button
            label="Đóng văn bản"
            secondary
            onPress={() => setLegal(false)}
          />
        </Screen>
      </Modal>
    </AuthScaffold>
  );
}
