import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { color, font, radius, space, type } from "./theme";

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={type.heading}>{title}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Unidad de lectura básica: etiqueta a la izquierda, valor a la derecha, divisor fino. */
export function Row({
  label,
  value,
  detail,
  valueColor,
  onPress,
  last,
}: {
  label: string;
  value?: string;
  detail?: string;
  valueColor?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
      style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && onPress && styles.pressed]}
    >
      <View style={styles.rowMain}>
        <Text style={type.body}>{label}</Text>
        {detail ? <Text style={type.secondary}>{detail}</Text> : null}
      </View>
      {value != null ? <Text style={[type.bodyMedium, valueColor ? { color: valueColor } : null]}>{value}</Text> : null}
      {onPress ? <Text style={styles.chevron}>›</Text> : null}
    </Pressable>
  );
}

/** Estado como texto + punto de color; sin fondos de colores. */
export function StatusText({ label, tone }: { label: string; tone: string }) {
  return (
    <View style={styles.status}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={[type.secondary, { color: tone }]}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled,
  loading,
  variant = "primary",
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary";
  style?: StyleProp<ViewStyle>;
}) {
  const secondary = variant === "secondary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      style={({ pressed }) => [styles.btn, secondary && styles.btnSecondary, (disabled || loading) && styles.btnDisabled, pressed && styles.pressed, style]}
    >
      {loading ? <ActivityIndicator color={secondary ? color.text : color.primaryText} /> : (
        <Text style={[styles.btnText, secondary && styles.btnTextSecondary]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Input({
  label,
  style,
  inputStyle,
  ...input
}: TextInputProps & { label?: string; style?: StyleProp<ViewStyle>; inputStyle?: StyleProp<TextStyle> }) {
  return (
    <View style={[styles.field, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={color.textTertiary} style={[styles.input, input.multiline && styles.inputMultiline, inputStyle]} {...input} />
    </View>
  );
}

/** Dropdown: disparador con valor actual + chevron; abre una hoja con opciones. */
export function Select<T extends string>({
  label,
  value,
  options,
  labels,
  placeholder = "Seleccionar",
  onChange,
  style,
}: {
  label?: string;
  value: T | null;
  options: readonly T[];
  labels?: Record<string, string>;
  placeholder?: string;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const display = value ? labels?.[value] ?? value : placeholder;
  return (
    <View style={[styles.field, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" style={styles.selectTrigger}>
        <Text style={[type.body, !value && { color: color.textTertiary }]} numberOfLines={1}>{display}</Text>
        <Text style={styles.chevronDown}>⌄</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            {label ? <Text style={[type.caption, styles.sheetTitle]}>{label}</Text> : null}
            {options.map((opt, i) => (
              <Pressable
                key={opt}
                onPress={() => { onChange(opt); setOpen(false); }}
                accessibilityRole="button"
                style={[styles.sheetItem, i < options.length - 1 && styles.rowDivider]}
              >
                <Text style={opt === value ? type.bodyMedium : type.body}>{labels?.[opt] ?? opt}</Text>
                {opt === value ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, overflow: "hidden" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm, paddingHorizontal: 2 },
  sectionAction: { fontFamily: font.medium, fontSize: 13, color: color.link },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 13 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  rowMain: { flex: 1, gap: 2 },
  chevron: { color: color.textTertiary, fontSize: 20, lineHeight: 22 },
  chevronDown: { color: color.textSecondary, fontSize: 16, lineHeight: 16, marginTop: -6 },
  pressed: { opacity: 0.6 },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  btn: { minHeight: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg, backgroundColor: color.primary },
  btnSecondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontFamily: font.semibold, fontSize: 15, color: color.primaryText },
  btnTextSecondary: { color: color.text },
  field: { gap: 6 },
  label: { fontFamily: font.medium, fontSize: 12, color: color.textSecondary },
  input: {
    fontFamily: font.regular, fontSize: 15, color: color.text, backgroundColor: color.surface,
    borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: "top" },
  selectTrigger: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm,
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44,
  },
  backdrop: { flex: 1, backgroundColor: "rgba(17,24,39,0.35)", justifyContent: "flex-end", padding: space.lg },
  sheet: { backgroundColor: color.surface, borderRadius: radius.lg, overflow: "hidden", paddingVertical: space.xs },
  sheetTitle: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xs },
  sheetItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: 14 },
  check: { fontFamily: font.semibold, color: color.text, fontSize: 15 },
});
