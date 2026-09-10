import { SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { useStore } from "./src/lib/store";
import { ObservationCapture } from "./src/components/ObservationCapture";
import { ClientInstalledBase } from "./src/components/ClientInstalledBase";
import { OverviewDashboard } from "./src/components/OverviewDashboard";

export default function App() {
  const store = useStore();

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>Philips · Base instalada · prototipo de campo</Text>
            <Text style={styles.h1}>BaseIQ Local</Text>
          </View>
          <View style={[styles.pill, store.status.ready ? styles.pillReady : styles.pillLoading]}>
            <Text style={styles.pillText}>
              {store.status.ready ? "● IA local lista" : "○ cargando modelo…"}
              {store.progress != null ? ` ${Math.round(store.progress)}%` : ""}
              {store.status.device ? ` ${store.status.device.toUpperCase()}` : ""}
              {store.status.lastInferMs != null ? ` ${(store.status.lastInferMs / 1000).toFixed(1)}s` : ""}
            </Text>
          </View>
        </View>

        <ObservationCapture store={store} />
        <ClientInstalledBase observations={store.observations} />
        <OverviewDashboard overview={store.overview} observations={store.observations} />

        <Text style={styles.footer}>100% en el dispositivo · QVAC {store.status.model} · datos sintéticos</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0B0F" },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  kicker: { color: "#7E7E8A", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  h1: { color: "#fff", fontSize: 24, fontWeight: "700", marginTop: 2 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, alignSelf: "flex-start" },
  pillReady: { backgroundColor: "rgba(34,197,94,0.15)" },
  pillLoading: { backgroundColor: "rgba(255,255,255,0.06)" },
  pillText: { color: "#A7A7B3", fontSize: 12 },
  footer: { color: "#7E7E8A", fontSize: 11, textAlign: "center", marginTop: 8 },
});
