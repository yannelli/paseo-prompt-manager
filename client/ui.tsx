import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

export type Colors = PluginSurfaceProps["theme"]["colors"];
export type Variant = "primary" | "secondary" | "ghost" | "danger";

export const radius = 10;
export const row: ViewStyle = { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" };

export function inputStyle(colors: Colors): TextStyle {
  return {
    color: colors.foreground, backgroundColor: colors.surface1, borderColor: colors.border,
    width: "100%", minWidth: 0, borderWidth: 1, borderRadius: radius, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14,
  };
}

/** Returns `value` once it has stopped changing for `delay` milliseconds. */
export function useDebounced<Value>(value: Value, delay: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export function relativeTime(iso: string, now = Date.now()) {
  const stamp = new Date(iso).getTime();
  if (!Number.isFinite(stamp)) return "";
  const minutes = Math.round((now - stamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  colors: Colors;
  icon?: string;
  variant?: Variant;
  disabled?: boolean;
  size?: "sm" | "md";
  active?: boolean;
  accessibilityLabel?: string;
};

export function Button({ title, onPress, colors, icon, variant = "secondary", disabled, size = "md", active, accessibilityLabel }: ButtonProps) {
  const foreground = variant === "primary" ? colors.accentForeground : variant === "danger" ? colors.statusDanger : active ? colors.accent : colors.foreground;
  const background = variant === "primary" ? colors.accent : variant === "secondary" || active ? colors.surface2 : "transparent";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(active) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 6,
        paddingVertical: size === "sm" ? 6 : 9, paddingHorizontal: size === "sm" ? 10 : 14, borderRadius: radius - 2,
        backgroundColor: background, borderWidth: 1,
        borderColor: variant === "primary" ? colors.accent : variant === "secondary" || active ? colors.border : "transparent",
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16} color={foreground} />}
      <Text style={{ color: foreground, fontWeight: "600", fontSize: size === "sm" ? 12 : 13 }}>{title}</Text>
    </Pressable>
  );
}

type IconButtonProps = { icon: string; label: string; onPress: () => void; colors: Colors; active?: boolean; disabled?: boolean; size?: number; tone?: "default" | "danger" };

export function IconButton({ icon, label, onPress, colors, active, disabled, size = 34, tone = "default" }: IconButtonProps) {
  const color = tone === "danger" ? colors.statusDanger : active ? colors.accent : colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(active) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size, height: size, alignItems: "center", justifyContent: "center", borderRadius: radius - 2,
        backgroundColor: active ? colors.surface2 : "transparent", borderWidth: 1, borderColor: active ? colors.border : "transparent",
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={Math.round(size * 0.47)} color={color} />
    </Pressable>
  );
}

type ChipProps = { label: string; colors: Colors; icon?: string; active?: boolean; onPress?: () => void; onClear?: () => void; disabled?: boolean };

