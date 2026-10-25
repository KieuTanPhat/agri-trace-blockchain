import { useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button, styles } from "../components/ui";
import { colors, space } from "../theme/tokens";
import { filterLocations } from "./index";
import { SafeAreaView } from "react-native-safe-area-context";

export function LocationPicker({
  label,
  value,
  items,
  disabled,
  onSelect,
}: {
  label: string;
  value: string;
  items: { code: string; name: string; label: string }[];
  disabled?: boolean;
  onSelect(code: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  return (
    <View style={{ gap: space.sm }}>
      <Text style={styles.value}>{label}</Text>
      <Button
        label={
          items.find((item) => item.code === value)?.label ??
          `Chọn ${label.toLowerCase()}`
        }
        secondary
        disabled={disabled}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
      />
      <Modal
        visible={open}
        animationType="none"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: colors.background,
            padding: space.xl,
            gap: space.lg,
          }}
        >
          <Text accessibilityRole="header" style={styles.heading}>
            {label}
          </Text>
          <TextInput
            accessibilityLabel={`Tìm ${label.toLowerCase()}`}
            placeholder="Tìm theo tên"
            value={query}
            onChangeText={setQuery}
            maxLength={100}
            style={styles.input}
          />
          <FlatList
            data={filterLocations(items, query)}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.body}>Không có kết quả phù hợp.</Text>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: value === item.code }}
                onPress={() => {
                  onSelect(item.code);
                  setOpen(false);
                }}
                style={{ minHeight: 48, paddingVertical: space.md }}
              >
                <Text style={styles.value}>{item.label}</Text>
              </Pressable>
            )}
          />
          <Button
            label="Đóng danh sách"
            secondary
            onPress={() => setOpen(false)}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
