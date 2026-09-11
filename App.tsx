import { useState, useCallback } from "react";
import { useFonts } from "expo-font";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { useStore } from "./src/lib/store";
import { ObservationCapture } from "./src/components/ObservationCapture";
import { ClientInstalledBase } from "./src/components/ClientInstalledBase";
import { OverviewDashboard } from "./src/components/OverviewDashboard";
import { color, font, type } from "./src/ui/theme";

type Tab = "today" | "capture" | "clients";

const TABS: { key: Tab; label: string; title: string }[] = [
  { key: "today", label: "Resumen", title: "Resumen" },
  { key: "capture", label: "Capturar", title: "Nueva observación" },
  { key: "clients", label: "Clientes", title: "Clientes" },
];

export default function App() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const store = useStore();
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [captureBusy, setCaptureBusy] = useState(false);
  const onCaptureBusy = useCallback((busy: boolean) => setCaptureBusy(busy), []);

  if (!fontsLoaded) return <SafeAreaView style={styles.safe} />;

  const current = TABS.find((t) => t.key === activeTab)!;
  const aiLabel = captureBusy && activeTab !== "capture"
    ? "Extracción en curso en Capturar…"
    : store.status.ready
      ? `IA local lista${store.status.device ? ` · ${store.status.device.toUpperCase()}` : ""}`
      : `Cargando modelo${store.progress != null ? ` ${Math.round(store.progress)}%` : "…"}`;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={color.surface} />

      <View style={styles.header}>
        <Text style={type.title}>{current.title}</Text>
        <View style={styles.aiStatus}>
          <View style={[styles.dot, { backgroundColor: captureBusy ? color.warn : store.status.ready ? color.ok : color.textTertiary }]} />
          <Text style={type.caption}>{aiLabel}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={[styles.panel, activeTab !== "capture" && styles.panelHidden]} pointerEvents={activeTab === "capture" ? "auto" : "none"}>
          <ObservationCapture store={store} onBusyChange={onCaptureBusy} />
        </View>
        {activeTab !== "capture" && (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {activeTab === "today" && <OverviewDashboard overview={store.overview} observations={store.observations} />}
            {activeTab === "clients" && <ClientInstalledBase observations={store.observations} />}
          </ScrollView>
        )}
      </View>

      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable key={tab.key} style={styles.tabBtn} onPress={() => setActiveTab(tab.key)} accessibilityRole="button" accessibilityState={{ selected: active }}>
              <View>
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

const styles = StyleSheet.create({
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
  scroll: { flex: 1 },
  content: { padding: 16, gap: 24, paddingBottom: 32 },
  tabBar: { flexDirection: "row", backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border, paddingBottom: 18, paddingTop: 6 },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 10 },
  tabLabel: { fontFamily: font.medium, fontSize: 13, color: color.textTertiary },
  tabLabelActive: { color: color.text, fontFamily: font.semibold },
  tabBusyDot: { position: "absolute", top: -2, right: -8, width: 6, height: 6, borderRadius: 3, backgroundColor: color.warn },
});
