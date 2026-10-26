import { Platform } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Decorative graphics: hidden from screen readers on every platform. */
export const decorative = (Platform.OS === 'web'
  ? { 'aria-hidden': true }
  : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' }) as object;

/**
 * Glyphs from the approved canvas. Solid ones take `color` (tab bar, buttons);
 * the `*Tile` variants are the multi-colour drawings used in icon tiles.
 */
export type IconName =
  | 'home'
  | 'building'
  | 'box'
  | 'user'
  | 'bell'
  | 'scan'
  | 'search'
  | 'back'
  | 'close'
  | 'chevron'
  | 'down'
  | 'share'
  | 'phone'
  | 'lock'
  | 'mail'
  | 'eye'
  | 'eyeOff'
  | 'check'
  | 'alert'
  | 'info'
  | 'clock'
  | 'journal'
  | 'truck'
  | 'more'
  | 'leaf'
  | 'basket'
  | 'store'
  | 'camera'
  | 'pen'
  | 'flash'
  | 'image'
  | 'sun'
  | 'logout'
  | 'sync'
  | 'location';

type Props = { name: IconName; size?: number; color?: string };

export function Icon({ name, size = 24, color = '#1f2a37' }: Props) {
  const stroke = {
    fill: 'none',
    stroke: color,
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...decorative}>
      {(() => {
        switch (name) {
          case 'location':
            return <><Path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" {...stroke}/><Circle cx="12" cy="10" r="2.5" {...stroke}/></>;
          case 'home':
            return <Path d="M3 10.5 12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H4.5A1.5 1.5 0 0 1 3 20z" fill={color} />;
          case 'building':
            return (
              <>
                <Path d="M3 21V4.5A1.5 1.5 0 0 1 4.5 3h8A1.5 1.5 0 0 1 14 4.5V21zM15 21V9h4.5A1.5 1.5 0 0 1 21 10.5V21z" fill={color} />
                <Path d="M6 7h2M9.5 7h2M6 10.5h2M9.5 10.5h2M6 14h2M9.5 14h2" stroke="#fff" strokeWidth={1.5} />
              </>
            );
          case 'box':
            return (
              <>
                <Path d="M12 2 3 6.5v11L12 22l9-4.5v-11z" fill={color} />
                <Path d="M3 6.5 12 11l9-4.5M12 11v11" stroke="#fff" strokeWidth={1.4} fill="none" />
              </>
            );
          case 'user':
            return (
              <>
                <Circle cx={12} cy={8} r={4.5} fill={color} />
                <Path d="M3.5 21c.8-4.4 4.2-7 8.5-7s7.7 2.6 8.5 7z" fill={color} />
              </>
            );
          case 'bell':
            return (
              <>
                <Path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5c0 5.5-2.5 7.5-2.5 7.5h18s-2.5-2-2.5-7.5A6.5 6.5 0 0 0 12 2.5z" fill={color} />
                <Path d="M9.5 19.5a2.6 2.6 0 0 0 5 0z" fill={color} />
              </>
            );
          case 'scan':
            return <Path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16M7 12h10" {...stroke} strokeWidth={2.4} />;
          case 'search':
            return (
              <>
                <Circle cx={11} cy={11} r={7} {...stroke} strokeWidth={2.6} />
                <Path d="M20 20l-3.5-3.5" {...stroke} strokeWidth={2.6} />
              </>
            );
          case 'back':
            return <Path d="M19 12H5M11 6l-6 6 6 6" {...stroke} strokeWidth={2.4} />;
          case 'close':
            return <Path d="M18 6 6 18M6 6l12 12" {...stroke} strokeWidth={2.4} />;
          case 'chevron':
            return <Path d="M9 6l6 6-6 6" {...stroke} />;
          case 'down':
            return <Path d="M6 9l6 6 6-6" {...stroke} strokeWidth={2.4} />;
          case 'share':
            return <Path d="M14 4l7 7-7 7M21 11H10a7 7 0 0 0-7 7" {...stroke} />;
          case 'phone':
            return <Path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" {...stroke} strokeWidth={1.9} />;
          case 'lock':
            return (
              <>
                <Rect x={4} y={10} width={16} height={11} rx={3} {...stroke} strokeWidth={1.9} />
                <Path d="M8 10V7a4 4 0 0 1 8 0v3" {...stroke} strokeWidth={1.9} />
              </>
            );
          case 'mail':
            return (
              <>
                <Rect x={3} y={5} width={18} height={14} rx={3} {...stroke} strokeWidth={1.9} />
                <Path d="m4 7 8 6 8-6" {...stroke} strokeWidth={1.9} />
              </>
            );
          case 'eye':
            return (
              <>
                <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" {...stroke} strokeWidth={1.9} />
                <Circle cx={12} cy={12} r={3} {...stroke} strokeWidth={1.9} />
              </>
            );
          case 'eyeOff':
            return (
              <>
                <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" {...stroke} strokeWidth={1.9} />
                <Circle cx={12} cy={12} r={3} {...stroke} strokeWidth={1.9} />
                <Path d="M3 3l18 18" {...stroke} strokeWidth={1.9} />
              </>
            );
          case 'check':
            return (
              <>
                <Circle cx={12} cy={12} r={10} fill={color} />
                <Path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </>
            );
          case 'alert':
            return (
              <>
                <Path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" fill={color} />
                <Path d="M12 9v4.5M12 17.2h.01" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
              </>
            );
          case 'info':
            return (
              <>
                <Circle cx={12} cy={12} r={10} fill={color} />
                <Path d="M12 11v5.5M12 7.6h.01" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
              </>
            );
          case 'clock':
            return (
              <>
                <Circle cx={12} cy={12} r={9.5} fill={color} />
                <Path d="M12 7v5.2l3.4 2" stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" />
              </>
            );
          case 'journal':
            return (
              <>
                <Rect x={4} y={3} width={16} height={19} rx={3} fill={color} />
                <Path d="M8 9h8M8 13h8M8 17h5" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
              </>
            );
          case 'truck':
            return (
              <>
                <Path d="M2 6.5A1.5 1.5 0 0 1 3.5 5H14v12H2zM14 9h4l4 4.5V17h-8z" fill={color} />
                <Circle cx={6.5} cy={18} r={2.4} fill={color} stroke="#fff" strokeWidth={1.4} />
                <Circle cx={17.5} cy={18} r={2.4} fill={color} stroke="#fff" strokeWidth={1.4} />
              </>
            );
          case 'more':
            return (
              <>
                <Rect x={3} y={3} width={18} height={18} rx={5} fill={color} />
                <Circle cx={8} cy={12} r={1.6} fill="#fff" />
                <Circle cx={12} cy={12} r={1.6} fill="#fff" />
                <Circle cx={16} cy={12} r={1.6} fill="#fff" />
              </>
            );
          case 'leaf':
            return <Path d="M12 22c0-6 2-10 8-12-1 6-4 10-8 12zM12 22C12 16 10 12 4 10c1 6 4 10 8 12z" fill={color} />;
          case 'basket':
            return (
              <>
                <Path d="M4 9h16l-1.6 11a1.5 1.5 0 0 1-1.5 1.3H7.1a1.5 1.5 0 0 1-1.5-1.3z" fill={color} />
                <Path d="M8 9a4 4 0 0 1 8 0" stroke={color} strokeWidth={2.2} fill="none" />
              </>
            );
          case 'store':
            return <Path d="M3 9.5 4.8 4h14.4L21 9.5zM4 11h16v9.5a1 1 0 0 1-1 1h-5v-5h-4v5H5a1 1 0 0 1-1-1z" fill={color} />;
          case 'camera':
            return (
              <>
                <Path d="M9 4h6l1.8 2.5H20a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h3.2z" fill={color} />
                <Circle cx={12} cy={13} r={3.4} fill="#fff" />
              </>
            );
          case 'pen':
            return <Path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" {...stroke} />;
          case 'flash':
            return <Path d="M7 2h10v4l-2 4v11a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V10L7 6z" fill={color} />;
          case 'image':
            return (
              <>
                <Rect x={3} y={4} width={18} height={16} rx={3} fill={color} />
                <Circle cx={9} cy={10} r={2} fill="#333" />
                <Path d="M4 18l5-5 3 3 3-4 5 6z" fill="#333" />
              </>
            );
          case 'sun':
            return (
              <>
                <Circle cx={12} cy={12} r={4.5} fill={color} />
                <Path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke={color} strokeWidth={2} strokeLinecap="round" />
              </>
            );
          case 'logout':
            return (
              <>
                <Rect x={3} y={3} width={18} height={18} rx={4} fill={color} />
                <Path d="M13 8H9v8h4M12 12h5M15 9.5 17.5 12 15 14.5" stroke="#fff" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </>
            );
          case 'sync':
            return (
              <>
                <Circle cx={12} cy={12} r={10} fill={color} />
                <Path d="M8 12a4 4 0 0 1 7-2.6M16 12a4 4 0 0 1-7 2.6M15 6.5v3h-3M9 17.5v-3h3" stroke="#fff" strokeWidth={1.7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </>
            );
        }
      })()}
    </Svg>
  );
}
