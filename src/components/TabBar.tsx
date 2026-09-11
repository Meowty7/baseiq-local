import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme, type Theme } from "../lib/theme";

export type TabKey = "captura" | "registros" | "insights";

const TABS: { key: TabKey; icon: string; label: string }[] = [
  { key: "captura", icon: "＋", label: "Captura" },
  { key: "registros", icon: "☰", label: "Registros" },
  { key: "insights", icon: "◈", label: "Insights" },
];

export function TabBar({ active, onChange }: { active: TabKey; onChange: (tab: TabKey) => void }) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={styles.bar}>
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Pressable key={t.key} style={styles.tab} onPress={() => onChange(t.key)}>
            <Text style={[styles.icon, isActive && styles.iconActive]}>{t.icon}</Text>
            <Text style={[styles.label, isActive && styles.labelActive]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    bar: {
      flexDirection: "row",
      backgroundColor: theme.surface,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingTop: 8,
      paddingBottom: 10,
    },
    tab: { flex: 1, alignItems: "center", gap: 2 },
    icon: { fontSize: 18, color: theme.textMuted },
    iconActive: { color: theme.accent },
    label: { fontSize: 11, color: theme.textMuted },
    labelActive: { color: theme.accent, fontWeight: "600" },
  });
}
