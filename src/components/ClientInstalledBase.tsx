import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { aggregate360, type Client360Row, type ObservationRecord } from "../../shared/observation";
import { Card, Input, Row, SectionHeader, StatusText } from "../ui/primitives";
import { MODALITY_LABELS, font, space, useTheme, type Theme } from "../ui/theme";

export function ClientInstalledBase({ observations, onViewClient }: {
  observations: ObservationRecord[]; onViewClient?: (client: string) => void;
}) {
  const [query, setQuery] = useState("");

  const byClient = useMemo(() => {
    const map = new Map<string, Client360Row[]>();
    for (const r of aggregate360(observations)) {
      const list = map.get(r.client) ?? [];
      list.push(r);
      map.set(r.client, list);
    }
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const order: string[] = [];
    for (const o of observations) {
      const name = o.client ?? "Sin cliente";
      if (!seen.has(name)) { seen.add(name); order.push(name); }
    }
    return order
      .filter((client) => {
        const list = map.get(client);
        if (!list) return false;
        return !q || client.toLowerCase().includes(q) || list.some((r) => (r.city ?? "").toLowerCase().includes(q));
      })
      .map((client) => [client, map.get(client)!] as const);
  }, [observations, query]);

  return (
    <View style={{ gap: 24 }}>
      <Input value={query} onChangeText={setQuery} placeholder="Buscar por cliente o ciudad" />

      <View>
        <SectionHeader title={`Clientes (${byClient.length})`} />
        <View style={{ gap: space.md }}>
          {observations.length === 0 ? (
            <Card><Row label="Sin observaciones todavía. Captura la primera en la pestaña Capturar." last /></Card>
          ) : byClient.length === 0 ? (
            <Card><Row label={`Sin resultados para “${query.trim()}”`} last /></Card>
          ) : (
            byClient.map(([client, list]) => (
              <ClientCard
                key={client}
                client={client}
                list={list}
                observations={observations.filter((o) => o.client === client)}
                onViewClient={onViewClient}
              />
            ))
          )}
        </View>
      </View>
    </View>
  );
}

function ClientCard({ client, list, observations, onViewClient }: {
  client: string; list: Client360Row[]; observations: ObservationRecord[]; onViewClient?: (client: string) => void;
}) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const [expanded, setExpanded] = useState(false);
  const location = [list[0]?.city, list[0]?.country].filter(Boolean).join(", ");
  const newest = [...observations].sort((a, b) => b.id - a.id)[0];
  const n = observations.length;
  const meta = [location, `${n} ${n === 1 ? "observación" : "observaciones"}`, newest ? `última ${formatWhen(newest)}` : null].filter(Boolean).join(" · ");

  return (
    <Card>
      <Pressable onPress={() => setExpanded(!expanded)} accessibilityRole="button" style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
        <View style={styles.headerTop}>
          <Text style={[theme.type.heading, styles.headerTitle]}>{client}</Text>
          {onViewClient && (
            <Pressable onPress={() => onViewClient(client)} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.footerText}>Ver registros ›</Text>
            </Pressable>
          )}
        </View>
        <Text style={theme.type.secondary}>{meta}</Text>
      </Pressable>

      {list.map((r, i) => (
        <View key={r.modality} style={[styles.row, i < list.length - 1 && styles.divider]}>
          <View style={styles.rowMain}>
            <Text style={theme.type.body}>{`${r.quantity} × ${MODALITY_LABELS[r.modality] ?? r.modality}`}</Text>
            <Text style={theme.type.secondary}>{`${r.ageRange ? `${r.ageRange} años` : "Antigüedad desconocida"} · ${r.freshness}`}</Text>
          </View>
          <StatusText label={r.confidence} tone={theme.statusColor[r.confidence] ?? theme.color.textTertiary} />
        </View>
      ))}

      <Pressable onPress={() => setExpanded(!expanded)} accessibilityRole="button" style={({ pressed }) => [styles.footer, pressed && styles.pressed]}>
        <Text style={styles.footerText}>{expanded ? "Ocultar observaciones" : `Ver observaciones (${n})`}</Text>
      </Pressable>

      {expanded && [...observations].sort((a, b) => b.id - a.id).map((o) => <ObservationBlock key={o.id} o={o} />)}
    </Card>
  );
}

function formatWhen(o: ObservationRecord): string {
  const raw = o.createdAt || o.observedAt;
  if (!raw) return "sin fecha";
  const d = new Date(raw.includes("T") ? raw : `${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function ObservationBlock({ o }: { o: ObservationRecord }) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const summary = o.equipment.map((e) => {
    const label = e.modality ? MODALITY_LABELS[e.modality] ?? e.modality : "equipo";
    const name = [label.charAt(0).toLowerCase() + label.slice(1), e.brand, e.model].filter(Boolean).join(" ");
    return `${e.quantity ?? "?"} × ${name}${e.ageYears !== null ? ` · ${e.ageYears} años` : ""}`;
  }).join("; ");
  const evidence = o.equipment.map((e) => e.evidence).filter((v): v is string => !!v);

  return (
    <View style={styles.observation}>
      <Text style={theme.type.body}>{summary}</Text>
      <Text style={theme.type.secondary}>
        <Text style={{ color: theme.statusColor[o.status] ?? theme.color.textTertiary }}>{o.status}</Text>
        {` · ${formatWhen(o)}${o.submittedBy ? ` · ${o.submittedBy}` : ""}${o.sourceType ? ` · ${o.sourceType}` : ""}`}
      </Text>
      {evidence.map((q, i) => <Text key={i} style={[theme.type.secondary, styles.italic]}>“{q}”</Text>)}
      <Text style={theme.type.caption}>{o.sourceText}</Text>
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { color } = theme;
  return StyleSheet.create({
    header: { padding: space.lg, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
    headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
    headerTitle: { flex: 1 },
    row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 13 },
    rowMain: { flex: 1, gap: 2 },
    divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
    footer: { paddingHorizontal: space.lg, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
    footerText: { fontFamily: font.medium, fontSize: 13, color: color.link },
    observation: { padding: space.lg, gap: space.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
    italic: { fontStyle: "italic" },
    pressed: { opacity: 0.6 },
  });
}
