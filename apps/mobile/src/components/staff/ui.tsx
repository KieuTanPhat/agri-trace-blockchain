import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, shadow, space, tone, type Tone, noOutline } from '../../theme/staff';
import { Icon, type IconName } from './Icon';

type Weight = keyof typeof font;
export function T({
  size = 14,
  weight = 'regular',
  c = color.ink,
  style,
  ...rest
}: TextProps & { size?: number; weight?: Weight; c?: string }) {
  return (
    <RNText
      {...rest}
      style={[{ fontFamily: font[weight], fontSize: size, lineHeight: Math.round(size * 1.42), color: c }, style]}
    />
  );
}

/**
 * Screen header: a white app bar with a left-aligned title (operations-app
 * style). `brand` paints it green for the consumer landing screens; content
 * passed as children sits under the title inside the bar.
 */
export function Header({
  title,
  subtitle,
  back,
  right,
  children,
  brand,
  overlap = 0,
}: {
  title?: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
  children?: ReactNode;
  brand?: boolean;
  /** Extra bottom space for a card that overlaps the bar (negative marginTop). */
  overlap?: number;
}) {
  const insets = useSafeAreaInsets();
  const fg = brand ? '#fff' : color.ink;
  return (
    <View
      style={{
        backgroundColor: brand ? color.green : color.surface,
        paddingTop: insets.top + 6,
        paddingBottom: (children ? space.md : 6) + overlap,
        paddingHorizontal: space.sm,
        borderBottomWidth: 0,
      }}
    >
      {title !== undefined && (
        <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {back ? (
            <IconButton
              name="back"
              label="Quay lại"
              tint={fg}
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            />
          ) : (
            <View style={{ width: 8 }} />
          )}
          <View style={{ flex: 1 }}>
            <T size={17} weight="bold" c={fg} numberOfLines={1}>
              {title}
            </T>
            {subtitle ? (
              <T size={12} c={brand ? '#e8f5ee' : color.muted} numberOfLines={1}>
                {subtitle}
              </T>
            ) : null}
          </View>
          {right}
        </View>
      )}
      {children ? <View style={{ paddingHorizontal: space.sm }}>{children}</View> : null}
    </View>
  );
}

