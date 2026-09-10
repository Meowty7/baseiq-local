import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { aggregate360, type ObservationRecord } from "../../shared/observation";

const MODALITY_LABELS: Record<string, string> = {
  resonador: "Resonadores",
  tomografo: "Tomógrafos",
  ecografo: "Ecógrafos",
  "rayos-x": "Rayos X",
  mamografo: "Mamógrafos",
  otra: "Otros",
};

const STATUS_COLORS: Record<string, string> = {
  Confirmado: "#22C55E",
  Reportado: "#3B82F6",
  Estimado: "#FBBF24",
  Desconocido: "#7E7E8A",
};

export function ClientInstalledBase({ observations }: { observations: ObservationRecord[] }) {
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
        <Text style={styles.muted}>Sin observaciones todavía. Captura la primera arriba.</Text>
      ) : (
        entries.map(([client, list]) => (
          <ClientBlock key={client} client={client} list={list} observations={observations} />
        ))
      )}
    </View>
  );
}

function ClientBlock({ client, list, observations }: { client: string; list: ReturnType<typeof aggregate360>; observations: ObservationRecord[] }) {
  const [expanded, setExpanded] = useState(false);
  const obs = observations.filter((o) => o.client === client);
  const loc = [list[0]?.city, list[0]?.country].filter(Boolean).join(", ");

  return (
    <View style={styles.clientBlock}>
      <Pressable onPress={() => setExpanded(!expanded)}>
        <Text style={styles.h3}>{client} <Text style={styles.muted}>{loc ? `· ${loc}` : ""}</Text></Text>
      </Pressable>

      <View style={styles.tableHeader}>
        <Text style={[styles.th, { flex: 1.5 }]}>Modalidad</Text>
        <Text style={styles.th}>Cant.</Text>
        <Text style={styles.th}>Edad</Text>
        <Text style={styles.th}>Conf.</Text>
        <Text style={styles.th}>Fres.</Text>
      </View>

      {list.map((r, i) => (
        <View key={i} style={styles.tableRow}>
          <Text style={[styles.td, { flex: 1.5 }]}>{MODALITY_LABELS[r.modality] ?? r.modality}</Text>
          <Text style={styles.td}>{r.quantity}</Text>
          <Text style={styles.td}>{r.ageRange ?? "—"}</Text>
          <Text style={[styles.td, { color: STATUS_COLORS[r.confidence] ?? "#7E7E8A" }]}>{r.confidence}</Text>
          <Text style={styles.td}>{r.freshness}</Text>
        </View>
      ))}

      {expanded && (
        <View style={styles.obsList}>
          {obs.map((o) => (
            <View key={o.id} style={styles.obsItem}>
              <Text style={styles.obsEquip}>
                {o.equipment.map((e) => `${e.quantity ?? "?"}× ${e.modality ?? "equipo"}${e.brand ? ` ${e.brand}` : ""}${e.model ? ` ${e.model}` : ""}${e.ageYears !== null ? ` · ${e.ageYears} años` : ""}`).join("; ")}
              </Text>
              <Text style={[styles.obsStatus, { color: STATUS_COLORS[o.status] ?? "#7E7E8A" }]}>{o.status}</Text>
              <Text style={styles.obsMeta}>{o.observedAt ?? o.createdAt.slice(0, 10)}{o.submittedBy ? ` · ${o.submittedBy}` : ""}{o.sourceType ? ` · ${o.sourceType}` : ""}</Text>
              {o.equipment.some((e) => e.evidence) && (
                <View style={styles.evidenceList}>
                  {o.equipment.filter((e) => e.evidence).map((e, i) => (
                    <Text key={i} style={styles.evidence}>"{e.evidence}"</Text>
                  ))}
                </View>
              )}
              <Text style={styles.source}>{o.sourceText}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable onPress={() => setExpanded(!expanded)}>
        <Text style={styles.expandToggle}>{expanded ? "▲ Colapsar" : `▼ Observaciones individuales (${obs.length})`}</Text>
      </Pressable>
    </View>
  );
}

const BORDER = "#2A2A33";
const CARD_BG = "#121219";

const styles = StyleSheet.create({
  card: { backgroundColor: CARD_BG, borderRadius: 12, padding: 16, gap: 12 },
  h2: { color: "#fff", fontSize: 18, fontWeight: "600" },
  h3: { color: "#fff", fontSize: 15, fontWeight: "600" },
  muted: { color: "#7E7E8A", fontSize: 12, fontWeight: "400" },
  clientBlock: { backgroundColor: "#0B0B0F", borderRadius: 8, padding: 12, gap: 6 },
  tableHeader: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: BORDER },
  th: { color: "#7E7E8A", fontSize: 10, flex: 1, textTransform: "uppercase" },
  tableRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  td: { color: "#A7A7B3", fontSize: 12, flex: 1 },
  obsList: { gap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: BORDER },
  obsItem: { gap: 2 },
  obsEquip: { color: "#A7A7B3", fontSize: 12 },
  obsStatus: { fontSize: 11, fontWeight: "600" },
  obsMeta: { color: "#555", fontSize: 10 },
  evidenceList: { gap: 2, marginTop: 2 },
  evidence: { color: "#7E7E8A", fontSize: 10, fontStyle: "italic" },
  source: { color: "#555", fontSize: 10, marginTop: 2 },
  expandToggle: { color: "#2B2BFF", fontSize: 11, marginTop: 4 },
});
