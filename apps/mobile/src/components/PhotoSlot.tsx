import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import { takePhoto, type Photo } from '../lib/staffApi';
import { color } from '../theme/staff';
import { Icon } from './staff/Icon';
import { T } from './staff/ui';

/** One evidence photo: camera on a phone, file picker in the web preview. */
export function PhotoSlot({ label, photo, onChange }: { label: string; photo: Photo | null; onChange: (p: Photo | null) => void }) {
  const pick = async () => {
    const next = (await takePhoto('camera').catch(() => null)) ?? (await takePhoto('library').catch(() => null));
    if (next) onChange(next);
  };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={photo ? `${label}: đổi ảnh` : `${label}: chụp ảnh`} onPress={() => void pick()} style={{ alignItems: 'center', gap: 6 }}>
      {photo ? (
        <Image source={{ uri: photo.uri }} style={{ width: 96, height: 96, borderRadius: 12 }} contentFit="cover" />
      ) : (
        <View style={{ width: 96, height: 96, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.field, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <Icon name="camera" size={24} color={color.green} />
          <T size={12.5} weight="bold" c={color.greenDeep}>
            Chụp
          </T>
        </View>
      )}
      <T size={12.5} weight="medium" c={color.inkSoft} style={{ maxWidth: 110, textAlign: 'center' }}>
        {label}
      </T>
    </Pressable>
  );
}
