import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";

void SplashScreen.preventAutoHideAsync();

function Navigator() {
  const { id, colors, type } = useTheme();
  return (
    <>
      <StatusBar style={id === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: type["title-2"].fontFamily, fontSize: 17 },
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Tra cứu lô hàng" }} />
        <Stack.Screen name="trace/[token]" options={{ title: "Kết quả xác minh", contentStyle: { backgroundColor: colors.cream } }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    "BeVietnamPro-Regular": require("../assets/fonts/BeVietnamPro-Regular.ttf"),
    "BeVietnamPro-Medium": require("../assets/fonts/BeVietnamPro-Medium.ttf"),
    "BeVietnamPro-SemiBold": require("../assets/fonts/BeVietnamPro-SemiBold.ttf"),
    "BeVietnamPro-Bold": require("../assets/fonts/BeVietnamPro-Bold.ttf"),
    "BeVietnamPro-ExtraBold": require("../assets/fonts/BeVietnamPro-ExtraBold.ttf"),
  });

  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);

  // A font failure falls back to the system face rather than blocking the app.
  if (!loaded && !error) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Navigator />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
