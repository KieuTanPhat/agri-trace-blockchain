import Svg, { Path } from "react-native-svg";

// 24px, 2px-stroke glyphs drawn on the lucide grid. Swap for lucide-react-native when
// the icon set grows; names stay the same as the design system's Icon component.
const PATHS = {
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  clock: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M12 7v5l3.2 2"],
  alert: ["M12 3.5l9.5 16.5h-19z", "M12 10v4.5", "M12 17.5v.01"],
  x: ["M6 6l12 12", "M18 6L6 18"],
  box: ["M3 7.5l9-4 9 4v9l-9 4-9-4z", "M3 7.5l9 4 9-4", "M12 11.5v9"],
  truck: ["M2.5 6.5h11v9.5h-11z", "M13.5 9.5h4.2l3.3 3.4v3.1h-7.5", "M7 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4z", "M17 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4z"],
  store: ["M4 9l1.2-5h13.6L20 9", "M4 9h16v11H4z", "M9.5 20v-6h5v6"],
  leaf: ["M5 19C5 10.5 10.5 5 19 5c0 8.5-5.5 14-14 14z", "M5 19l7.5-7.5"],
  shield: ["M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6z", "M8.5 12l2.5 2.5 4.5-5"],
  thermo: ["M14 14.5V5a2 2 0 1 0-4 0v9.5a4 4 0 1 0 4 0z"],
  bell: ["M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z", "M10 21h4"],
  chevron: ["M9 6l6 6-6 6"],
  back: ["M15 6l-6 6 6 6"],
  refresh: ["M20 11a8 8 0 0 0-14.5-4.5L4 8", "M4 4v4h4", "M4 13a8 8 0 0 0 14.5 4.5L20 16", "M20 20v-4h-4"],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, color, strokeWidth = 2 }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {PATHS[name].map((d) => (
        <Path key={d} d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}
