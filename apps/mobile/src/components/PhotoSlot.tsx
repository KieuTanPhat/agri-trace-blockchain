import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import { takePhoto, type Photo } from '../lib/staffApi';
import { color } from '../theme/tokens';
import { Icon } from './Icon';
import { T } from './ui';

/** One evidence photo: camera on a phone, file picker in the web preview. */
export function PhotoSlot({ label, photo, onChange }: { label: string; photo: Photo | null; onChange: (p: Photo | null) => void }) {
  const pick = async () => {
    const next = (await takePhoto('camera').catch(() => null)) ?? (await takePhoto('library').catch(() => null));
    if (next) onChange(next);
  };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={photo ? `${label}: đổi ảnh` : `${label}: chụp ảnh`} onPress={() => void pick()} style={{ alignItems: 'center', gap: 6 }}>
      {photo ? (
        <Image source={{ uri: photo.uri }} style={{ width: 96, height: 96, borderRadius: 14 }} contentFit="cover" />
      ) : (
        <View style={{ width: 96, height: 96, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: '#f2a20c', backgroundColor: '#fff8ea', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <Icon name="camera" size={28} color="#f59e0b" />
          <T size={12.5} weight="heavy" c={color.orangeDeep}>
            Chụp
          </T>
        </View>
      )}
      <T size={13} weight="bold" c={color.inkSoft} style={{ maxWidth: 110, textAlign: 'center' }}>
        {label}
      </T>
    </Pressable>
  );
}
