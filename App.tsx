import { useState, useCallback } from "react";
import { useFonts } from "expo-font";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
import { useStore } from "./src/lib/store";
import { ObservationCapture } from "./src/components/ObservationCapture";
import { RecordsTab } from "./src/components/RecordsTab";
import { InsightsTab } from "./src/components/InsightsTab";
import { ThemeProvider, font, useTheme, type Theme } from "./src/ui/theme";

type Tab = "capture" | "records" | "insights";

const TABS: { key: Tab; icon: string; label: string; title: string }[] = [
  { key: "capture", icon: "＋", label: "Captura", title: "" },
  { key: "records", icon: "☰", label: "Registros", title: "Registros" },
  { key: "insights", icon: "◈", label: "Insights", title: "Insights" },
];

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

function AppShell() {
  const { theme } = useTheme();
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

  const current = TABS.find((t) => t.key === activeTab)!;
  const aiLabel = captureBusy && activeTab !== "capture"
    ? "Extracción en curso en Capturar…"
    : store.status.ready
      ? `IA local lista${store.status.device ? ` · ${store.status.device.toUpperCase()}` : ""}`
      : `Cargando modelo${store.progress != null ? ` ${Math.round(store.progress)}%` : "…"}`;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.color.surface} />

      <View style={styles.header}>
        {current.title ? <Text style={theme.type.title}>{current.title}</Text> : null}
        <View style={styles.aiStatus}>
          <View style={[styles.dot, { backgroundColor: captureBusy ? theme.color.warn : store.status.ready ? theme.color.ok : theme.color.textTertiary }]} />
          <Text style={theme.type.caption}>{aiLabel}</Text>
        </View>
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
      backgroundColor: color.surface, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
      borderBottomWidth: 1, borderBottomColor: color.border, gap: 4,
    },
    aiStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 6, height: 6, borderRadius: 3 },
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
