import { View } from "react-native";

import { lotState, type LotState } from "../labels";
import { useTheme } from "../theme/ThemeProvider";
import { AppText } from "./AppText";
import { Icon } from "./Icon";
import { TONE_COLORS } from "./Tone";

/** Lot state as icon + word + color, so it reads without color vision and in sunlight. */
export function StateBadge({ state }: { state: LotState }) {
  const { colors, radius } = useTheme();
  const { label, tone } = lotState(state);
  const toneColors = TONE_COLORS[tone];
  return (
    <View
      accessibilityLabel={`Trạng thái: ${label}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 4,
        height: 28,
        paddingLeft: 8,
        paddingRight: 10,
        borderRadius: radius.sm,
        backgroundColor: colors[toneColors.bg],
      }}
    >
      <Icon name={toneColors.icon} size={14} strokeWidth={2.4} color={colors[toneColors.fg]} />
      <AppText variant="label" style={{ color: colors[toneColors.fg] }}>
        {label}
      </AppText>
    </View>
  );
}
