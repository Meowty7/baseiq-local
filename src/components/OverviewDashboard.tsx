import { Fragment } from "react";
import { StyleSheet, Text, View } from "react-native";
import { OBSERVATION_STATUSES, type ObservationRecord } from "../../shared/observation";
import type { OverviewResult } from "../lib/store";
import { BarRow, Card, Row, SectionHeader } from "../ui/primitives";
import { space, useTheme, type Theme } from "../ui/theme";
import { localeFor, modalityLabels, statusLabels, useI18n, type TranslateFn } from "../i18n";

type AgeBracket = "age.0_3" | "age.4_6" | "age.7_plus" | "age.unknown";
const AGE_BRACKETS: AgeBracket[] = ["age.0_3", "age.4_6", "age.7_plus", "age.unknown"];

function ageBracket(age: number | null): AgeBracket {
  if (age === null) return "age.unknown";
  if (age <= 3) return "age.0_3";
  if (age <= 6) return "age.4_6";
  return "age.7_plus";
}

function buildAgeHistogram(observations: ObservationRecord[]): Record<AgeBracket, number> {
  const buckets: Record<AgeBracket, number> = { "age.0_3": 0, "age.4_6": 0, "age.7_plus": 0, "age.unknown": 0 };
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

function summarize(o: ObservationRecord, t: TranslateFn, labels: Record<string, string>): string {
  if (o.equipment.length === 0) return t("overview.noEquipmentInNote");
  return o.equipment.map((e) => `${e.quantity ?? "?"} × ${e.modality ? labels[e.modality] ?? e.modality : t("modality.Equipo")}`).join(", ");
}

function when(o: ObservationRecord, lang: string): string {
  const raw = o.createdAt || o.observedAt;
  if (!raw) return "";
  const d = new Date(raw.includes("T") ? raw : `${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toLocaleString(localeFor(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function OverviewDashboard({ overview, observations, onViewClient }: {
  overview: OverviewResult | null; observations: ObservationRecord[]; onViewClient?: (client: string) => void;
}) {
  const { theme } = useTheme();
  const { t, lang } = useI18n();
  const styles = makeStyles(theme);
  const labels = modalityLabels(lang);
  const statuses = statusLabels(lang);
  const modalityLabel = (m: string | null | undefined) => (m ? labels[m] ?? m : t("modality.Equipo"));

  if (!overview) {
    return (
      <View style={{ gap: space.xl }}>
        <Card><Row label={t("overview.loading")} last /></Card>
      </View>
    );
  }

  const recent = [...observations].sort((a, b) => b.id - a.id).slice(0, 8);
  const modEntries = Object.entries(overview.byModality);
  const maxModality = Math.max(1, ...modEntries.map(([, n]) => n));

  const ageHist = buildAgeHistogram(observations);
  const ageTotal = Math.max(1, Object.values(ageHist).reduce((a, b) => a + b, 0));
  const knownAgeTotal = ageTotal - ageHist["age.unknown"];
  const pct7plus = knownAgeTotal > 0 ? ageHist["age.7_plus"] / knownAgeTotal : 0;
  const ageTone: Record<AgeBracket, string> = {
    "age.0_3": theme.color.ok, "age.4_6": theme.color.warn, "age.7_plus": theme.color.danger, "age.unknown": theme.color.textTertiary,
  };
  const ageHeadline = knownAgeTotal === 0
    ? t("overview.ageUnknownHeadline")
    : pct7plus >= 0.3
      ? t("overview.ageHighPriority", { n: Math.round(pct7plus * 100) })
      : pct7plus > 0
        ? t("overview.ageWatch", { n: Math.round(pct7plus * 100) })
        : t("overview.ageNone");

  const statusHist = buildStatusHistogram(observations);
  const statusTotal = Math.max(1, observations.length);
  const confirmedPct = observations.length > 0 ? Math.round((statusHist.find((s) => s.status === "Confirmado")?.n ?? 0) / observations.length * 100) : 0;

  const renewalRanking = buildRenewalRanking(overview.renewals);

  const issueGroups: { title: string; items: { label: string; detail: string }[] }[] = [
    { title: t("overview.conflicts"), items: overview.conflicts.map((c) => ({ label: `${c.client === "Sin cliente" ? t("common.noClient") : c.client} · ${modalityLabel(c.modality)}`, detail: c.detail })) },
    { title: t("overview.duplicates"), items: overview.duplicates.map((d) => ({ label: t("overview.possibleDuplicate"), detail: d })) },
  ].filter((g) => g.items.length > 0);

  return (
    <View style={{ gap: space.xl }}>
      <View>
        <SectionHeader title={t("overview.recent")} />
        <Card>
          {recent.length === 0 ? <Row label={t("overview.noObservations")} last /> : (
            recent.map((o, i) => (
              <Row
                key={o.id}
                label={o.client ?? t("common.noClient")}
                detail={summarize(o, t, labels)}
                value={when(o, lang)}
                onPress={o.client && onViewClient ? () => onViewClient(o.client!) : undefined}
                last={i === recent.length - 1}
              />
            ))
          )}
        </Card>
      </View>

      <View>
        <SectionHeader title={t("overview.fleetHealth")} />
        <Card>
          <View style={styles.headline}>
            <Text style={theme.type.body}>{ageHeadline}</Text>
          </View>
          {AGE_BRACKETS.map((b) => (
            <BarRow key={b} label={t(b)} fraction={ageHist[b] / ageTotal} valueLabel={String(ageHist[b])} tone={ageTone[b]} />
          ))}
        </Card>
      </View>

      <View>
        <SectionHeader title={t("overview.dataQuality")} />
        <Card>
          <View style={styles.headline}>
            <Text style={theme.type.body}>
              {observations.length === 0 ? t("overview.empty") : t("overview.confirmedPct", { n: confirmedPct })}
            </Text>
          </View>
          {statusHist.map(({ status, n }) => (
            <BarRow key={status} label={statuses[status] ?? status} fraction={n / statusTotal} valueLabel={String(n)} tone={theme.statusColor[status] ?? theme.color.textTertiary} />
          ))}
          <Row
            label={t("overview.stale")}
            value={String(overview.stale.length)}
            valueColor={overview.stale.length > 0 ? theme.color.warn : undefined}
            last
          />
        </Card>
      </View>

      <View>
        <SectionHeader title={t("overview.byModality")} />
        <Card>
          {modEntries.length === 0 ? <Row label={t("overview.noEquipment")} last /> : (
            modEntries.map(([k, n]) => (
              <BarRow key={k} label={labels[k] ?? k} fraction={n / maxModality} valueLabel={String(n)} tone={theme.color.primary} />
            ))
          )}
        </Card>
      </View>

      <View>
        <SectionHeader title={t("overview.recommendations")} />
        <Card>
          {renewalRanking.length === 0 ? (
            <Row label={t("overview.noRenewals")} last />
          ) : (
            renewalRanking.map((r, i) => (
              <Row
                key={r.client}
                label={r.client === "Sin cliente" ? t("common.noClient") : r.client}
                detail={r.n === 1 ? t("overview.renewalOne", { n: r.n }) : t("overview.renewalMany", { n: r.n })}
                onPress={onViewClient ? () => onViewClient(r.client) : undefined}
                last={i === renewalRanking.length - 1}
              />
            ))
          )}
        </Card>
      </View>

      {issueGroups.length > 0 && (
        <View>
          <SectionHeader title={t("overview.issues")} />
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
