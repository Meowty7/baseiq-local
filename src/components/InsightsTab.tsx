import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ObservationRecord } from "../../shared/observation";
import type { OverviewResult } from "../lib/store";
import { OverviewDashboard } from "./OverviewDashboard";
import { ClientInstalledBase } from "./ClientInstalledBase";
import { font, radius, space, useTheme, type Theme } from "../ui/theme";

type Mode = "global" | "clientes";

export function InsightsTab({ overview, observations, onViewClient }: {
  overview: OverviewResult | null; observations: ObservationRecord[]; onViewClient?: (client: string) => void;
}) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const [mode, setMode] = useState<Mode>("global");

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.segment}>
        <Pressable style={[styles.segmentBtn, mode === "global" && styles.segmentBtnActive]} onPress={() => setMode("global")}>
          <Text style={[styles.segmentText, mode === "global" && styles.segmentTextActive]}>Resumen</Text>
        </Pressable>
        <Pressable style={[styles.segmentBtn, mode === "clientes" && styles.segmentBtnActive]} onPress={() => setMode("clientes")}>
          <Text style={[styles.segmentText, mode === "clientes" && styles.segmentTextActive]}>Clientes</Text>
        </Pressable>
      </View>

      {mode === "global" ? (
        <OverviewDashboard overview={overview} observations={observations} />
      ) : (
        <ClientInstalledBase observations={observations} onViewClient={onViewClient} />
      )}
    </ScrollView>
  );
}

function makeStyles(theme: Theme) {
  const { color } = theme;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg },
    content: { padding: space.lg, paddingBottom: 32 },
    segment: { flexDirection: "row", backgroundColor: color.surfaceMuted, borderRadius: radius.md, padding: 3, marginBottom: space.xl },
    segmentBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: "center" },
    segmentBtnActive: { backgroundColor: color.surface, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    segmentText: { fontFamily: font.medium, fontSize: 13, color: color.textSecondary },
    segmentTextActive: { color: color.text, fontFamily: font.semibold },
  });
}
