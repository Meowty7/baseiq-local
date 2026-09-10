import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ObservationRecord } from "../../shared/observation";
import type { OverviewResult } from "../lib/store";

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
  if (!overview) return <View style={styles.card}><Text style={styles.h2}>Resumen global</Text><Text style={styles.muted}>Cargando…</Text></View>;

  const geoTree = buildGeoTree(observations);
  const modEntries = Object.entries(overview.byModality);
  const max = maxOf(modEntries);

  return (
    <View style={styles.card}>
      <Text style={styles.h2}>Resumen global</Text>
      <Text style={styles.stat}>{overview.observations} observaciones · {overview.fieldsUnknown} campos por verificar</Text>

      <Text style={styles.h3}>Por modalidad</Text>
      {modEntries.map(([k, n]) => (
        <View key={k} style={styles.barRow}>
          <Text style={styles.barLabel}>{MODALITY_LABELS[k] ?? k}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${(n / max) * 100}%` }]} />
          </View>
          <Text style={styles.barNum}>{n}</Text>
        </View>
      ))}

      <Text style={styles.h3}>Mapa geográfico</Text>
      {geoTree.length === 0 ? <Text style={styles.muted}>Sin datos geográficos.</Text> : (
        geoTree.map((g) => <GeoNode key={g.country} label={`${g.country} (${g.total} obs.)`} level={0} />)
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

interface GeoNodeData { country: string; total: number; cities: { city: string; total: number; clients: { client: string; n: number }[] }[] }

function buildGeoTree(obs: ObservationRecord[]): GeoNodeData[] {
  const tree = new Map<string, Map<string, Map<string, number>>>();
  for (const o of obs) {
    const country = o.country ?? "Sin país";
    const city = o.city ?? "Sin ciudad";
    const client = o.client ?? "Sin cliente";
    const cities = tree.get(country) ?? new Map();
    const clients = cities.get(city) ?? new Map();
    clients.set(client, (clients.get(client) ?? 0) + 1);
    cities.set(city, clients);
    tree.set(country, cities);
  }
  return [...tree.entries()].map(([country, cities]) => ({
    country,
    cities: [...cities.entries()].map(([city, clients]) => ({
      city,
      clients: [...clients.entries()].map(([client, n]) => ({ client, n })),
    })),
  })).map((g) => ({ ...g, total: g.cities.reduce((a, c) => a + c.clients.reduce((b, cl) => b + cl.n, 0), 0) }));
}

function GeoNode({ label, level }: { label: string; level: number }) {
  const [expanded, setExpanded] = useState(level < 1);
  return (
    <Pressable onPress={() => setExpanded(!expanded)} style={{ marginLeft: level * 12 }}>
      <Text style={styles.geoNode}>{expanded ? "▼ " : "▶ "}{label}</Text>
    </Pressable>
  );
}

const BORDER = "#2A2A33";
const CARD_BG = "#121219";

const styles = StyleSheet.create({
  card: { backgroundColor: CARD_BG, borderRadius: 12, padding: 16, gap: 10 },
  h2: { color: "#fff", fontSize: 18, fontWeight: "600" },
  h3: { color: "#fff", fontSize: 14, fontWeight: "600", marginTop: 4 },
  stat: { color: "#A7A7B3", fontSize: 13 },
  muted: { color: "#7E7E8A", fontSize: 12 },
  mutedSmall: { color: "#7E7E8A", fontSize: 11, fontWeight: "400" },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { color: "#A7A7B3", fontSize: 12, width: 80 },
  barTrack: { flex: 1, height: 8, backgroundColor: "#0B0B0F", borderRadius: 4, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: "#2B2BFF", borderRadius: 4 },
  barNum: { color: "#fff", fontSize: 12, fontWeight: "600", width: 24 },
  geoNode: { color: "#A7A7B3", fontSize: 12, paddingVertical: 4 },
  renewItem: { color: "#A7A7B3", fontSize: 12, paddingVertical: 2 },
  question: { color: "#FBBF24", fontSize: 12, paddingVertical: 2 },
});
