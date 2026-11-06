import { View } from 'react-native';
import type { Photo } from '../lib/staffApi';
import { color } from '../theme/staff';
import { PhotoSlot } from './PhotoSlot';
import { T } from './staff/ui';

/** Several evidence photos: tap a photo to replace it, the empty slot to add one. */
export function PhotoStrip({ label, photos, onChange, required, max = 3 }: {
  label: string; photos: Photo[]; onChange: (photos: Photo[]) => void; required?: boolean; max?: number;
}) {
  return (
    <View style={{ gap: 6 }}>
      <T size={14} weight="bold">{label}{required ? ' *' : ''}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {photos.map((photo, i) => (
          <PhotoSlot key={photo.uri} label={`Ảnh ${i + 1}`} photo={photo}
            onChange={(next) => onChange(next ? photos.map((p, j) => (j === i ? next : p)) : photos.filter((_, j) => j !== i))} />
        ))}
        {photos.length < max && <PhotoSlot label="Thêm ảnh" photo={null} onChange={(next) => next && onChange([...photos, next])} />}
      </View>
      <T size={12.5} c={color.muted}>Ảnh chỉ các bên của chuyến hàng xem được; mã băm ảnh được ghi cùng sự kiện.</T>
    </View>
  );
}
