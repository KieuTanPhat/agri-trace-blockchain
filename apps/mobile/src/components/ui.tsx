import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, shadow, tone, type Tone, noOutline } from '../theme/tokens';
import { Icon, type IconName } from './Icon';

type Weight = 'regular' | 'bold' | 'heavy';
export function T({
  size = 15,
  weight = 'regular',
  c = color.ink,
  style,
  ...rest
}: TextProps & { size?: number; weight?: Weight; c?: string }) {
  return (
    <RNText
      {...rest}
      style={[
        { fontFamily: font[weight], fontSize: size, lineHeight: Math.round(size * 1.38), color: c },
        style,
      ]}
    />
  );
}

/** Solid green header with rounded bottom corners, as in the reference apps. */
export function GreenHeader({
  title,
  back,
  right,
  children,
  extraBottom = 0,
  center = true,
}: {
  title?: string;
  back?: boolean;
  right?: ReactNode;
  children?: ReactNode;
  extraBottom?: number;
  center?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: color.green,
        paddingTop: insets.top + 10,
        paddingBottom: 14 + extraBottom,
        paddingHorizontal: 12,
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
      }}
    >
      {title !== undefined && (
        <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: center ? 'center' : 'flex-start' }}>
          {back && (
            <IconButton
              name="back"
              label="Quay lại"
              tint="#fff"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              style={{ position: 'absolute', left: 0 }}
            />
          )}
          <T size={21} weight="heavy" c="#fff" numberOfLines={1} style={{ marginLeft: !center && back ? 44 : 0, maxWidth: '78%' }}>
            {title}
          </T>
          {right && <View style={{ position: 'absolute', right: 0 }}>{right}</View>}
        </View>
      )}
      {children}
    </View>
  );
}

export function IconButton({
  name,
  label,
  onPress,
  tint = color.ink,
  bg,
  size = 24,
  style,
}: {
  name: IconName;
  label: string;
  onPress?: () => void;
  tint?: string;
  bg?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, opacity: pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <Icon name={name} size={size} color={tint} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: color.surface, borderRadius: radius.lg }, shadow.card, style]}>{children}</View>;
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
    outline: { bg: '#fff', fg: color.ink, border: color.field },
    soft: { bg: color.purpleTint, fg: color.purpleDeep, border: color.purpleTint },
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
          height: 56,
          borderRadius: radius.full,
          borderWidth: 1.5,
          borderColor: off ? color.line : look.border,
          backgroundColor: off ? color.line : look.bg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingHorizontal: 18,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        kind === 'primary' && !off && shadow.raised,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={look.fg} />
      ) : (
        icon && <Icon name={icon} size={20} color={off ? color.muted : look.fg} />
      )}
      <T size={17} weight="heavy" c={off ? color.muted : look.fg}>
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
    <View style={{ gap: 7 }}>
      <T size={15.5} weight="heavy">
        {label}
        {required ? <T c={color.red}> *</T> : null}
      </T>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          height: 56,
          paddingHorizontal: 14,
          borderRadius: radius.md,
          borderWidth: focus ? 2 : 1.5,
          borderColor: error ? color.red : focus ? color.green : color.field,
          backgroundColor: readOnly ? color.bg : '#fff',
        }}
      >
        {icon && <Icon name={icon} size={21} color="#6b7686" />}
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
          placeholderTextColor="#8a94a3"
          style={[{ flex: 1, fontFamily: font.regular, fontSize: 16, color: color.ink, height: '100%' }, noOutline]}
        />
        {secure && (
          <IconButton
            name={hidden ? 'eyeOff' : 'eye'}
            label={hidden ? 'Hiện mật khẩu' : 'Ẩn mật khẩu'}
            tint="#6b7686"
            size={21}
            onPress={() => setHidden(!hidden)}
            style={{ marginRight: -10 }}
          />
        )}
        {right}
      </View>
      {error ? (
        <T size={13.5} weight="bold" c={color.redDeep}>
          {error}
        </T>
      ) : hint ? (
        <T size={13.5} c={color.muted}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

export function Pill({ label, t = 'green' }: { label: string; t?: Tone }) {
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full, backgroundColor: tone[t].bg }}>
      <T size={12.5} weight="heavy" c={tone[t].deep}>
        {label}
      </T>
    </View>
  );
}

