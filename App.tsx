import { useState } from "react";
import { Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import { useStore } from "./src/lib/store";
import { ThemeProvider, useTheme, type Theme } from "./src/lib/theme";
import { TabBar, type TabKey } from "./src/components/TabBar";
import { ObservationCapture } from "./src/components/ObservationCapture";
import { RecordsTab } from "./src/components/RecordsTab";
import { InsightsTab } from "./src/components/InsightsTab";

export default function App() {
  return (
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  );
}

function Root() {
  const store = useStore();
  const { theme, mode, toggleMode } = useTheme();
  const styles = makeStyles(theme);
  const [tab, setTab] = useState<TabKey>("captura");
  const [focusClient, setFocusClient] = useState<string | null>(null);

  function goToRecords(client: string) {
    setFocusClient(client);
    setTab("registros");
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={mode === "light" ? "dark-content" : "light-content"} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Philips · Base instalada · prototipo de campo</Text>
          <Text style={styles.h1}>BaseIQ Local</Text>
        </View>
        <Pressable style={styles.themeBtn} onPress={toggleMode}>
          <Text style={styles.themeBtnText}>{mode === "light" ? "🌙" : "☀︎"}</Text>
        </Pressable>
        <View style={[styles.pill, store.status.ready ? styles.pillReady : styles.pillLoading]}>
          <Text style={styles.pillText}>
            {store.status.ready ? "● IA local lista" : "○ cargando modelo…"}
            {store.progress != null ? ` ${Math.round(store.progress)}%` : ""}
            {store.status.device ? ` ${store.status.device.toUpperCase()}` : ""}
          </Text>
        </View>
      </View>

      <View style={styles.body}>
        {tab === "captura" && (
          <ObservationCapture store={store} onGoToRecords={goToRecords} />
        )}
        {tab === "registros" && (
          <RecordsTab store={store} focusClient={focusClient} onClearFocus={() => setFocusClient(null)} />
        )}
        {tab === "insights" && (
          <InsightsTab observations={store.observations} onViewClient={goToRecords} />
        )}
      </View>

      <TabBar active={tab} onChange={setTab} />
    </SafeAreaView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.bg },
    body: { flex: 1 },
    header: {
      flexDirection: "row", alignItems: "center", gap: 10, padding: 16, paddingBottom: 12,
      backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border,
    },
    kicker: { color: theme.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
    h1: { color: theme.text, fontSize: 22, fontWeight: "700", marginTop: 2 },
    themeBtn: { padding: 8, borderRadius: 20, backgroundColor: theme.surfaceAlt },
    themeBtnText: { fontSize: 16 },
    pill: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 20 },
    pillReady: { backgroundColor: theme.accentSoft },
    pillLoading: { backgroundColor: theme.surfaceAlt },
    pillText: { color: theme.textMuted, fontSize: 11 },
  });
}
