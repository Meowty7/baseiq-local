import { useState, useCallback } from "react";
import { useFonts } from "expo-font";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import { useStore } from "./src/lib/store";
import { ObservationCapture } from "./src/components/ObservationCapture";
import { RecordsTab } from "./src/components/RecordsTab";
import { InsightsTab } from "./src/components/InsightsTab";
import { ThemeProvider, font, useTheme, type Theme } from "./src/ui/theme";

type Tab = "capture" | "records" | "insights";

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: "capture", icon: "＋", label: "Captura" },
  { key: "records", icon: "☰", label: "Registros" },
  { key: "insights", icon: "◈", label: "Insights" },
];

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

function AppShell() {
  const { theme, toggleMode } = useTheme();
  const styles = makeStyles(theme);
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const store = useStore();
  const [activeTab, setActiveTab] = useState<Tab>("capture");
  const [captureBusy, setCaptureBusy] = useState(false);
  const onCaptureBusy = useCallback((busy: boolean) => setCaptureBusy(busy), []);
  const [focusClient, setFocusClient] = useState<string | null>(null);
  const goToRecords = useCallback((client: string) => {
    setFocusClient(client);
    setActiveTab("records");
  }, []);

  if (!fontsLoaded) return <SafeAreaView style={styles.safe} />;

  const aiLabel = captureBusy && activeTab !== "capture"
    ? "Extracción en curso en Capturar…"
    : store.status.ready
      ? `IA local lista${store.status.device ? ` · ${store.status.device.toUpperCase()}` : ""}`
      : `Cargando modelo${store.progress != null ? ` ${Math.round(store.progress)}%` : "…"}`;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.color.surface} />

      <View style={styles.header}>
        <View style={styles.aiStatus}>
          <View style={[styles.dot, { backgroundColor: captureBusy ? theme.color.warn : store.status.ready ? theme.color.ok : theme.color.textTertiary }]} />
          <Text style={theme.type.caption}>{aiLabel}</Text>
        </View>
        <Pressable
          onPress={toggleMode}
          accessibilityRole="button"
          accessibilityLabel={theme.mode === "dark" ? "Cambiar a modo diurno" : "Cambiar a modo nocturno"}
          hitSlop={8}
          style={styles.themeBtn}
        >
          <Text style={styles.themeBtnIcon}>{theme.mode === "dark" ? "☀️" : "🌙"}</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <View style={[styles.panel, activeTab !== "capture" && styles.panelHidden]} pointerEvents={activeTab === "capture" ? "auto" : "none"}>
          <ObservationCapture store={store} onBusyChange={onCaptureBusy} />
        </View>
        {activeTab === "records" && (
          <RecordsTab store={store} focusClient={focusClient} onClearFocus={() => setFocusClient(null)} />
        )}
        {activeTab === "insights" && (
          <InsightsTab overview={store.overview} observations={store.observations} onViewClient={goToRecords} />
        )}
      </View>

      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable key={tab.key} style={styles.tabBtn} onPress={() => setActiveTab(tab.key)} accessibilityRole="button" accessibilityState={{ selected: active }}>
              <View style={styles.tabInner}>
                <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{tab.icon}</Text>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
                {tab.key === "capture" && captureBusy && activeTab !== "capture" && <View style={styles.tabBusyDot} />}
              </View>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(theme: Theme) {
  const { color } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: color.bg },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      backgroundColor: color.surface, paddingHorizontal: 16,
      // RN's SafeAreaView doesn't inset for the status bar on Android (iOS-only),
      // so the OS clock/battery/wifi icons were sitting on top of this bar.
      paddingTop: (Platform.OS === "android" ? StatusBar.currentHeight ?? 24 : 0) + 12,
      paddingBottom: 12,
      borderBottomWidth: 1, borderBottomColor: color.border,
    },
    aiStatus: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    themeBtn: { paddingHorizontal: 4, paddingVertical: 2, flexShrink: 0, marginLeft: 8 },
    themeBtnIcon: { fontSize: 18 },
    body: { flex: 1 },
    panel: { ...StyleSheet.absoluteFill },
    panelHidden: { opacity: 0 },
    tabBar: { flexDirection: "row", backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border, paddingBottom: 18, paddingTop: 6 },
    tabBtn: { flex: 1, alignItems: "center", paddingVertical: 10 },
    tabInner: { alignItems: "center", gap: 2 },
    tabIcon: { fontSize: 18, color: color.textTertiary },
    tabIconActive: { color: color.primary },
    tabLabel: { fontFamily: font.medium, fontSize: 13, color: color.textTertiary },
    tabLabelActive: { color: color.text, fontFamily: font.semibold },
    tabBusyDot: { position: "absolute", top: -2, right: -8, width: 6, height: 6, borderRadius: 3, backgroundColor: color.warn },
  });
}