/** Scrollable screen body with pull-to-refresh and consistent padding. */
export function Screen({
  children,
  refreshing,
  onRefresh,
  bottomInset = 24,
  style,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.bg }}
      contentContainerStyle={[{ padding: space.lg, gap: space.md, paddingBottom: bottomInset }, style]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={color.green} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function IconButton({
  name,
  label,
  onPress,
  tint = color.ink,
  bg,
  size = 22,
  badge,
  style,
}: {
  name: IconName;
  label: string;
  onPress?: () => void;
  tint?: string;
  bg?: string;
  size?: number;
  badge?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label} (${badge})` : label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(17,24,39,0.06)' : bg },
        style,
      ]}
    >
      <Icon name={name} size={size} color={tint} />
      {badge ? (
        <View style={{ position: 'absolute', top: 6, right: 6, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: color.red, alignItems: 'center', justifyContent: 'center' }}>
          <T size={10} weight="heavy" c="#fff" style={{ lineHeight: 14 }}>
            {badge > 99 ? '99+' : badge}
          </T>
        </View>
      ) : null}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line }, shadow.card, style]}>
      {children}
    </View>
  );
}

/** A titled group of rows; the title sits outside the card, as in iOS settings lists. */
export function Section({ title, action, onAction, children }: { title?: string; action?: string; onAction?: () => void; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 }}>
          <T size={15} weight="bold">
            {title}
          </T>
          {action ? (
            <Pressable accessibilityRole="link" onPress={onAction} hitSlop={10}>
              <T size={12.5} weight="medium" c={color.muted}>
                {action}
              </T>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Card style={{ overflow: 'hidden' }}>{children}</Card>
    </View>
  );
}

/** Heading above a horizontal rail or free-form block, with an optional link. */
export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <T size={15} weight="bold">
        {title}
      </T>
      {action ? (
        <Pressable accessibilityRole="link" onPress={onAction} hitSlop={10}>
          <T size={14} weight="bold" c={color.green}>
            {action}
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Standard list row: icon tile, title/subtitle, an optional value and chevron. */
export function ListItem({
  icon,
  t = 'gray',
  title,
  subtitle,
  value,
  badge,
  onPress,
  first,
  right,
}: {
  icon?: IconName;
  t?: Tone;
  title: string;
  subtitle?: string;
  value?: string;
  badge?: { label: string; t: Tone };
  onPress?: () => void;
  first?: boolean;
  right?: ReactNode;
}) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: first ? 0 : 1, borderTopColor: color.line }}>
      {icon ? <IconTile name={icon} t={t} size={38} glyph={18} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <T size={14} weight="bold" numberOfLines={2}>
          {title}
        </T>
        {subtitle ? (
          <T size={12} c={color.muted} numberOfLines={2}>
            {subtitle}
          </T>
        ) : null}
        {badge ? <Pill label={badge.label} t={badge.t} /> : null}
      </View>
      {value ? (
        <T size={13} weight="bold" c={color.inkSoft}>
          {value}
        </T>
      ) : null}
      {right}
      {onPress ? <Icon name="chevron" size={18} color={color.faint} /> : null}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ backgroundColor: pressed ? '#f9fafb' : undefined })}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

type ButtonKind = 'primary' | 'outline' | 'soft' | 'danger';
export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  loading,
  disabled,
  style,
}: {
  label: string;
  onPress?: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  const look = {
    primary: { bg: color.green, fg: '#fff', border: color.green },
    outline: { bg: color.surface, fg: color.ink, border: color.field },
    soft: { bg: color.greenTint, fg: color.greenDeep, border: color.greenTint },
    danger: { bg: color.redTint, fg: color.redDeep, border: color.redTint },
  }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 46,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: off ? color.line : look.border,
          backgroundColor: off ? '#f3f4f6' : look.bg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          paddingHorizontal: space.lg,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={look.fg} /> : icon && <Icon name={icon} size={18} color={off ? color.faint : look.fg} />}
      <T size={14} weight="bold" c={off ? color.faint : look.fg}>
        {label}
      </T>
    </Pressable>
  );
}

export function Field({
  label,
  icon,
  required,
  error,
  hint,
  secure,
  readOnly,
  right,
  ...input
}: TextInputProps & {
  label: string;
  icon?: IconName;
  required?: boolean;
  error?: string | null;
  hint?: string;
  secure?: boolean;
  readOnly?: boolean;
  right?: ReactNode;
}) {
  const [hidden, setHidden] = useState(true);
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <T size={13} weight="medium" c={color.inkSoft}>
        {label}
        {required ? <T size={13} c={color.red}> *</T> : null}
      </T>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          minHeight: 46,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: focus ? 1.5 : 1,
          borderColor: error ? color.red : focus ? color.green : color.field,
          backgroundColor: readOnly ? color.bg : color.surface,
        }}
      >
        {icon && <Icon name={icon} size={18} color={color.muted} />}
        <TextInput
          {...input}
          accessibilityLabel={label}
          editable={!readOnly}
          secureTextEntry={secure && hidden}
          onFocus={(e) => {
            setFocus(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            input.onBlur?.(e);
          }}
          placeholderTextColor={color.faint}
          style={[{ flex: 1, fontFamily: font.regular, fontSize: 14, color: color.ink, paddingVertical: 10 }, noOutline, input.style]}
        />
        {secure && (
          <IconButton
            name={hidden ? 'eyeOff' : 'eye'}
            label={hidden ? 'Hiện mật khẩu' : 'Ẩn mật khẩu'}
            tint={color.muted}
            size={18}
            onPress={() => setHidden(!hidden)}
            style={{ marginRight: -8 }}
          />
        )}
        {right}
      </View>
      {error ? (
        <T size={13} weight="medium" c={color.redDeep}>
          {error}
        </T>
      ) : hint ? (
        <T size={13} c={color.muted}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

/** Choice chips (single select); used for care types, phases and filters. */
export function Chips<K extends string>({ items, value, onChange }: { items: { key: K; label: string }[]; value: K; onChange: (key: K) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {items.map((item) => {
        const on = item.key === value;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(item.key)}
            style={{ paddingHorizontal: space.md, minHeight: 36, borderRadius: radius.full, justifyContent: 'center', borderWidth: 1, borderColor: on ? color.green : color.field, backgroundColor: on ? color.greenTint : color.surface }}
          >
            <T size={13} weight={on ? 'bold' : 'medium'} c={on ? color.greenDeep : color.inkSoft}>
              {item.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Pill({ label, t = 'green' }: { label: string; t?: Tone }) {
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, backgroundColor: tone[t].bg }}>
      <T size={11} weight="bold" c={tone[t].deep}>
        {label}
      </T>
    </View>
  );
}

export function IconTile({ name, t, size = 44, glyph = 22 }: { name: IconName; t: Tone; size?: number; glyph?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: tone[t].bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={glyph} color={tone[t].fg} />
    </View>
  );
}


/** First letter of the given name (last word in Vietnamese), ignoring "(…)". */
export const initialOf = (name?: string | null) =>
  (name ?? '').replace(/\([^)]*\)/g, '').trim().split(/\s+/).at(-1)?.[0]?.toUpperCase() ?? '';


type NoticeKind = 'warn' | 'info' | 'error' | 'success';
export function Notice({ kind = 'info', title, body, action }: { kind?: NoticeKind; title: string; body?: string; action?: ReactNode }) {
  const look = {
    warn: { bg: color.warnBg, border: color.warnLine, fg: color.warn, icon: 'alert' as const, ic: color.orange },
    info: { bg: '#eff6ff', border: '#bfdbfe', fg: '#1e3a8a', icon: 'info' as const, ic: color.blue },
    error: { bg: '#fef2f2', border: '#fecaca', fg: color.redDeep, icon: 'alert' as const, ic: color.red },
    success: { bg: '#f0fdf4', border: '#bbf7d0', fg: color.greenDeep, icon: 'check' as const, ic: color.green },
  }[kind];
  return (
    <View
      accessibilityRole={kind === 'error' || kind === 'warn' ? 'alert' : undefined}
      style={{ flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: look.bg, borderWidth: 1, borderColor: look.border }}
    >
      <Icon name={look.icon} size={20} color={look.ic} />
      <View style={{ flex: 1, gap: 2 }}>
        <T size={13} weight="bold" c={look.fg}>
          {title}
        </T>
        {body ? (
          <T size={12.5} c={look.fg}>
            {body}
          </T>
        ) : null}
        {action ? <View style={{ marginTop: space.sm }}>{action}</View> : null}
      </View>
    </View>
  );
}

export function Loading({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <View style={{ padding: 32, alignItems: 'center', gap: 10 }}>
      <ActivityIndicator color={color.green} />
      <T size={14} c={color.muted}>
        {label}
      </T>
    </View>
  );
}

export function Empty({ title, body, icon = 'box' }: { title: string; body?: string; icon?: IconName }) {
  return (
    <View style={{ paddingVertical: 40, paddingHorizontal: 24, alignItems: 'center', gap: space.sm }}>
      <IconTile name={icon} t="gray" size={56} glyph={26} />
      <T size={15} weight="bold" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {body ? (
        <T size={13} c={color.muted} style={{ textAlign: 'center' }}>
          {body}
        </T>
      ) : null}
    </View>
  );
}

/** Loading / error / empty states for a list read; renders children when data is ready. */
export function Loadable<D>({
  data,
  loading,
  error,
  reload,
  empty,
  children,
}: {
  data: D | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  empty?: ReactNode;
  children: (data: D) => ReactNode;
}) {
  if (!data && loading) return <Loading />;
  if (!data) return <Notice kind="error" title={error ?? 'Chưa tải được dữ liệu'} action={<Button label="Thử lại" kind="outline" onPress={reload} />} />;
  if (empty && Array.isArray(data) && data.length === 0) return <>{empty}</>;
  return <>{children(data)}</>;
}

export function SegmentTabs<K extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', padding: 3, borderRadius: radius.full, backgroundColor: '#e9eeeb' }}>
      {items.map((item) => {
        const on = item.key === value;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(item.key)}
            style={[{ flex: 1, minHeight: 34, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, backgroundColor: on ? color.surface : 'transparent' }, on && shadow.card]}
          >
            <T size={13} weight={on ? 'bold' : 'medium'} c={on ? color.greenDeep : color.muted} numberOfLines={1}>
              {item.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Two or three headline numbers in one card, equal columns. */
export function Stats({ items }: { items: { value: string; label: string; t?: Tone }[] }) {
  return (
    <Card style={{ flexDirection: 'row', paddingVertical: space.md }}>
      {items.map((s, i) => (
        <View key={s.label} style={{ flex: 1, alignItems: 'center', gap: 2, borderLeftWidth: i ? 1 : 0, borderLeftColor: color.line, paddingHorizontal: 4 }}>
          <T size={18} weight="heavy" c={s.t ? tone[s.t].deep : color.ink} numberOfLines={1}>
            {s.value}
          </T>
          <T size={11.5} c={color.muted} numberOfLines={1}>
            {s.label}
          </T>
        </View>
      ))}
    </Card>
  );
}

export function Row({ label, value, mono, first, icon }: { label: string; value: string; mono?: boolean; first?: boolean; icon?: IconName }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, paddingVertical: 9, borderTopWidth: first ? 0 : 1, borderTopColor: color.line }}>
      {icon ? <Icon name={icon} size={16} color={color.muted} /> : null}
      <T size={12.5} c={color.muted} style={{ width: 96, flexShrink: 0 }}>
        {label}
      </T>
      <T size={13} weight="medium" style={[{ flex: 1, textAlign: 'right' }, mono && { fontFamily: 'monospace' }]}>
        {value}
      </T>
    </View>
  );
}

/** Sticky bottom action bar above the home indicator. */
export function BottomBar({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, padding: space.md, paddingBottom: insets.bottom + space.md, backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.line }}>
      {children}
    </View>
  );
}
