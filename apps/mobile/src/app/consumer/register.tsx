import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import { LocationPicker, PROVINCES } from '../../components/LocationPicker';
import { Button, Field, IconButton, Notice, T } from '../../components/ui';
import { color, font, noOutline } from '../../theme/tokens';

type Unit = { code: string; label: string };
const bytes = (s: string) => new TextEncoder().encode(s).length;
const phoneOk = (s: string) => /^(0|\+84)(3|5|7|8|9)\d{8}$/.test(s.replace(/\s+/g, ''));

/**
 * Registration (two steps + OTP) and password reset in one screen, so going
 * back keeps what was typed. SMS verification needs Firebase (phase B): until
 * then the OTP step explains that no account is created.
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

  const pwError =
    password && bytes(password) < 12 ? 'Mật khẩu cần ít nhất 12 ký tự' : bytes(password) > 72 ? 'Mật khẩu tối đa 72 byte' : null;
  const step1Ok = phoneOk(phone) && !!password && !pwError && password === confirm;
  const step2Ok = fullName.trim().length > 1 && !!province && !!ward && agreed;
  const back = () => (step > 1 ? setStep((step - 1) as 1 | 2) : router.canGoBack() ? router.back() : router.replace('/consumer'));

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
            <Field label="Số điện thoại" required icon="phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" autoCorrect={false} placeholder="09xx xxx xxx" error={touched && !phoneOk(phone) ? 'Số điện thoại Việt Nam chưa đúng' : null} />
            <Field label={reset ? 'Mật khẩu mới' : 'Mật khẩu'} required icon="lock" value={password} onChangeText={setPassword} secure autoComplete="new-password" textContentType="newPassword" error={pwError} hint="Từ 12 ký tự trở lên; có thể dùng cả câu dễ nhớ." />
            <Field label="Nhập lại mật khẩu" required icon="lock" value={confirm} onChangeText={setConfirm} secure autoComplete="new-password" error={confirm && confirm !== password ? 'Hai mật khẩu chưa khớp' : null} />
            <Button
              label={reset ? 'Gửi mã xác minh' : 'Tiếp tục'}
              disabled={!step1Ok}
              onPress={() => {
                setTouched(true);
                if (step1Ok) setStep(reset ? 3 : 2);
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
            <Button label="Đăng ký" disabled={!step2Ok} onPress={() => setStep(3)} />
            <T size={14} c={color.muted} style={{ textAlign: 'center' }}>
              Mã xác minh sẽ gửi qua SMS tới số của bạn.
            </T>
          </>
        )}

        {step === 3 && <OtpStep phone={phone} onChangePhone={() => setStep(1)} reset={reset} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function OtpStep({ phone, onChangePhone, reset }: { phone: string; onChangePhone: () => void; reset: boolean }) {
  const [digits, setDigits] = useState('');
  const [seconds, setSeconds] = useState(60);
  const [notice, setNotice] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);
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
      {notice && (
        <Notice
          kind="warn"
          title="Bản chạy thử chưa nối SMS"
          body={`Xác minh OTP qua Firebase thuộc giai đoạn B, chưa cấu hình nên ${reset ? 'mật khẩu chưa được đổi' : 'tài khoản chưa được tạo'}. Dữ liệu bạn nhập không gửi lên máy chủ.`}
        />
      )}
      <Button label="Xác minh" disabled={digits.length !== 6} onPress={() => setNotice(true)} />
    </>
  );
}