export function Chip({ label, colors, icon, active, onPress, onClear, disabled }: ChipProps) {
  const color = active ? colors.accent : colors.foregroundMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", borderRadius: 999, borderWidth: 1, borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.surface2 : "transparent", opacity: disabled ? 0.5 : 1, maxWidth: "100%" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: Boolean(active), disabled: Boolean(disabled) }}
        disabled={disabled || !onPress}
        onPress={onPress}
        style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 5, paddingLeft: 10, paddingRight: onClear ? 4 : 10, minWidth: 0, flexShrink: 1 }}
      >
        {icon && <Icon name={icon} size={12} color={color} />}
        <Text numberOfLines={1} style={{ color, fontSize: 12, fontWeight: active ? "600" : "500", flexShrink: 1 }}>{label}</Text>
      </Pressable>
      {onClear && (
        <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label}`} disabled={disabled} onPress={onClear} style={{ paddingVertical: 5, paddingLeft: 3, paddingRight: 8 }}>
          <Icon name="X" size={12} color={color} />
        </Pressable>
      )}
    </View>
  );
}

type SegmentedProps<Value extends string> = {
  options: readonly { value: Value; label: string; icon?: string }[];
  value: Value;
  onChange: (value: Value) => void;
  colors: Colors;
  disabled?: boolean;
};

export function Segmented<Value extends string>({ options, value, onChange, colors, disabled }: SegmentedProps<Value>) {
  return (
    <View style={{ flexDirection: "row", borderRadius: radius - 2, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1, padding: 2, opacity: disabled ? 0.5 : 1 }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius - 4, backgroundColor: selected ? colors.surface2 : "transparent" }}
          >
            {option.icon && <Icon name={option.icon} size={13} color={selected ? colors.foreground : colors.foregroundMuted} />}
            <Text style={{ color: selected ? colors.foreground : colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Card({ colors, children, style }: { colors: Colors; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: 14, gap: 12, minWidth: 0 }, style]}>{children}</View>;
}

export function Field({ label, hint, colors, children, trailing }: { label: string; hint?: string; colors: Colors; children: ReactNode; trailing?: ReactNode }) {
  return (
    <View style={{ gap: 6, minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{label}</Text>
        {trailing}
      </View>
      {children}
      {hint && <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{hint}</Text>}
    </View>
  );
}

export function SectionTitle({ title, subtitle, colors, icon }: { title: string; subtitle?: string; colors: Colors; icon?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      {icon && <Icon name={icon} size={18} color={colors.accent} />}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "600" }}>{title}</Text>
        {subtitle && <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>{subtitle}</Text>}
      </View>
    </View>
  );
}

export function Meta({ children, colors, icon, style }: { children: ReactNode; colors: Colors; icon?: string; style?: StyleProp<TextStyle> }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0, flexShrink: 1 }}>
      {icon && <Icon name={icon} size={11} color={colors.foregroundMuted} />}
      <Text numberOfLines={1} style={[{ color: colors.foregroundMuted, fontSize: 11, flexShrink: 1 }, style]}>{children}</Text>
    </View>
  );
}

type BannerProps = { tone: "info" | "success" | "warning" | "danger"; message: string; colors: Colors; action?: ReactNode; onDismiss?: () => void };

export function Banner({ tone, message, colors, action, onDismiss }: BannerProps) {
  const color = tone === "danger" ? colors.statusDanger : tone === "warning" ? colors.statusWarning : tone === "success" ? colors.statusSuccess : colors.accent;
  const icon = tone === "danger" ? "CircleAlert" : tone === "warning" ? "TriangleAlert" : tone === "success" ? "CircleCheck" : "Info";
  return (
    <View accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: color }}>
      <Icon name={icon} size={16} color={color} />
      <Text selectable style={{ color: colors.foreground, fontSize: 13, lineHeight: 18, flex: 1, minWidth: 160 }}>{message}</Text>
      {action}
      {onDismiss && <IconButton icon="X" label="Dismiss" onPress={onDismiss} colors={colors} size={28} />}
    </View>
  );
}

export function EmptyState({ icon, title, body, colors, children }: { icon: string; title: string; body?: string; colors: Colors; children?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center", padding: 24, gap: 10 }}>
      <View style={{ width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border }}>
        <Icon name={icon} size={26} color={colors.accent} />
      </View>
      <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "600", textAlign: "center" }}>{title}</Text>
      {body && <Text style={{ color: colors.foregroundMuted, fontSize: 13, textAlign: "center", maxWidth: 420, lineHeight: 19 }}>{body}</Text>}
      {children && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 6 }}>{children}</View>}
    </View>
  );
}

export function Tip({ icon, colors, children }: { icon: string; colors: Colors; children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
      <View style={{ width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 }}>
        <Icon name={icon} size={14} color={colors.foregroundMuted} />
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 19, flex: 1, minWidth: 0 }}>{children}</Text>
    </View>
  );
}

export function StatusDot({ color }: { color: string }) {
  return <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />;
}

type ConfirmProps = { open: boolean; title: string; message: string; confirmLabel: string; colors: Colors; destructive?: boolean; icon?: string; onConfirm: () => void; onCancel: () => void };

export function ConfirmModal({ open, title, message, confirmLabel, colors, destructive, icon, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal title={title} open={open} onOpenChange={(next) => { if (!next) onCancel(); }} icon={icon ? <Icon name={icon} size={18} color={destructive ? colors.statusDanger : colors.accent} /> : undefined}>
      <Modal.Content>
        <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>{message}</Text>
        <View testID="prompt-confirm" style={{ flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
          <Button title="Cancel" onPress={onCancel} colors={colors} />
          <Button title={confirmLabel} onPress={onConfirm} colors={colors} variant={destructive ? "danger" : "primary"} />
        </View>
      </Modal.Content>
    </Modal>
  );
}
