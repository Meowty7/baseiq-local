import { Fragment } from "react";
import { StyleSheet, Text, View } from "react-native";
import { OBSERVATION_STATUSES, type ObservationRecord } from "../../shared/observation";
import type { OverviewResult } from "../lib/store";
import { BarRow, Card, Row, SectionHeader } from "../ui/primitives";
import { MODALITY_LABELS, space, useTheme, type Theme } from "../ui/theme";

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

type AgeBracket = "0–3 años" | "4–6 años" | "7+ años" | "Sin dato";
const AGE_BRACKETS: AgeBracket[] = ["0–3 años", "4–6 años", "7+ años", "Sin dato"];

function ageBracket(age: number | null): AgeBracket {
  if (age === null) return "Sin dato";
  if (age <= 3) return "0–3 años";
  if (age <= 6) return "4–6 años";
  return "7+ años";
}

function buildAgeHistogram(observations: ObservationRecord[]): Record<AgeBracket, number> {
  const buckets: Record<AgeBracket, number> = { "0–3 años": 0, "4–6 años": 0, "7+ años": 0, "Sin dato": 0 };
  for (const o of observations) {
    for (const e of o.equipment) {
      if (!e.modality) continue;
      buckets[ageBracket(e.ageYears)] += e.quantity ?? 1;
    }
  }
  return buckets;
}

function buildStatusHistogram(observations: ObservationRecord[]): { status: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const o of observations) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
  return OBSERVATION_STATUSES.map((s) => ({ status: s, n: counts.get(s) ?? 0 }));
}

function buildRenewalRanking(renewals: OverviewResult["renewals"]): { client: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const r of renewals) counts.set(r.client, (counts.get(r.client) ?? 0) + 1);
  return [...counts.entries()].map(([client, n]) => ({ client, n })).sort((a, b) => b.n - a.n).slice(0, 5);
}

export function OverviewDashboard({ overview, observations, onViewClient }: {
  overview: OverviewResult | null; observations: ObservationRecord[]; onViewClient?: (client: string) => void;
}) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);

  if (!overview) {
    return (
      <View style={{ gap: space.xl }}>
        <Card><Row label="Cargando resumen…" last /></Card>
      </View>
    );
  }

  const recent = [...observations].sort((a, b) => b.id - a.id).slice(0, 8);
  const modEntries = Object.entries(overview.byModality);
  const maxModality = Math.max(1, ...modEntries.map(([, n]) => n));

  const ageHist = buildAgeHistogram(observations);
  const ageTotal = Math.max(1, Object.values(ageHist).reduce((a, b) => a + b, 0));
  const knownAgeTotal = ageTotal - ageHist["Sin dato"];
  const pct7plus = knownAgeTotal > 0 ? ageHist["7+ años"] / knownAgeTotal : 0;
  const ageTone: Record<AgeBracket, string> = {
    "0–3 años": theme.color.ok, "4–6 años": theme.color.warn, "7+ años": theme.color.danger, "Sin dato": theme.color.textTertiary,
  };
  const ageHeadline = knownAgeTotal === 0
    ? "Aún no hay suficiente dato de antigüedad para evaluar el parque."
    : pct7plus >= 0.3
      ? `Prioridad alta: ${Math.round(pct7plus * 100)}% del parque con antigüedad conocida supera los 7 años.`
      : pct7plus > 0
        ? `${Math.round(pct7plus * 100)}% del parque supera los 7 años — vigilar para renovación.`
        : "Sin equipos en edad de renovación por ahora.";

  const statusHist = buildStatusHistogram(observations);
  const statusTotal = Math.max(1, observations.length);
  const confirmedPct = observations.length > 0 ? Math.round((statusHist.find((s) => s.status === "Confirmado")?.n ?? 0) / observations.length * 100) : 0;

  const renewalRanking = buildRenewalRanking(overview.renewals);

  const issueGroups: { title: string; items: { label: string; detail: string }[] }[] = [
    { title: "Conflictos", items: overview.conflicts.map((c) => ({ label: `${c.client} · ${modalityLabel(c.modality)}`, detail: c.detail })) },
    { title: "Duplicados", items: overview.duplicates.map((d) => ({ label: "Posible duplicado", detail: d })) },
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
                onPress={o.client && onViewClient ? () => onViewClient(o.client!) : undefined}
                last={i === recent.length - 1}
              />
            ))
          )}
        </Card>
      </View>

      <View>
        <SectionHeader title="Salud del parque instalado" />
        <Card>
          <View style={styles.headline}>
            <Text style={theme.type.body}>{ageHeadline}</Text>
          </View>
          {AGE_BRACKETS.map((b) => (
            <BarRow key={b} label={b} fraction={ageHist[b] / ageTotal} valueLabel={String(ageHist[b])} tone={ageTone[b]} />
          ))}
        </Card>
      </View>

      <View>
        <SectionHeader title="Calidad de datos" />
        <Card>
          <View style={styles.headline}>
            <Text style={theme.type.body}>
              {observations.length === 0 ? "Sin observaciones todavía." : `${confirmedPct}% de las observaciones están confirmadas.`}
            </Text>
          </View>
          {statusHist.map(({ status, n }) => (
            <BarRow key={status} label={status} fraction={n / statusTotal} valueLabel={String(n)} tone={theme.statusColor[status] ?? theme.color.textTertiary} />
          ))}
          <Row
            label="Por verificar (sin actividad hace 90+ días)"
            value={String(overview.stale.length)}
            valueColor={overview.stale.length > 0 ? theme.color.warn : undefined}
            last
          />
        </Card>
      </View>

      <View>
        <SectionHeader title="Equipos por modalidad" />
        <Card>
          {modEntries.length === 0 ? <Row label="Sin equipos todavía" last /> : (
            modEntries.map(([k, n]) => (
              <BarRow key={k} label={MODALITY_LABELS[k] ?? k} fraction={n / maxModality} valueLabel={String(n)} tone={theme.color.primary} />
            ))
          )}
        </Card>
      </View>

      <View>
        <SectionHeader title="Recomendaciones" />
        <Card>
          {renewalRanking.length === 0 ? (
            <Row label="Sin oportunidades de renovación detectadas todavía." last />
          ) : (
            renewalRanking.map((r, i) => (
              <Row
                key={r.client}
                label={r.client}
                detail={`${r.n} ${r.n === 1 ? "equipo" : "equipos"} con 7+ años · candidato a renovación`}
                onPress={onViewClient ? () => onViewClient(r.client) : undefined}
                last={i === renewalRanking.length - 1}
              />
            ))
          )}
        </Card>
      </View>

      {issueGroups.length > 0 && (
        <View>
          <SectionHeader title="Conflictos y duplicados" />
          <Card>
            {issueGroups.map((g, gi) => (
              <Fragment key={g.title}>
                {issueGroups.length > 1 && <Text style={styles.groupLabel}>{g.title}</Text>}
                {g.items.map((it, i) => (
                  <Row key={`${g.title}-${i}`} label={it.label} detail={it.detail} last={gi === issueGroups.length - 1 && i === g.items.length - 1} />
                ))}
              </Fragment>
            ))}
          </Card>
        </View>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    groupLabel: { ...theme.type.caption, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
    headline: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  });
}
