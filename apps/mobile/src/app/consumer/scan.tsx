import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import { Button, Field, IconButton, Notice, T } from '../../components/ui';
import { parseTraceToken } from '../../lib/format';
import { color } from '../../theme/tokens';

/** Camera when permitted; manual code entry always available. */
export default function Scan() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [torch, setTorch] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const last = useRef<{ token: string; at: number } | null>(null);

  const open = (raw: string) => {
    const token = parseTraceToken(raw);
    if (!token) {
      setError('Mã này không phải mã truy xuất AgriTrace.');
      return;
    }
    // Ignore the same code read again within a few seconds.
    if (last.current && last.current.token === token && Date.now() - last.current.at < 3000) return;
    last.current = { token, at: Date.now() };
    router.replace(`/consumer/trace/${token}`);
  };

  const camera = mode === 'camera' && permission?.granted;
  return (
    <View style={{ flex: 1, backgroundColor: '#111' }}>
      {camera && (
        <CameraView
          style={{ position: 'absolute', inset: 0 } as never}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => open(data)}
        />
      )}
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton name="close" label="Đóng" tint="#fff" bg="rgba(0,0,0,0.35)" onPress={() => (router.canGoBack() ? router.back() : router.replace('/consumer'))} />
        <T size={19} weight="heavy" c="#fff">
          Quét mã truy xuất
        </T>
        <View style={{ width: 46 }} />
      </View>

      {mode === 'camera' ? (
        <View style={{ flex: 1, alignItems: 'center', paddingTop: 60 }}>
          {permission && !permission.granted ? (
            <View style={{ marginHorizontal: 24, gap: 14, alignSelf: 'stretch' }}>
              <Notice kind="info" title="Cần quyền camera để quét" body="Camera chỉ dùng để đọc mã QR trên tem. Bạn vẫn có thể nhập mã tay." />
              <Button label="Cho phép camera" onPress={() => void requestPermission()} />
            </View>
          ) : (
            <>
              <View style={{ width: 264, height: 264 }}>
                {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                  <View
                    key={c}
                    style={{
                      position: 'absolute',
                      width: 56,
                      height: 56,
                      borderColor: '#3ccf62',
                      [c[0] === 't' ? 'top' : 'bottom']: 0,
                      [c[1] === 'l' ? 'left' : 'right']: 0,
                      [c[0] === 't' ? 'borderTopWidth' : 'borderBottomWidth']: 6,
                      [c[1] === 'l' ? 'borderLeftWidth' : 'borderRightWidth']: 6,
                      [`border${c[0] === 't' ? 'Top' : 'Bottom'}${c[1] === 'l' ? 'Left' : 'Right'}Radius`]: 22,
                    }}
                  />
                ))}
              </View>
              <T size={16} weight="bold" c="#fff" style={{ marginTop: 22, textAlign: 'center' }}>
                Đưa mã QR trên tem vào giữa khung
              </T>
              {error && (
                <View style={{ marginTop: 16, marginHorizontal: 24 }}>
                  <Notice kind="error" title={error} />
                </View>
              )}
            </>
          )}
        </View>
      ) : (
        <View style={{ flex: 1, padding: 20, gap: 14 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 18, gap: 14 }}>
            <Field label="Mã in dưới QR" value={code} onChangeText={(v) => { setCode(v); setError(null); }} autoCapitalize="none" autoCorrect={false} placeholder="Dán mã hoặc liên kết truy xuất" error={error} />
            <Button label="Tra cứu" onPress={() => open(code)} disabled={!code.trim()} />
          </View>
        </View>
      )}

      {mode === 'camera' && permission?.granted && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 110, flexDirection: 'row', justifyContent: 'center' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={torch ? 'Tắt đèn pin' : 'Bật đèn pin'} onPress={() => setTorch(!torch)} style={{ alignItems: 'center', gap: 6 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: torch ? color.orange : 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="flash" color="#fff" />
            </View>
            <T size={13} weight="bold" c="#fff">
              Đèn pin
            </T>
          </Pressable>
        </View>
      )}

      <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 30, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.5)', padding: 5, flexDirection: 'row' }}>
        {(['camera', 'manual'] as const).map((m) => (
          <Pressable
            key={m}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
            onPress={() => { setMode(m); setError(null); }}
            style={{ flex: 1, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === m ? '#fff' : 'transparent' }}
          >
            <T size={15} weight="heavy" c={mode === m ? color.ink : '#fff'}>
              {m === 'camera' ? 'Quét QR' : 'Nhập mã'}
            </T>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
