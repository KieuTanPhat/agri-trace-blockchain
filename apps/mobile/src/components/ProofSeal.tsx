import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { proofStatus, type ProofStatus } from "../labels";
import { useTheme } from "../theme/ThemeProvider";
import { AppText } from "./AppText";
import { TONE_COLORS } from "./Tone";

const STAR = "M22 9.5l3.6 7.6 8.3 1-6.1 5.7 1.6 8.2L22 28l-7.4 4 1.6-8.2-6.1-5.7 8.3-1z";
const GLYPH = { danger: "M22 13v11M22 30v.5", warning: "M22 13v9l5 3", neutral: "M15 22h14" } as const;

type Props = { status: ProofStatus; compact?: boolean; meta?: string };

/**
 * Whether the record matches its anchored evidence. The forest disc with the amber
 * star appears only for VERIFIED; it never stands for product quality.
 */
export function ProofSeal({ status, compact, meta }: Props) {
  const { colors, radius, space } = useTheme();
  const proof = proofStatus(status);
  const tone = TONE_COLORS[proof.tone];
  const size = compact ? 28 : 44;
  const verified = status === "VERIFIED";
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`${proof.label}. ${compact ? "" : proof.description}`}
      style={[
        { flexDirection: "row", alignItems: compact ? "center" : "flex-start", gap: compact ? space.s2 : space.s3 },
        compact ? null : { padding: space.s4, borderRadius: radius.lg, backgroundColor: colors[tone.bg] },
      ]}
    >
      <Svg width={size} height={size} viewBox="0 0 44 44">
        <Circle cx={22} cy={22} r={21} fill={verified ? colors.forest : colors[tone.fg]} />
        {verified ? (
          <Path d={STAR} fill={colors.accent} />
        ) : (
          <Path
            d={GLYPH[proof.tone as keyof typeof GLYPH] ?? GLYPH.neutral}
            stroke={colors[tone.bg]}
            strokeWidth={3.2}
            strokeLinecap="round"
            fill="none"
          />
        )}
      </Svg>
      <View style={{ flex: compact ? undefined : 1, gap: 2 }}>
        <AppText variant={compact ? "label" : "headline"} style={{ color: colors[tone.fg] }}>
          {proof.label}
        </AppText>
        {compact ? null : <AppText variant="body-sm" color="ink-soft">{proof.description}</AppText>}
        {!compact && meta ? (
          <AppText variant="caption" color="muted">
            {meta}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}
