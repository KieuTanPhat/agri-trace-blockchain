import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import { LocationPicker, PROVINCES } from '../../components/LocationPicker';
import { Button, Field, IconButton, Notice, T } from '../../components/ui';
import { color, font, noOutline } from '../../theme/tokens';
import { api, ApiError, errorText } from '../../api/client';
import { useSession } from '../../auth/session';
import { requestPhoneVerification } from '../../auth/firebase-phone';
import { PhoneChallenge, phoneError } from '../../auth/phone-challenge';

type Unit = { code: string; label: string };
const bytes = (s: string) => new TextEncoder().encode(s).length;
const phoneOk = (s: string) => /^(0|\+84)(3|5|7|8|9)\d{8}$/.test(s.replace(/\s+/g, ''));

/**
 * Registration (two steps + OTP) and password reset in one screen, so going
 * back keeps what was typed. Only native Firebase proof can create/reset an
 * account. SMS is sent only by an explicit user action, never by mounting UI.
 */
export default function Register() {
  const insets = useSafeAreaInsets();
  const reset = useLocalSearchParams<{ reset?: string }>().reset === '1';
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [province, setProvince] = useState<(Unit & { wards: Unit[] }) | undefined>();
  const [ward, setWard] = useState<Unit | undefined>();
  const [business, setBusiness] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [touched, setTouched] = useState(false);
  const { signIn, signOut } = useSession();
  const [challenge] = useState(() => new PhoneChallenge(requestPhoneVerification));
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(challenge.seconds), 500);
    return () => { clearInterval(timer); void challenge.clear(); };
  }, [challenge]);
  const sendCode = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await challenge.request(phone); setStep(3); }
    catch (e) { setError(phoneError(e)); }
    finally { setSeconds(challenge.seconds); setBusy(false); }
  };
  const verify = async (digits: string) => {
    if (busy || uncertain) return;
    Keyboard.dismiss();
    setBusy(true); setError(null);
    let submitted = false;
    try {
      const firebaseIdToken = await challenge.confirm(digits);
      submitted = true;
      if (reset) {
        await api('/auth/mobile/password-reset', { body: { phone: challenge.phone, newPassword: password, firebaseIdToken } });
        await signOut();
        setSuccess('Đã đổi mật khẩu. Đăng nhập bằng mật khẩu mới.');
      } else {
        await signIn('/auth/mobile/register', {
          phone: challenge.phone, password, firebaseIdToken, fullName: fullName.trim(),
          ...(email.trim() ? { contactEmail: email.trim().toLowerCase() } : {}),
          provinceCode: province!.code, wardCode: ward!.code,
          ...(business.trim() ? { businessAddress: business.trim() } : {}),
          consentVersion: 'DEV-CONSUMER-TEST-20261020',
        });
        setSuccess('Đã đăng ký và lưu phiên đăng nhập.');
      }
      setPassword(''); setConfirm('');
      await challenge.clear();
    } catch (e) {
      if (submitted) {
        await challenge.clear();
        if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) {
          setUncertain(true);
          setError('Chưa xác nhận được kết quả. Thử đăng nhập bằng số điện thoại và mật khẩu vừa nhập; không gửi lại yêu cầu đăng ký/đổi mật khẩu.');
        } else {
          setError(errorText(e)); setStep(reset ? 1 : 2);
        }
      } else setError(phoneError(e));
    } finally { setBusy(false); }
  };

  const pwError =
    password && (password.length < 12 || bytes(password) < 12) ? 'Mật khẩu cần ít nhất 12 ký tự' : bytes(password) > 72 ? 'Mật khẩu tối đa 72 byte' : null;
  const step1Ok = phoneOk(phone) && !!password && !pwError && password === confirm;
  const step2Ok = fullName.trim().length > 1 && !!province && !!ward && agreed;
  const back = () => { if (busy) return; if (step === 3) void challenge.clear(); if (step > 1) setStep((step - 1) as 1 | 2); else if (router.canGoBack()) router.back(); else router.replace('/consumer'); };

  if (success || uncertain) return <View style={{ flex: 1, paddingTop: insets.top + 24, padding: 24, gap: 20 }}><Notice kind={success ? 'info' : 'warn'} title={success ?? error ?? ''} /><Button label={success && !reset ? 'Vào tài khoản' : 'Đăng nhập'} onPress={() => router.replace(success && !reset ? '/consumer/account' : '/consumer/login')} /></View>;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 24, paddingBottom: 40, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton name="back" label="Quay lại" onPress={back} style={{ marginLeft: -10 }} />
          {!reset && step < 3 && (
            <T size={14.5} weight="heavy" c={color.green}>
              Bước {step}/2
            </T>
          )}
        </View>
        {!reset && step < 3 && (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[1, 2].map((n) => (
              <View key={n} style={{ flex: 1, height: 5, borderRadius: 4, backgroundColor: n <= step ? color.green : color.line }} />
            ))}
          </View>
        )}

        {step === 1 && (
          <>
            <T size={28} weight="heavy">
              {reset ? 'Quên mật khẩu' : 'Tạo tài khoản'}
            </T>
            {reset && <Notice kind="warn" title="Xác minh số của bạn" body="Google xử lý số điện thoại để xác minh/chống lạm dụng. Chỉ gửi mã cho số của bạn; SMS có thể phát sinh phí cho dự án." />}
            <Field label="Số điện thoại" required icon="phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" autoCorrect={false} placeholder="09xx xxx xxx" error={touched && !phoneOk(phone) ? 'Số điện thoại Việt Nam chưa đúng' : null} />
            <Field label={reset ? 'Mật khẩu mới' : 'Mật khẩu'} required icon="lock" value={password} onChangeText={setPassword} secure autoComplete="new-password" textContentType="newPassword" error={pwError} hint="Từ 12 ký tự trở lên; có thể dùng cả câu dễ nhớ." />
            <Field label="Nhập lại mật khẩu" required icon="lock" value={confirm} onChangeText={setConfirm} secure autoComplete="new-password" error={confirm && confirm !== password ? 'Hai mật khẩu chưa khớp' : null} />
            <Button
              label={reset ? 'Gửi mã xác minh' : 'Tiếp tục'}
              loading={busy}
              disabled={!step1Ok || busy || (reset && seconds > 0)}
              onPress={() => {
                setTouched(true);
                if (step1Ok) { if (reset) void sendCode(); else setStep(2); }
              }}
            />
          </>
        )}

        {step === 2 && (
          <>
            <T size={28} weight="heavy">
              Thông tin của bạn
            </T>
            <Field label="Họ và tên" required value={fullName} onChangeText={setFullName} autoComplete="name" />
            <Field label="Số điện thoại" value={phone} readOnly />
            <Field label="Email liên hệ" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" placeholder="ban@vidu.vn" hint="Không dùng để đăng nhập." />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <LocationPicker
                label="Tỉnh/thành"
                value={province}
                options={PROVINCES}
                onPick={(p) => {
                  setProvince(PROVINCES.find((x) => x.code === p.code));
                  setWard(undefined);
                }}
              />
              <LocationPicker label="Phường/xã" value={ward} options={province?.wards ?? []} onPick={setWard} disabled={!province} error={!!province && !ward} />
            </View>
            {province && !ward && (
              <T size={13.5} weight="bold" c={color.redDeep}>
                Chọn phường/xã thuộc {province.label}
              </T>
            )}
            <Field label="Địa chỉ doanh nghiệp" value={business} onChangeText={setBusiness} placeholder="Nếu bạn mua cho cửa hàng, quán ăn…" hint="Không bắt buộc." />
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => setAgreed(!agreed)} style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 14, backgroundColor: color.greenTint }}>
              <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: color.green, backgroundColor: agreed ? color.green : '#fff', alignItems: 'center', justifyContent: 'center' }}>
                {agreed && <Icon name="check" size={18} color={color.green} />}
              </View>
              <T size={15} style={{ flex: 1 }}>
                Tôi đồng ý với{' '}
                <T size={15} weight="heavy" c={color.blue} onPress={() => router.push('/consumer/policy')}>
                  Điều khoản sử dụng và Chính sách bảo mật
                </T>
                <T c={color.red}> *</T>
              </T>
            </Pressable>
            <Notice kind="warn" title="Thử nghiệm xác minh điện thoại" body="Chỉ dùng số của bạn và hồ sơ thử nghiệm. Google xử lý số điện thoại để xác minh/chống lạm dụng; SMS có thể phát sinh phí cho dự án. Văn bản chính thức đang được hoàn thiện." />
            <Button label="Gửi mã đăng ký" loading={busy} disabled={!step2Ok || busy || seconds > 0} onPress={() => void sendCode()} />
            <T size={14} c={color.muted} style={{ textAlign: 'center' }}>
              Mã xác minh sẽ gửi qua SMS tới số của bạn.
            </T>
          </>
        )}

        {error && <Notice kind="error" title={error} />}
        {step !== 3 && seconds > 0 && <T size={14} c={color.muted}>Có thể yêu cầu mã mới sau {seconds} giây.</T>}
        {step === 3 && <OtpStep phone={phone} seconds={seconds} busy={busy} onVerify={digits => void verify(digits)} onResend={() => void sendCode()} onChangePhone={() => { if (!busy) { void challenge.clear(); setStep(1); } }} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function OtpStep({ phone, onChangePhone, seconds, busy, onVerify, onResend }: { phone: string; onChangePhone: () => void; seconds: number; busy: boolean; onVerify: (digits: string) => void; onResend: () => void }) {
  const [digits, setDigits] = useState('');
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const masked = phone.replace(/\s+/g, '').replace(/^(\+84|0)(\d{3})\d{3}(\d{3})$/, '0$2 *** $3');
  return (
    <>
      <T size={30} weight="heavy">
        Nhập mã xác minh
      </T>
      <T size={16.5} c={color.inkSoft}>
        Mã gồm 6 số đã gửi qua SMS tới <T weight="heavy">{masked}</T>
      </T>
      <Pressable accessibilityRole="none" onPress={() => input.current?.focus()} style={{ flexDirection: 'row', gap: 8 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 62, borderRadius: 14, borderWidth: i === digits.length ? 2 : 1.5, borderColor: i === digits.length ? color.green : color.field, backgroundColor: '#f7f9fb', alignItems: 'center', justifyContent: 'center' }}>
            <T size={26} weight="heavy">
              {digits[i] ?? ''}
            </T>
          </View>
        ))}
      </Pressable>
      <TextInput
        ref={input}
        autoFocus
        value={digits}
        onChangeText={(v) => setDigits(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        accessibilityLabel="Mã xác minh 6 số"
        style={[{ position: 'absolute', opacity: 0, height: 1, width: 1, fontFamily: font.bold }, noOutline]}
      />
      <T size={15.5} c={color.inkSoft} style={{ textAlign: 'center' }}>
        {seconds > 0 ? `Gửi lại mã sau 0:${String(seconds).padStart(2, '0')}` : 'Bạn có thể yêu cầu gửi lại mã.'}
      </T>
      <Pressable accessibilityRole="link" onPress={onChangePhone} style={{ alignSelf: 'center', padding: 8 }}>
        <T size={16} weight="heavy" c={color.blue}>
          Đổi số điện thoại
        </T>
      </Pressable>
      <Button label="Gửi lại mã" kind="soft" disabled={seconds > 0 || busy} onPress={() => { setDigits(''); onResend(); }} />
      <Button label="Xác minh" loading={busy} disabled={digits.length !== 6 || busy} onPress={() => onVerify(digits)} />
    </>
  );
}
