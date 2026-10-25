import { router } from "expo-router";
import {
  ArrowUpRight,
  History,
  Leaf,
  QrCode,
  ScanLine,
  Bell,
  Building2,
  Newspaper,
  Sprout,
} from "lucide-react-native";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  Button,
  Card,
  Screen,
  SectionTitle,
  styles,
} from "../../src/components/ui";
import { colors, fonts, space } from "../../src/theme/tokens";
import { WeatherCard } from "../../src/weather/weather-card";
import { mobileLayout } from "../../src/theme/layout";
import { GreenSurface } from "../../src/components/green-surface";

export default function HomeScreen() {
  const { width, fontScale } = useWindowDimensions();
  const layout = mobileLayout(width, fontScale);
  return (
    <Screen>
      <View style={home.header}>
        <Image
          source={require("../../assets/brand/logo-agritrace.webp")}
          accessibilityLabel="AgriTrace — Truy xuất nguồn gốc nông sản Việt"
          style={home.logo}
          resizeMode="contain"
        />
        <View style={home.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mở thông báo hệ thống"
            style={home.roundButton}
            onPress={() => router.push("/announcements")}
          >
            <Bell size={21} color={colors.forest} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mở lịch sử tra cứu"
            style={home.roundButton}
            onPress={() => router.push("/history")}
          >
            <History size={23} color={colors.forest} />
          </Pressable>
        </View>
      </View>
      <GreenSurface style={home.hero}>
        <View pointerEvents="none" style={home.heroCircle} />
        <View style={home.pill}>
          <Leaf size={14} color={colors.paper} />
          <Text style={home.eyebrow}>ACHECK · TRUY XUẤT NÔNG SẢN</Text>
        </View>
        <Text accessibilityRole="header" style={home.heroTitle}>
          Hiểu nguồn gốc.{"\n"}Chọn an tâm.
        </Text>
        <Text style={home.heroBody}>
          Một lần quét, xem hành trình nông sản từ nơi trồng đến nơi bạn chọn.
        </Text>
        <Button
          label="Quét mã truy xuất"
          onPress={() => router.navigate("/scan")}
          icon={<ScanLine color={colors.paper} size={23} />}
        />
        <Text style={home.heroFoot}>
          Tra cứu công khai · Không cần đăng nhập
        </Text>
      </GreenSurface>
      <StartSteps horizontal={layout.stepsHorizontal} />
      <View style={{ gap: space.lg }}>
        <View style={home.sectionHeading}>
          <SectionTitle>Khám phá cùng ACheck</SectionTitle>
          <Text style={styles.small}>Thông tin công khai</Text>
        </View>
        <View style={home.quickGrid}>
          {[
            {
              label: "Sản phẩm",
              detail: "Nông sản có mã truy xuất",
              icon: Sprout,
              route: "/products" as const,
            },
            {
              label: "Doanh nghiệp",
              detail: "Các đơn vị trong hành trình",
              icon: Building2,
              route: "/enterprises" as const,
            },
            {
              label: "Bảng tin",
              detail: "Nội dung từ AgriTrace",
              icon: Newspaper,
              route: "/news" as const,
            },
            {
              label: "Thông báo",
              detail: "Cập nhật từ hệ thống",
              icon: Bell,
              route: "/announcements" as const,
            },
          ].map(({ label, detail, icon: Icon, route }) => (
            <Pressable
              key={route}
              accessibilityRole="button"
              accessibilityLabel={`Mở ${label.toLowerCase()}`}
              onPress={() =>
                route === "/products" || route === "/enterprises"
                  ? router.navigate(route)
                  : router.push(route)
              }
              style={({ pressed }) => [
                home.quickTile,
                { width: layout.quickActionWidth },
                pressed && { backgroundColor: colors.pale, opacity: 0.85 },
              ]}
            >
              <View style={home.tileTop}>
                <View style={home.tileIcon}>
                  <Icon size={23} color={colors.green} />
                </View>
                <ArrowUpRight size={18} color={colors.muted} />
              </View>
              <Text style={styles.heading}>{label}</Text>
              <Text style={styles.small}>{detail}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Card>
        <View style={home.row}>
          <QrCode color={colors.green} size={26} />
          <SectionTitle>Không bật được camera?</SectionTitle>
        </View>
        <Text style={styles.body}>
          Bạn có thể dán mã hoặc đường dẫn truy xuất để xem thông tin.
        </Text>
        <Button
          label="Nhập mã thủ công"
          secondary
          onPress={() => router.navigate("/scan")}
        />
      </Card>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/history")}
        style={home.historyLink}
      >
        <View style={home.row}>
          <History size={22} color={colors.forest} />
          <Text style={styles.value}>Những mã bạn đã xem</Text>
        </View>
        <ArrowUpRight size={20} color={colors.green} />
      </Pressable>
      <WeatherCard />
      <Text style={[styles.small, { textAlign: "center" }]}>
        ACheck thuộc hệ thống AgriTrace.{"\n"}Thông tin truy xuất không thay thế
        chứng nhận an toàn thực phẩm.
      </Text>
    </Screen>
  );
}

function StartSteps({ horizontal }: { horizontal: boolean }) {
  return (
    <View style={{ gap: space.lg }}>
      <SectionTitle>Bắt đầu từ một mã QR</SectionTitle>
      <View
        style={[
          home.steps,
          horizontal && {
            flexDirection: "row",
            alignItems: "stretch",
            gap: 10,
          },
        ]}
      >
        {[
          ["01", "Quét mã", "Trên bao bì sản phẩm"],
          ["02", "Xem hành trình", "Nơi trồng, thu hoạch, giao nhận"],
          ["03", "Đọc cảnh báo", "Thu hồi, hạn dùng và dữ liệu"],
        ].map(([number, title, detail], index) => (
          <View
            key={number}
            style={[
              home.step,
              {
                backgroundColor: [colors.cream, colors.pale, colors.amberPale][
                  index
                ],
              },
              horizontal && {
                flex: 1,
                flexDirection: "column",
                alignItems: "flex-start",
                padding: 12,
                gap: 10,
              },
            ]}
          >
            <Text style={home.number}>{number}</Text>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.value}>{title}</Text>
              <Text style={styles.small}>{detail}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const home = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  logo: {
    width: 142,
    height: 70,
    backgroundColor: colors.paper,
    borderRadius: 12,
  },
  roundButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.paper,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.line,
  },
  hero: {
    backgroundColor: colors.forest,
    borderRadius: 28,
    padding: space.xl,
    gap: space.lg,
    overflow: "hidden",
  },
  heroCircle: {
    position: "absolute",
    width: 210,
    height: 210,
    borderRadius: 105,
    borderWidth: 35,
    borderColor: "rgba(255,255,255,0.04)",
    right: -100,
    top: -60,
  },
  sectionHeading: { gap: 4 },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: space.md,
  },
  quickTile: {
    backgroundColor: colors.paper,
    borderRadius: 20,
    padding: space.lg,
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  tileTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  tileIcon: { backgroundColor: colors.pale, borderRadius: 13, padding: 10 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
  },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: 9,
    letterSpacing: 1,
    color: colors.paper,
    lineHeight: 18,
  },
  heroTitle: {
    fontFamily: fonts.bold,
    color: colors.paper,
    fontSize: 32,
    lineHeight: 44,
  },
  heroBody: {
    fontFamily: fonts.regular,
    color: "#dcf3e5",
    fontSize: 14,
    lineHeight: 24,
  },
  heroFoot: {
    fontFamily: fonts.regular,
    color: "#dcf3e5",
    fontSize: 11,
    lineHeight: 20,
    textAlign: "center",
  },
  steps: { gap: space.md },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
  },
  number: {
    fontFamily: fonts.bold,
    color: colors.green,
    backgroundColor: "#dcf3e5",
    padding: 12,
    borderRadius: 14,
    fontSize: 14,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.md,
  },
  historyLink: {
    flexDirection: "row",
    gap: space.md,
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space.md,
    minHeight: 48,
  },
});
