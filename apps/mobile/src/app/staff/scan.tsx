import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Field, IconButton, Notice, T } from '../../components/ui';
import { parseTraceToken } from '../../lib/format';
import { color } from '../../theme/tokens';

/** Scan a lot label; the lot view resolves it inside the caller's scope. */
export default function StaffScan() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);
  const open = (raw: string) => {
    const token = parseTraceToken(raw);
    if (!token) return setError('Không phải mã lô AgriTrace.');
    if (handled.current) return;
    handled.current = true;
    router.replace({ pathname: '/staff/lot/[id]', params: { id: 'scan', token } });
  };
  return (
    <View style={{ flex: 1, backgroundColor: '#111' }}>
      {mode === 'camera' && permission?.granted && (
        <CameraView style={{ position: 'absolute', inset: 0 } as never} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => open(data)} />
      )}
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton name="close" label="Đóng" tint="#fff" bg="rgba(0,0,0,0.35)" onPress={() => (router.canGoBack() ? router.back() : router.replace('/staff'))} />
        <T size={19} weight="heavy" c="#fff">
          Quét mã lô
        </T>
        <View style={{ width: 46 }} />
      </View>
      <View style={{ flex: 1, padding: 20, paddingTop: 50, gap: 14 }}>
        {mode === 'manual' ? (
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 18, gap: 14 }}>
            <Field label="Mã trên tem" value={code} onChangeText={(v) => { setCode(v); setError(null); }} autoCapitalize="none" autoCorrect={false} placeholder="Dán mã hoặc liên kết truy xuất" error={error} />
            <Button label="Mở lô" onPress={() => open(code)} disabled={!code.trim()} />
          </View>
        ) : permission && !permission.granted ? (
          <>
            <Notice kind="info" title="Cần quyền camera" body="Camera chỉ dùng để đọc mã trên tem lô." />
            <Button label="Cho phép camera" onPress={() => void requestPermission()} />
          </>
        ) : (
          <View style={{ alignItems: 'center', gap: 20 }}>
            <View style={{ width: 230, height: 230, borderRadius: 24, borderWidth: 5, borderColor: '#3ccf62' }} />
            <T size={16} weight="bold" c="#fff">
              Đưa mã trên tem lô vào khung
            </T>
            {error && <Notice kind="error" title={error} />}
          </View>
        )}
      </View>
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 30, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.5)', padding: 5, flexDirection: 'row' }}>
        {(['camera', 'manual'] as const).map((m) => (
          <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} onPress={() => setMode(m)} style={{ flex: 1, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === m ? '#fff' : 'transparent' }}>
            <T size={15} weight="heavy" c={mode === m ? color.ink : '#fff'}>
              {m === 'camera' ? 'Quét' : 'Nhập mã'}
            </T>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
