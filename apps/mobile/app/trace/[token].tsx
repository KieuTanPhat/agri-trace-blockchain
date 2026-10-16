import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { getPublicTrace, type PublicLot } from "@/api/public-trace";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { ProofSeal } from "@/components/ProofSeal";
import { StateBadge } from "@/components/StateBadge";
import { formatDate, formatDateTime, formatQuantity, VERIFIED_DISCLAIMER, warningMessage } from "@/labels";
import { useTheme } from "@/theme/ThemeProvider";

type State = { kind: "loading" } | { kind: "missing" } | { kind: "error"; message: string } | { kind: "ready"; lot: PublicLot };

export default function TraceScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getPublicTrace(String(token), { signal: controller.signal })
      .then((lot) => setState(lot ? { kind: "ready", lot } : { kind: "missing" }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: error instanceof Error ? error.message : "Không tải được hành trình lô hàng" });
      });
    return () => controller.abort();
  }, [token, attempt]);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  if (state.kind === "loading") return <Skeleton />;
  if (state.kind === "missing")
    return (
      <Empty title="Không tìm thấy lô hàng" text="Mã này chưa được AgriTrace ghi nhận hoặc đã bị nhập sai.">
        <Button variant="secondary" icon="back" onPress={() => router.back()}>
          Nhập mã khác
        </Button>
      </Empty>
    );
  if (state.kind === "error")
    return (
      <Empty title="Chưa tải được hành trình" text={state.message}>
        <Button variant="secondary" icon="refresh" onPress={retry}>
          Thử lại
        </Button>
      </Empty>
    );
  return <TraceResult lot={state.lot} />;
}

function TraceResult({ lot }: { lot: PublicLot }) {
  const { colors, radius, space } = useTheme();
  const warnings = lot.warnings.map((code) => warningMessage(code, lot)).filter((message): message is string => !!message);
  const facts: [string, string][] = [
    ["Thu hoạch", formatDate(lot.harvestTime)],
    ["Khối lượng lô", formatQuantity(lot.initialQuantity, lot.unit)],
    ...(lot.expiryDate ? ([["Hạn dùng", formatDate(lot.expiryDate)]] as [string, string][]) : []),
    ...(lot.shipment ? ([["Nơi nhận", lot.shipment.destination]] as [string, string][]) : []),
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: space.s4, gap: space.s4, paddingBottom: space.s7 }}>
      {warnings.length ? (
        <Notice tone="danger" title="Cảnh báo lô hàng">
          <View style={{ gap: space.s1 }}>
            {warnings.map((message) => (
              <AppText key={message} variant="body-sm" color="ink-soft">
                {message}
              </AppText>
            ))}
          </View>
        </Notice>
      ) : null}

      <View style={{ gap: space.s1 }}>
        <AppText variant="display">{lot.productName}</AppText>
        <AppText variant="body-sm" color="muted">
          {lot.farmOrg.name} · {lot.lotCode}
        </AppText>
        <View style={{ marginTop: space.s2 }}>
          <StateBadge state={lot.currentState} />
        </View>
      </View>

      <ProofSeal
        status={lot.proofStatus}
        meta={lot.blockchainProof?.txId ? `Giao dịch ${shortHash(lot.blockchainProof.txId)}` : undefined}
      />
      <AppText variant="caption" color="muted" style={{ marginTop: -space.s2 }}>
        {VERIFIED_DISCLAIMER}
      </AppText>

      <View style={{ padding: space.s4, gap: space.s2, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
        {facts.map(([label, value]) => (
          <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.s4 }}>
            <AppText variant="body-sm" color="muted">
              {label}
            </AppText>
            <AppText variant="body-sm" style={{ flexShrink: 1, textAlign: "right" }}>
              {value}
            </AppText>
          </View>
        ))}
      </View>

      <AppText variant="title-2" accessibilityRole="header">
        Hành trình
      </AppText>
      <View>
        {lot.timeline.map((event, index) => (
          <View key={event.eventId} style={{ flexDirection: "row", gap: space.s3 }}>
            <View style={{ alignItems: "center", width: 16 }}>
              <View style={{ width: 12, height: 12, marginTop: 4, borderRadius: radius.full, backgroundColor: colors.primary }} />
              {index < lot.timeline.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: colors.line }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: space.s5, gap: 2 }}>
              <AppText variant="caption" color="muted">
                {formatDateTime(event.eventTime)}
              </AppText>
              <AppText variant="headline">{event.summary}</AppText>
              <AppText variant="body-sm" color="ink-soft">
                {event.actor.organizationName}
              </AppText>
              <View style={{ marginTop: space.s1 }}>
                <ProofSeal status={event.proofStatus} compact />
              </View>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Skeleton() {
  const { colors, radius, space } = useTheme();
  const block = (height: number, width: number | `${number}%` = "100%") => (
    <View style={{ height, width, borderRadius: radius.md, backgroundColor: colors["surface-sunken"] }} />
  );
  return (
    <View accessibilityLabel="Đang tải hành trình lô hàng" style={{ padding: space.s4, gap: space.s4 }}>
      {block(38, "70%")}
      {block(18, "50%")}
      {block(92)}
      {block(120)}
    </View>
  );
}

function Empty({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  const { space } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.s6, gap: space.s3 }}>
      <AppText variant="title-2" style={{ textAlign: "center" }}>
        {title}
      </AppText>
      <AppText color="muted" style={{ textAlign: "center" }}>
        {text}
      </AppText>
      {children}
    </View>
  );
}

function shortHash(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
