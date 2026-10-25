import { useEffect, useState } from "react";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import {
  Building2,
  House,
  QrCode,
  Sprout,
  UserRound,
} from "lucide-react-native";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, space } from "../theme/tokens";
import { consumerTabs } from "../theme/layout";
import { activateConsumerTab } from "../theme/tab-actions";
import { QrPulse } from "./ambient-motion";
import { GreenSurface } from "./green-surface";

const icons = {
  index: House,
  enterprises: Building2,
  scan: QrCode,
  products: Sprout,
  account: UserRound,
};
export function BottomNavigation({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardOpen(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return (
    <View
      accessibilityElementsHidden={keyboardOpen}
      importantForAccessibility={keyboardOpen ? "no-hide-descendants" : "auto"}
      pointerEvents={keyboardOpen ? "none" : "auto"}
      style={[
        bar.shell,
        {
          paddingBottom: Math.max(insets.bottom, 8),
          paddingLeft: Math.max(insets.left, 8),
          paddingRight: Math.max(insets.right, 8),
        },
        keyboardOpen && {
          height: 0,
          paddingTop: 0,
          paddingBottom: 0,
          borderTopWidth: 0,
          opacity: 0,
          overflow: "hidden",
        },
      ]}
    >
      <View style={bar.row}>
        {consumerTabs.map(({ name, title }) => {
          const route = state.routes.find((item) => item.name === name);
          if (!route) return null;
          const selected = state.routes[state.index].key === route.key;
          const central = name === "scan";
          const Icon = icons[name];
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={title}
              accessibilityState={{ selected }}
              aria-selected={selected}
              onPress={() => {
                activateConsumerTab(
                  selected,
                  () =>
                    navigation.emit({
                      type: "tabPress",
                      target: route.key,
                      canPreventDefault: true,
                    }),
                  () => {
                    Keyboard.dismiss();
                    navigation.navigate(route.name, route.params);
                  },
                );
              }}
              onLongPress={() =>
                navigation.emit({ type: "tabLongPress", target: route.key })
              }
              style={({ pressed }) => [
                bar.item,
                selected && !central && bar.selected,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View
                style={[
                  bar.icon,
                  central && bar.scan,
                  central && selected && bar.scanSelected,
                ]}
              >
                {central && (
                  <>
                    <QrPulse />
                    <GreenSurface
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0,
                        borderRadius: 16,
                      }}
                    />
                  </>
                )}
                <Icon
                  style={{ zIndex: 1 }}
                  size={central ? 26 : 22}
                  strokeWidth={selected ? 2.5 : 1.8}
                  color={
                    central
                      ? colors.paper
                      : selected
                        ? colors.green
                        : colors.muted
                  }
                />
              </View>
              <Text style={[bar.label, selected && bar.selectedLabel]}>
                {title}
              </Text>
              <View style={[bar.indicator, { opacity: selected ? 1 : 0 }]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
const bar = StyleSheet.create({
  shell: {
    backgroundColor: colors.paper,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 3,
    maxWidth: 680,
    width: "100%",
    alignSelf: "center",
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 72,
    paddingHorizontal: 2,
    paddingVertical: 5,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 3,
  },
  selected: { backgroundColor: colors.pale },
  icon: {
    height: 38,
    minWidth: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  scan: {
    backgroundColor: colors.green,
    height: 44,
    width: 48,
    borderRadius: 16,
    marginTop: -6,
  },
  scanSelected: {
    backgroundColor: colors.forest,
    borderWidth: 2,
    borderColor: colors.amber,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    minHeight: 32,
    color: colors.muted,
    textAlign: "center",
    flexShrink: 1,
  },
  selectedLabel: { color: colors.forest, fontFamily: fonts.bold },
  indicator: {
    width: 12,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.green,
    marginTop: space.xs,
  },
});
