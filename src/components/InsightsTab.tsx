import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ClientInstalledBase } from "./ClientInstalledBase";
import { OverviewDashboard } from "./OverviewDashboard";
import { computeOverview } from "../lib/store";
import type { ObservationRecord } from "../../shared/observation";
import { useTheme, type Theme } from "../lib/theme";

type Mode = "global" | "cliente";

export function InsightsTab({ observations, onViewClient }: {
  observations: ObservationRecord[]; onViewClient: (client: string) => void;
}) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const [mode, setMode] = useState<Mode>("global");
  const [client, setClient] = useState<string | null>(null);

  const clients = useMemo(
    () => [...new Set(observations.map((o) => o.client).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [observations],
  );

  const filteredObs = mode === "cliente" && client ? observations.filter((o) => o.client === client) : observations;
  const overview = useMemo(() => computeOverview(filteredObs), [filteredObs]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Insights</Text>

      <View style={styles.segment}>
        {(["global", "cliente"] as Mode[]).map((m) => (
          <Pressable key={m} style={[styles.segmentBtn, mode === m && styles.segmentBtnActive]} onPress={() => setMode(m)}>
            <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>{m === "global" ? "Global" : "Por cliente"}</Text>
          </Pressable>
        ))}
      </View>

      {mode === "cliente" && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.clientRow}>
          {clients.map((c) => (
            <Pressable key={c} style={[styles.clientChip, client === c && styles.clientChipActive]} onPress={() => setClient(c)}>
              <Text style={[styles.clientChipText, client === c && styles.clientChipTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {mode === "cliente" && !client ? (
        <Text style={styles.muted}>Elige un cliente arriba para ver su análisis filtrado.</Text>
      ) : (
        <>
          <OverviewDashboard overview={overview} observations={filteredObs} />
          <ClientInstalledBase observations={filteredObs} onViewClient={onViewClient} />
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg },
    content: { padding: 16, gap: 14, paddingBottom: 32 },
    title: { color: theme.text, fontSize: 20, fontWeight: "700" },
    segment: { flexDirection: "row", backgroundColor: theme.surfaceAlt, borderRadius: 10, padding: 3 },
    segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
    segmentBtnActive: { backgroundColor: theme.accent },
    segmentText: { color: theme.textMuted, fontSize: 13, fontWeight: "600" },
    segmentTextActive: { color: theme.accentText },
    clientRow: { flexDirection: "row" },
    clientChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, marginRight: 8 },
    clientChipActive: { backgroundColor: theme.accentSoft, borderColor: theme.accent },
    clientChipText: { color: theme.textMuted, fontSize: 12 },
    clientChipTextActive: { color: theme.accent, fontWeight: "600" },
    muted: { color: theme.textMuted, fontSize: 13, textAlign: "center", marginTop: 24 },
  });
}
