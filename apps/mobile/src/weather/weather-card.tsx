import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Linking, Text } from "react-native";
import {
  Button,
  Card,
  KeyValue,
  Notice,
  SectionTitle,
  styles,
} from "../components/ui";
import { provinces } from "../locations";
import { LocationPicker } from "../locations/location-picker";
import { apiBaseUrl } from "../config";
import { createWeatherClient, type PublicWeather } from "../api/weather";
import { weatherLabel, weatherMetric, weatherTime } from "./presentation";
type State = {
  code: string;
  data: PublicWeather | null;
  loading: boolean;
  error: string;
};
export function WeatherCard() {
  const [province, setProvince] = useState(""),
    [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({
    code: "",
    data: null,
    loading: false,
    error: "",
  });
  const current =
    state.code === province
      ? state
      : { code: province, data: null, loading: Boolean(province), error: "" };
  useFocusEffect(
    useCallback(() => {
      if (!province) return;
      const controller = new AbortController();
      let active = true;
      setState({ code: province, data: null, loading: true, error: "" });
      void (async () => {
        try {
          const data = await createWeatherClient(
            apiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, __DEV__),
          ).get(province, controller.signal);
          if (active)
            setState({ code: province, data, loading: false, error: "" });
        } catch (error) {
          if (active)
            setState({
              code: province,
              data: null,
              loading: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Chưa lấy được thời tiết.",
            });
        }
      })();
      return () => {
        active = false;
        controller.abort();
      };
    }, [province, revision]),
  );
  useEffect(() => {
    if (!current.data) return;
    const timeout = setTimeout(
      () => setRevision((value) => value + 1),
      Math.max(1000, Date.parse(current.data.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [current.data]);
  const data = current.data;
  return (
    <Card>
      <SectionTitle>Thời tiết tham khảo</SectionTitle>
      <Text style={styles.body}>
        Chọn tỉnh/thành. App không xin GPS và không lưu lựa chọn vào hồ sơ.
      </Text>
      <LocationPicker
        label="Tỉnh/thành xem thời tiết"
        value={province}
        items={provinces}
        onSelect={setProvince}
      />
      {!province && (
        <Text style={styles.small}>Chưa chọn tỉnh/thành để lấy thời tiết.</Text>
      )}
      {current.loading && (
        <ActivityIndicator accessibilityLabel="Đang tải thời tiết" />
      )}
      {current.error ? (
        <>
          <Notice>{current.error}</Notice>
          <Button
            label="Thử lại thời tiết"
            secondary
            busy={current.loading}
            onPress={() => setRevision((value) => value + 1)}
          />
        </>
      ) : null}
      {data && (
        <>
          <Text style={styles.heading}>
            {data.provinceName} · {data.point.name}
          </Text>
          <Text style={styles.body}>
            Ước tính theo mô hình tại điểm đại diện, không đồng nhất toàn tỉnh.
          </Text>
          <Text style={styles.heading}>
            {weatherMetric(data.current.temperatureC, "°C")} ·{" "}
            {weatherLabel(data.current.weatherCode)}
          </Text>
          <KeyValue
            label="Độ ẩm"
            value={weatherMetric(data.current.humidityPercent, "%")}
          />
          <KeyValue
            label="Gió"
            value={weatherMetric(data.current.windKmh, "km/h")}
          />
          <Text style={styles.small}>
            Thời điểm mô hình: {weatherTime(data.current.time)} · Lấy lúc:{" "}
            {weatherTime(data.fetchedAt)} (giờ Việt Nam)
          </Text>
          <SectionTitle>Dự báo 3 ngày</SectionTitle>
          {data.daily.map((day) => (
            <Text key={day.date} style={styles.body}>
              {day.date.split("-").reverse().join("/")} ·{" "}
              {weatherLabel(day.weatherCode)}
              {"\n"}
              {weatherMetric(day.minimumC, "°C")} –{" "}
              {weatherMetric(day.maximumC, "°C")} · Khả năng mưa:{" "}
              {weatherMetric(day.precipitationProbabilityPercent, "%")}
            </Text>
          ))}
          <Text style={styles.small}>
            Nguồn: Open-Meteo; địa điểm từ GeoNames (CC BY 4.0). Dữ liệu tham
            khảo, không thay thế cảnh báo thiên tai.
          </Text>
          <Button
            label="Nguồn dữ liệu Open-Meteo"
            secondary
            onPress={() => {
              void Linking.openURL("https://open-meteo.com/").catch(() =>
                setState((previous) => ({
                  ...previous,
                  error: "Chưa mở được liên kết nguồn.",
                })),
              );
            }}
          />
          <Button
            label="Làm mới thời tiết"
            secondary
            busy={current.loading}
            onPress={() => setRevision((value) => value + 1)}
          />
        </>
      )}
    </Card>
  );
}
