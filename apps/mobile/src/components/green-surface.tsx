import { useId, type PropsWithChildren } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

/** Native/vector background: no remote CSS, fonts, script or bitmap assets. */
export function GreenSurface({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const id = `green-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  return (
    <View style={[{ backgroundColor: "#06371e", overflow: "hidden" }, style]}>
      <Svg
        pointerEvents="none"
        accessible={false}
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
      >
        <Defs>
          <LinearGradient id={id} x1="100%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0" stopColor="#17824d" />
            <Stop offset="0.55" stopColor="#0b4f2d" />
            <Stop offset="1" stopColor="#06371e" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
}