export function IconTile({ name, t, size = 52, glyph = 30 }: { name: IconName; t: Tone; size?: number; glyph?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: tone[t].bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={glyph} color={tone[t].fg} />
    </View>
  );
}

/** Initials tile for organizations/products without a logo or photo. */
export function Monogram({ text, t, size = 64, single }: { text: string; t: Tone; size?: number; single?: boolean }) {
  const words = text
    .replace(/\([^)]*\)/g, '')
    .replace(/^(HTX|Công ty|CTY|Cửa hàng)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  // Products read best as their first letter; organizations as two initials.
  const letters = (single ? words.slice(0, 1) : words.slice(-2)).map((w) => w[0]?.toUpperCase()).join('');
  return (
    <View style={{ width: size, height: size, borderRadius: 14, backgroundColor: tone[t].bg, alignItems: 'center', justifyContent: 'center' }}>
      <T size={size * 0.32} weight="heavy" c={tone[t].deep}>
        {letters || '•'}
      </T>
    </View>
  );
}

/** First letter of the given name (last word in Vietnamese), ignoring "(…)". */
export const initialOf = (name?: string | null) =>
  (name ?? '').replace(/\([^)]*\)/g, '').trim().split(/\s+/).at(-1)?.[0]?.toUpperCase() ?? '';

export const toneFor = (seed: string): Tone => {
  const all: Tone[] = ['green', 'orange', 'blue', 'purple', 'red'];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return all[h % all.length];
};

type NoticeKind = 'warn' | 'info' | 'error' | 'success';
export function Notice({ kind = 'info', title, body, action }: { kind?: NoticeKind; title: string; body?: string; action?: ReactNode }) {
  const look = {
    warn: { bg: color.warnBg, border: color.warnLine, fg: color.warn, icon: 'alert' as const, ic: '#f2a20c' },
    info: { bg: '#eef4ff', border: '#cddcfa', fg: '#1f4a99', icon: 'info' as const, ic: color.blue },
    error: { bg: color.redTint, border: '#f5c2bd', fg: color.redDeep, icon: 'info' as const, ic: color.red },
    success: { bg: color.greenTint, border: '#bfe5c9', fg: color.greenDeep, icon: 'check' as const, ic: color.green },
  }[kind];
  return (
    <View
      accessibilityRole={kind === 'error' || kind === 'warn' ? 'alert' : undefined}
      style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: look.bg, borderWidth: 1, borderColor: look.border }}
    >
      <Icon name={look.icon} size={24} color={look.ic} />
      <View style={{ flex: 1, gap: 2 }}>
        <T size={15} weight="heavy" c={look.fg}>
          {title}
        </T>
        {body ? (
          <T size={14} c={look.fg}>
            {body}
          </T>
        ) : null}
        {action}
      </View>
    </View>
  );
}

export function Loading({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <View style={{ padding: 32, alignItems: 'center', gap: 10 }}>
      <ActivityIndicator color={color.green} size="large" />
      <T c={color.muted}>{label}</T>
    </View>
  );
}

export function Empty({ title, body, icon = 'box' }: { title: string; body?: string; icon?: IconName }) {
  return (
    <View style={{ paddingVertical: 48, paddingHorizontal: 24, alignItems: 'center', gap: 10 }}>
      <IconTile name={icon} t="green" size={64} glyph={34} />
      <T size={17} weight="heavy" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {body ? (
        <T c={color.muted} style={{ textAlign: 'center' }}>
          {body}
        </T>
      ) : null}
    </View>
  );
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
    <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: color.line }}>
      {items.map((item) => {
        const on = item.key === value;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(item.key)}
            style={{ flex: 1, height: 50, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: on ? '#e8730c' : 'transparent' }}
          >
            <T size={15.5} weight={on ? 'heavy' : 'bold'} c={on ? color.orangeDeep : color.muted}>
              {item.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <T size={19} weight="heavy">
        {title}
      </T>
      {action && (
        <Pressable accessibilityRole="link" onPress={onAction} hitSlop={10}>
          <T size={15} weight="bold" c={color.blue}>
            {action} ›
          </T>
        </Pressable>
      )}
    </View>
  );
}

export function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.line }}>
      <T size={13.5} weight="heavy" c={color.muted}>
        {label}
      </T>
      <T size={15} weight="bold" style={[{ flexShrink: 1, textAlign: 'right' }, mono && { fontFamily: 'monospace' }]}>
        {value}
      </T>
    </View>
  );
}
