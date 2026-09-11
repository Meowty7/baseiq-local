import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ObservationRecord } from "../../shared/observation";
import type { OverviewResult } from "../lib/store";
import { useTheme, type Theme } from "../lib/theme";

const MODALITY_LABELS: Record<string, string> = {
  resonador: "Resonadores",
  tomografo: "Tomógrafos",
  ecografo: "Ecógrafos",
  "rayos-x": "Rayos X",
  mamografo: "Mamógrafos",
  otra: "Otros",
};

function maxOf(entries: [string, number][]): number {
  return Math.max(1, ...entries.map(([, n]) => n));
}

export function OverviewDashboard({ overview, observations }: { overview: OverviewResult | null; observations: ObservationRecord[] }) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  if (!overview) return <View style={styles.card}><Text style={styles.h2}>Resumen</Text><Text style={styles.muted}>Cargando…</Text></View>;

  const geoTree = buildGeoTree(observations);
  const modEntries = Object.entries(overview.byModality);
  const max = maxOf(modEntries);

  return (
    <View style={styles.card}>
      <Text style={styles.h2}>Resumen</Text>
      <Text style={styles.stat}>{overview.observations} observaciones · {overview.fieldsUnknown} campos por verificar</Text>

      <Text style={styles.h3}>Por modalidad</Text>
      {modEntries.length === 0 ? <Text style={styles.muted}>Sin datos.</Text> : modEntries.map(([k, n]) => (
        <View key={k} style={styles.barRow}>
          <Text style={styles.barLabel} numberOfLines={1} ellipsizeMode="tail">{MODALITY_LABELS[k] ?? k}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.min(100, (n / max) * 100)}%` }]} />
          </View>
          <Text style={styles.barNum} numberOfLines={1}>{n}</Text>
        </View>
      ))}

      <Text style={styles.h3}>Mapa geográfico</Text>
      {geoTree.length === 0 ? <Text style={styles.muted}>Sin datos geográficos.</Text> : (
        geoTree.map((g) => <CountryNode key={g.country} data={g} theme={theme} />)
      )}

      <Text style={styles.h3}>Oportunidades de renovación <Text style={styles.mutedSmall}>(≥ 7 años)</Text></Text>
      {overview.renewals.length === 0 ? <Text style={styles.muted}>Sin equipos en edad de renovación.</Text> : (
        overview.renewals.map((r, i) => (
          <Text key={i} style={styles.renewItem}>
            {r.client} · {r.modality ?? "equipo"}{r.brand ? ` ${r.brand}` : ""}{r.model ? ` ${r.model}` : ""} · {r.ageYears} años
          </Text>
        ))
      )}

      <Text style={styles.h3}>Frescura de datos</Text>
      {overview.stale.length === 0 ? <Text style={styles.muted}>Todo verificado recientemente.</Text> : (
        overview.stale.map((s, i) => <Text key={i} style={styles.question}>{s}</Text>)
      )}

      <Text style={styles.h3}>Conflictos <Text style={styles.mutedSmall}>(no se fusionan solos)</Text></Text>
      {overview.conflicts.length === 0 ? <Text style={styles.muted}>Sin observaciones contradictorias.</Text> : (
        overview.conflicts.map((c, i) => (
          <Text key={i} style={styles.question}>{c.client} · {c.modality}: {c.detail} ({c.dates.join(" / ")})</Text>
        ))
      )}
      {overview.duplicates.map((d, i) => <Text key={`d${i}`} style={styles.question}>Posible duplicado: {d}</Text>)}
    </View>
  );
}

interface GeoLeafData { city: string; client: string; n: number }
interface GeoNodeData { country: string; total: number; leaves: GeoLeafData[] }

function buildGeoTree(obs: ObservationRecord[]): GeoNodeData[] {
  const tree = new Map<string, Map<string, number>>();
  for (const o of obs) {
    const country = o.country ?? "Sin país";
    const city = o.city ?? "Sin ciudad";
    const client = o.client ?? "Sin cliente";
    const leaves = tree.get(country) ?? new Map();
    const key = `${city}||${client}`;
    leaves.set(key, (leaves.get(key) ?? 0) + 1);
    tree.set(country, leaves);
  }
  return [...tree.entries()].map(([country, leaves]) => {
    const leafRows = [...leaves.entries()].map(([key, n]) => {
      const [city, client] = key.split("||");
      return { city, client, n };
    });
    return { country, leaves: leafRows, total: leafRows.reduce((a, c) => a + c.n, 0) };
  });
}

// Un único nivel de despliegue (país → cliente): dos niveles anidados hacían
// que el primer toque pareciera no hacer nada al revelar solo un nodo intermedio.
function CountryNode({ data, theme }: { data: GeoNodeData; theme: Theme }) {
  const [expanded, setExpanded] = useState(false);
  const styles = makeStyles(theme);
  return (
    <View>
      <Pressable onPress={() => setExpanded((e) => !e)} style={styles.geoNodeRow} hitSlop={6}>
        <Text style={styles.geoChevron}>{expanded ? "▼" : "▶"}</Text>
        <Text style={styles.geoNode}>{data.country} ({data.total} obs.)</Text>
      </Pressable>
      {expanded && (
        data.leaves.length === 0 ? (
          <Text style={styles.geoEmpty}>Sin observaciones en este país.</Text>
        ) : (
          data.leaves.map((l) => (
            <Text key={`${l.city}||${l.client}`} style={styles.geoLeaf}>
              · {l.client}{l.city !== "Sin ciudad" ? ` — ${l.city}` : ""} ({l.n})
            </Text>
          ))
        )
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    card: { backgroundColor: theme.surface, borderRadius: 12, padding: 16, gap: 10 },
    h2: { color: theme.text, fontSize: 18, fontWeight: "600" },
    h3: { color: theme.text, fontSize: 14, fontWeight: "600", marginTop: 4 },
    stat: { color: theme.textMuted, fontSize: 13 },
    muted: { color: theme.textMuted, fontSize: 12 },
    mutedSmall: { color: theme.textMuted, fontSize: 11, fontWeight: "400" },
    barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    barLabel: { color: theme.textMuted, fontSize: 11, width: 88, flexShrink: 0 },
    barTrack: { flex: 1, height: 8, backgroundColor: theme.surfaceAlt, borderRadius: 4, overflow: "hidden" },
    barFill: { height: "100%", backgroundColor: theme.accent, borderRadius: 4 },
    barNum: { color: theme.text, fontSize: 12, fontWeight: "600", minWidth: 32, textAlign: "right", flexShrink: 0 },
    geoNodeRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
    geoChevron: { color: theme.accent, fontSize: 11, width: 12 },
    geoNode: { color: theme.text, fontSize: 13, fontWeight: "600", flexShrink: 1 },
    geoEmpty: { color: theme.textMuted, fontSize: 11, marginLeft: 18, paddingVertical: 2 },
    geoLeaf: { color: theme.textMuted, fontSize: 12, paddingVertical: 3, marginLeft: 18 },
    renewItem: { color: theme.textMuted, fontSize: 12, paddingVertical: 2 },
    question: { color: theme.warningText, fontSize: 12, paddingVertical: 2 },
  });
}
