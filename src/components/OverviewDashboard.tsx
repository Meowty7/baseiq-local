import { Fragment } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ObservationRecord } from "../../shared/observation";
import type { OverviewResult } from "../lib/store";
import { Card, Row, SectionHeader } from "../ui/primitives";
import { MODALITY_LABELS, color, space, type } from "../ui/theme";

const modalityLabel = (m: string | null | undefined) => (m ? MODALITY_LABELS[m] ?? m : "Equipo");

function summarize(o: ObservationRecord): string {
  if (o.equipment.length === 0) return "Sin equipos en esta nota";
  return o.equipment.map((e) => `${e.quantity ?? "?"} × ${modalityLabel(e.modality)}`).join(", ");
}

function when(o: ObservationRecord): string {
  const raw = o.createdAt || o.observedAt;
  if (!raw) return "";
  const d = new Date(raw.includes("T") ? raw : `${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function OverviewDashboard({ overview, observations }: { overview: OverviewResult | null; observations: ObservationRecord[] }) {
  if (!overview) {
    return (
      <View style={{ gap: space.xl }}>
        <Card><Row label="Cargando resumen…" last /></Card>
      </View>
    );
  }

  const recent = [...observations].sort((a, b) => b.id - a.id).slice(0, 8);
  const modEntries = Object.entries(overview.byModality);
  const issueCount = overview.conflicts.length + overview.duplicates.length;

  const groups: { title: string; items: { label: string; detail: string }[] }[] = [
    {
      title: "Renovación",
      items: overview.renewals.map((r) => ({
        label: `${r.client} · ${modalityLabel(r.modality)}`,
        detail: `Equipo ${[r.brand, r.model].filter(Boolean).join(" ") || "sin marca ni modelo"} con ${r.ageYears ?? "?"} años; candidato a renovación`,
      })),
    },
    {
      title: "Conflictos",
      items: overview.conflicts.map((c) => ({ label: `${c.client} · ${modalityLabel(c.modality)}`, detail: c.detail })),
    },
    {
      title: "Duplicados",
      items: overview.duplicates.map((d) => ({ label: "Posible duplicado", detail: d })),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <View style={{ gap: space.xl }}>
      <View>
        <SectionHeader title="Recientes" />
        <Card>
          {recent.length === 0 ? <Row label="Aún no hay observaciones guardadas." last /> : (
            recent.map((o, i) => (
              <Row
                key={o.id}
                label={o.client ?? "Sin cliente"}
                detail={summarize(o)}
                value={when(o)}
                last={i === recent.length - 1}
              />
            ))
          )}
        </Card>
      </View>

      <View>
        <SectionHeader title="Pendientes" />
        <Card>
          <Row label="Campos por verificar" value={String(overview.fieldsUnknown)} valueColor={overview.fieldsUnknown > 0 ? color.warn : undefined} />
          <Row label="Equipos a renovar (7 años o más)" value={String(overview.renewals.length)} valueColor={overview.renewals.length > 0 ? color.warn : undefined} />
          <Row label="Conflictos y duplicados" value={String(issueCount)} valueColor={issueCount > 0 ? color.danger : undefined} />
          <Row label="Observaciones registradas" value={String(overview.observations)} last />
        </Card>
      </View>

      {groups.length > 0 && (
        <View>
          <SectionHeader title="Requiere atención" />
          <Card>
            {groups.map((g, gi) => (
              <Fragment key={g.title}>
                {groups.length > 1 && <Text style={styles.groupLabel}>{g.title}</Text>}
                {g.items.map((it, i) => (
                  <Row key={`${g.title}-${i}`} label={it.label} detail={it.detail} last={gi === groups.length - 1 && i === g.items.length - 1} />
                ))}
              </Fragment>
            ))}
          </Card>
        </View>
      )}

      <View>
        <SectionHeader title="Equipos por modalidad" />
        <Card>
          {modEntries.length === 0 ? <Row label="Sin equipos todavía" last /> : (
            modEntries.map(([k, n], i) => <Row key={k} label={MODALITY_LABELS[k] ?? k} value={String(n)} last={i === modEntries.length - 1} />)
          )}
        </Card>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  groupLabel: { ...type.caption, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
});
