import { Image } from 'expo-image';
import { View } from 'react-native';

type Variant = 'staff' | 'consumer';
const brands = {
  staff: { logo: require('../../assets/brand/agritrace-staff-logo-v1.png'), label: 'AgriTrace Nhân viên' },
  consumer: { logo: require('../../assets/brand/acheck-consumer-logo-v1.png'), label: 'ACheck Người dùng' },
} as const;

/** Same 3:1 canvas for both lockups; respect narrow screens and font scaling. */
export function BrandLogo({ variant, maxWidth = 288, align = 'center' }: {
  variant: Variant;
  maxWidth?: number;
  align?: 'center' | 'start';
}) {
  return (
    <View style={{ width: '100%', maxWidth, minWidth: 0, flexShrink: 1, aspectRatio: 3, alignSelf: align === 'start' ? 'flex-start' : 'center' }}>
      <Image source={brands[variant].logo} contentFit="contain" contentPosition="center" accessibilityLabel={brands[variant].label} style={{ width: '100%', height: '100%' }} />
    </View>
  );
}

export function BrandLoading({ variant }: { variant: Variant }) {
  return (
    <View style={{ flex: 1, backgroundColor: variant === 'staff' ? '#eff8ec' : '#ffffff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
      <BrandLogo variant={variant} maxWidth={288} />
    </View>
  );
}
