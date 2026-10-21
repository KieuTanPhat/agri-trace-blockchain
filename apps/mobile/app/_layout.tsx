import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActivityIndicator, Text, View, AppState, Platform } from "react-native";
import { useEffect } from "react";
import { restoreNativeSession } from "../src/auth/use-auth";
import { colors, fonts } from "../src/theme/tokens";
import { useReducedMotionPreference } from "../src/theme/use-reduced-motion";
import { authScreenAnimation } from "../src/theme/auth-navigation";

export default function RootLayout() {
  useEffect(() => {
    restoreNativeSession();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") restoreNativeSession();
    });
    return () => listener.remove();
  }, []);
  const reducedMotion = useReducedMotionPreference();
  const authAnimation = authScreenAnimation(Platform.OS, reducedMotion);
  const [loaded, error] = useFonts({
    BeVietnamPro: require("../assets/fonts/BeVietnamPro-Regular.ttf"),
    BeVietnamProBold: require("../assets/fonts/BeVietnamPro-Bold.ttf"),
  });
  if (!loaded && !error)
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.green} />
        <Text>Đang mở ACheck…</Text>
      </View>
    );
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.forest,
          headerTitleStyle: { fontFamily: fonts.bold },
          headerBackTitle: "Quay lại",
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          animation: reducedMotion ? "none" : "slide_from_right",
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="trace/[token]"
          options={{ title: "Thông tin truy xuất" }}
        />
        <Stack.Screen name="history" options={{ title: "Lịch sử tra cứu" }} />
        <Stack.Screen name="news/index" options={{ title: "Bảng tin" }} />
        <Stack.Screen
          name="news/[id]"
          options={{ title: "Chi tiết bài viết" }}
        />
        <Stack.Screen
          name="announcements"
          options={{ title: "Thông báo hệ thống" }}
        />
        <Stack.Screen
          name="login"
          options={{ title: "Đăng nhập", headerShown: false, animation: authAnimation }}
        />
        <Stack.Screen
          name="legal"
          options={{ title: "Điều khoản và Chính sách" }}
        />
        <Stack.Screen
          name="register"
          options={{ title: "Đăng ký", headerShown: false, animation: authAnimation }}
        />
        <Stack.Screen
          name="forgot-password"
          options={{ title: "Quên mật khẩu", headerShown: false, animation: authAnimation }}
        />
        <Stack.Screen
          name="products/[id]"
          options={{ title: "Chi tiết sản phẩm" }}
        />
        <Stack.Screen
          name="enterprises/[id]"
          options={{ title: "Chi tiết doanh nghiệp" }}
        />
        <Stack.Screen
          name="+not-found"
          options={{ title: "Không tìm thấy trang" }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
