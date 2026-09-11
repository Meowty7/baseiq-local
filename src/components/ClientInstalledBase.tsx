import { Pressable, StyleSheet, Text, View } from "react-native";
import { aggregate360, type ObservationRecord } from "../../shared/observation";
import { useTheme, type Theme } from "../lib/theme";

const MODALITY_LABELS: Record<string, string> = {
  resonador: "Resonadores",
  tomografo: "Tomógrafos",
  ecografo: "Ecógrafos",
  "rayos-x": "Rayos X",
  mamografo: "Mamógrafos",
  otra: "Otros",
};

function freshnessColor(freshness: string, theme: Theme): string {
  if (freshness === "reciente") return theme.statusColors.Confirmado;
  if (freshness === "por verificar") return theme.warningText;
  return theme.dangerText;
}

export function ClientInstalledBase({ observations, onViewClient }: {
  observations: ObservationRecord[]; onViewClient?: (client: string) => void;
}) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const rows = aggregate360(observations);
  const byClient = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byClient.get(r.client) ?? [];
    list.push(r);
    byClient.set(r.client, list);
  }
  const entries = [...byClient.entries()];

  return (
    <View style={styles.card}>
      <Text style={styles.h2}>Customer 360 — base instalada</Text>
      {rows.length === 0 ? (
        <Text style={styles.muted}>Sin observaciones todavía. Captura la primera en la pestaña Captura.</Text>
      ) : (
        entries.map(([client, list]) => (
          <ClientBlock key={client} client={client} list={list} theme={theme} onViewClient={onViewClient} />
        ))
      )}
    </View>
  );
}

function ClientBlock({ client, list, theme, onViewClient }: {
  client: string; list: ReturnType<typeof aggregate360>; theme: Theme; onViewClient?: (client: string) => void;
}) {
  const styles = makeStyles(theme);
  const loc = [list[0]?.city, list[0]?.country].filter(Boolean).join(", ");

  return (
    <View style={styles.clientBlock}>
      <View style={styles.clientHeader}>
        <Text style={styles.h3}>{client}</Text>
        {onViewClient && (
          <Pressable style={styles.linkBtn} onPress={() => onViewClient(client)}>
            <Text style={styles.link}>Ver registros →</Text>
          </Pressable>
        )}
      </View>
      {loc ? <Text style={styles.locText}>{loc}</Text> : null}

      <View style={styles.tableHeader}>
        <Text style={[styles.th, { flex: 1.6 }]}>Modalidad</Text>
        <Text style={[styles.th, styles.thCenter]}>Cant.</Text>
        <Text style={[styles.th, styles.thCenter]}>Edad</Text>
      </View>

      {list.map((r, i) => (
        <View key={i} style={styles.tableRow}>
          <View style={styles.tableRowMain}>
            <Text style={[styles.td, { flex: 1.6 }]}>{MODALITY_LABELS[r.modality] ?? r.modality}</Text>
            <Text style={[styles.td, styles.tdCenter]}>{r.quantity}</Text>
            <Text style={[styles.td, styles.tdCenter]}>{r.ageRange ?? "—"}</Text>
          </View>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, { borderColor: theme.statusColors[r.confidence] ?? theme.textMuted }]}>
              <Text style={[styles.badgeText, { color: theme.statusColors[r.confidence] ?? theme.textMuted }]}>
                {r.confidence}
              </Text>
            </View>
            <View style={[styles.badge, { borderColor: freshnessColor(r.freshness, theme) }]}>
              <Text style={[styles.badgeText, { color: freshnessColor(r.freshness, theme) }]}>{r.freshness}</Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    card: { backgroundColor: theme.surface, borderRadius: 12, padding: 16, gap: 12 },
    h2: { color: theme.text, fontSize: 18, fontWeight: "600" },
    h3: { color: theme.text, fontSize: 15, fontWeight: "600", flex: 1, flexWrap: "wrap" },
    muted: { color: theme.textMuted, fontSize: 12, fontWeight: "400" },
    locText: { color: theme.textMuted, fontSize: 12 },
    link: { color: theme.accent, fontSize: 12, fontWeight: "600" },
    linkBtn: { flexShrink: 0, marginLeft: 8 },
    clientBlock: { backgroundColor: theme.surfaceAlt, borderRadius: 8, padding: 12, gap: 6 },
    clientHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    tableHeader: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: theme.border },
    th: { color: theme.textMuted, fontSize: 10, flex: 1, textTransform: "uppercase" },
    thCenter: { textAlign: "center" },
    tableRow: { paddingVertical: 6, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
    tableRowMain: { flexDirection: "row", alignItems: "center" },
    td: { color: theme.text, fontSize: 12, flex: 1 },
    tdCenter: { textAlign: "center" },
    badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" },
    badgeText: { fontSize: 11, fontWeight: "600" },
  });
}
