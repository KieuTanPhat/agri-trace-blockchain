import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, AppState, Easing, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useReducedMotionPreference } from "../theme/use-reduced-motion";
import { colors } from "../theme/tokens";

function useAmbientProgress(kind: "pulse" | "scan") {
  const reduced = useReducedMotionPreference();
  const progress = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(
    AppState.currentState !== "background" &&
      AppState.currentState !== "inactive",
  );
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => listener.remove();
  }, []);
  useEffect(() => {
    progress.stopAnimation();
    progress.setValue(kind === "scan" ? 0.5 : 0);
    if (!focused || !foreground || reduced) return;
    progress.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: kind === "scan" ? 1300 : 2100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: kind === "scan" ? 1300 : 300,
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
      { iterations: kind === "scan" ? -1 : 3 },
    );
    animation.start();
    return () => animation.stop();
  }, [focused, foreground, reduced, kind, progress]);
  return { progress, reduced, active: focused && foreground };
}
export function QrPulse() {
  const { progress, reduced, active } = useAmbientProgress("pulse");
  if (reduced || !active) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      style={[
        motion.pulse,
        {
          opacity: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.25, 0],
          }),
          transform: [
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 1.35],
              }),
            },
          ],
        },
      ]}
    />
  );
}
/** Mounted only while the real camera is active. Static line under reduced motion. */
export function ScanOverlay() {
  const { progress } = useAmbientProgress("scan");
  const [height, setHeight] = useState(200);
  return (
    <View
      pointerEvents="none"
      accessible={false}
      style={motion.frame}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
    >
      <View
        style={[
          motion.corner,
          {
            top: 0,
            left: 0,
            borderTopWidth: 3,
            borderLeftWidth: 3,
            borderTopLeftRadius: 16,
          },
        ]}
      />
      <View
        style={[
          motion.corner,
          {
            top: 0,
            right: 0,
            borderTopWidth: 3,
            borderRightWidth: 3,
            borderTopRightRadius: 16,
          },
        ]}
      />
      <View
        style={[
          motion.corner,
          {
            bottom: 0,
            left: 0,
            borderBottomWidth: 3,
            borderLeftWidth: 3,
            borderBottomLeftRadius: 16,
          },
        ]}
      />
      <View
        style={[
          motion.corner,
          {
            bottom: 0,
            right: 0,
            borderBottomWidth: 3,
            borderRightWidth: 3,
            borderBottomRightRadius: 16,
          },
        ]}
      />
      <Animated.View
        style={[
          motion.laser,
          {
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [16, Math.max(16, height - 20)],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}
const motion = StyleSheet.create({
  pulse: {
    position: "absolute",
    width: 50,
    height: 50,
    borderRadius: 21,
    backgroundColor: colors.leaf,
  },
  frame: {
    width: "76%",
    height: "76%",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  corner: {
    position: "absolute",
    width: 28,
    height: 28,
    borderColor: "#6ee7b7",
  },
  laser: {
    position: "absolute",
    top: 0,
    left: 12,
    right: 12,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#6ee7b7",
    opacity: 0.9,
  },
});
