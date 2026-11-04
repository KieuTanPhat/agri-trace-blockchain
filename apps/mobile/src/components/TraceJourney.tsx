import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import type { Schemas } from "../api/client";
import { Icon } from "./Icon";
import { DirectoryPhoto } from "./DirectoryCards";
import { Card, T } from "./ui";
import { date, dateTime } from "../lib/format";
import { color } from "../theme/tokens";
type Group = Schemas["PublicJourneyGroupDto"];
type JourneyEntry = Group["entries"][number];

function isCareJournal(entry: JourneyEntry) {
  return (
    /chăm sóc|nhật ký|nhật kí|care log|care activity/i.test(entry.title) ||
    entry.facts.some((fact) => fact.label === "Công việc")
  );
}

function entriesForDisplay(entries: JourneyEntry[], showAllCareLogs: boolean) {
  const careLogs = entries.filter(isCareJournal);
  if (careLogs.length <= 2 || showAllCareLogs) return entries;
  const visibleCareIds = new Set([careLogs[0].id, careLogs[careLogs.length - 1].id]);
  return entries.filter(
    (entry) => !isCareJournal(entry) || visibleCareIds.has(entry.id),
  );
}

function JourneyGroup({ group, index }: { group: Group; index: number }) {
  const [open, setOpen] = useState(index === 0);
  const [showAllCareLogs, setShowAllCareLogs] = useState(false);
  const careLogCount = group.entries.filter(isCareJournal).length;
  const displayedEntries = entriesForDisplay(group.entries, showAllCareLogs);
  return (
    <Card style={{ overflow: "hidden" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${open ? "Thu gọn" : "Xem chi tiết"} ${group.title}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ padding: 16, gap: 12 }}
      >
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 13,
              overflow: "hidden",
              backgroundColor: "#f0f6f2",
            }}
          >
            {group.company?.logoUrl ? (
              <DirectoryPhoto
                url={group.company.logoUrl}
                label={`Logo ${group.company.name}`}
              />
            ) : (
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="location" size={25} color={color.green} />
              </View>
            )}
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <T size={11.5} weight="bold" c={color.green}>
              {index + 1}. {group.stage}
            </T>
            <T size={16} weight="heavy">
              {group.title}
            </T>
            {group.address && (
              <T
                size={12.5}
                c={color.muted}
                numberOfLines={open ? undefined : 1}
              >
                {group.address}
              </T>
            )}
          </View>
          <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
            <Icon name="down" size={17} color={color.muted} />
          </View>
        </View>
        {!open && (
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            {group.photos[0] && (
              <View
                style={{
                  width: 66,
                  height: 46,
                  borderRadius: 7,
                  overflow: "hidden",
                }}
              >
                <DirectoryPhoto
                  url={group.photos[0].url}
                  label={group.photos[0].caption}
                  fit="cover"
                />
              </View>
            )}
            <T size={12} c={color.muted}>
              {group.entries.length} hoạt động
              {group.photos.length ? ` · ${group.photos.length} ảnh` : ""}
              {group.certificates.length
                ? ` · ${group.certificates.length} chứng nhận`
                : ""}
            </T>
            <T size={12} c={color.green}>
              Xem chi tiết
            </T>
          </View>
        )}
      </Pressable>
      {open && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 17, gap: 16 }}>
          {group.company && (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push(`/consumer/enterprise/${group.company!.id}`)
              }
              style={{
                borderTopWidth: 1,
                borderColor: color.line,
                paddingTop: 12,
                gap: 4,
              }}
            >
              <T size={13.5} weight="bold" c={color.blue}>
                {group.company.name} ›
              </T>
              {group.company.phone && (
                <T size={13} c={color.muted}>
                  Liên hệ: {group.company.phone}
                </T>
              )}
            </Pressable>
          )}
          {!!group.facts.length && (
            <View
              style={{
                backgroundColor: "#f5f9f6",
                borderRadius: 10,
                padding: 12,
                gap: 8,
              }}
            >
              {group.facts.map((f, i) => (
                <View key={i} style={{ gap: 2 }}>
                  <T size={12} c={color.muted}>
                    {f.label}
                  </T>
                  <T size={14} weight="bold">
                    {f.value}
                  </T>
                </View>
              ))}
            </View>
          )}
          {!!group.photos.length && (
            <View style={{ gap: 9 }}>
              <T size={14} weight="heavy">
                Hình ảnh tại đây
              </T>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10 }}
              >
                {group.photos.map((p) => (
                  <View key={p.id} style={{ width: 240, gap: 6 }}>
                    <View
                      style={{
                        height: 158,
                        borderRadius: 10,
                        overflow: "hidden",
                        backgroundColor: "#f3f5f3",
                      }}
                    >
                      <DirectoryPhoto
                        url={p.url}
                        label={p.caption}
                        fit="cover"
                      />
                    </View>
                    <T size={12} c={color.muted} numberOfLines={2}>
                      {p.caption}
                    </T>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
          <View style={{ gap: 14 }}>
            {displayedEntries.map((e) => (
              <View key={e.id} style={{ flexDirection: "row", gap: 11 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    marginTop: 6,
                    borderRadius: 4,
                    backgroundColor: color.green,
                  }}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <T size={14.5} weight="bold">
                    {e.title}
                  </T>
                  <T size={12} c={color.muted}>
                    {dateTime(e.time)}
                  </T>
                  {e.facts.map((f, i) => (
                    <T key={i} size={13} c={color.inkSoft}>
                      {f.label}: {f.value}
                    </T>
                  ))}
                </View>
              </View>
            ))}
            {careLogCount > 2 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  showAllCareLogs
                    ? "Thu gọn nhật ký chăm sóc"
                    : "Xem tất cả " + careLogCount + " nhật ký chăm sóc"
                }
                accessibilityState={{ expanded: showAllCareLogs }}
                onPress={() => setShowAllCareLogs((value) => !value)}
                style={({ pressed }) => ({
                  alignSelf: "flex-start",
                  paddingVertical: 4,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <T size={12.5} weight="bold" c={color.green}>
                  {showAllCareLogs
                    ? "Thu gọn nhật ký"
                    : "Xem tất cả " + careLogCount + " nhật ký chăm sóc"}
                </T>
              </Pressable>
            )}
          </View>
          {!!group.certificates.length && (
            <View
              style={{
                gap: 8,
                borderTopWidth: 1,
                borderColor: color.line,
                paddingTop: 12,
              }}
            >
              <T size={14} weight="heavy">
                Chứng nhận công khai tại giai đoạn này
              </T>
              {group.certificates.map((c, i) => (
                <View
                  key={i}
                  style={{
                    backgroundColor: "#f2f8f3",
                    padding: 12,
                    borderRadius: 9,
                    gap: 4,
                  }}
                >
                  <T size={14} weight="bold">
                    {c.type}
                  </T>
                  <T size={12.5} c={color.muted}>
                    Đơn vị cấp: {c.issuer}
                  </T>
                  <T size={12.5} c={color.muted}>
                    Ngày cấp: {date(c.issueDate)}
                    {c.expiryDate ? ` · Đến ${date(c.expiryDate)}` : ""}
                  </T>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </Card>
  );
}
export function TraceJourney({ groups }: { groups: Group[] }) {
  return (
    <View style={{ gap: 13 }}>
      {groups.map((g, i) => (
        <JourneyGroup key={g.id} group={g} index={i} />
      ))}
    </View>
  );
}
