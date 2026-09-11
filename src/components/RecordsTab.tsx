import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { MODALITIES, OBSERVATION_STATUSES, type ObservationRecord, type ObservationStatus } from "../../shared/observation";
import type { useStore } from "../lib/store";
import { Input, SectionHeader } from "../ui/primitives";
import { MODALITY_LABELS, font, radius, space, useTheme, type Theme } from "../ui/theme";

type Store = ReturnType<typeof useStore>;
type GroupKey = "fecha" | "pais" | "ciudad" | "hospital" | "az";

const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: "fecha", label: "Fecha" },
  { key: "pais", label: "País" },
  { key: "ciudad", label: "Ciudad" },
  { key: "hospital", label: "Sede" },
  { key: "az", label: "A–Z" },
];

function formatTimestamp(createdAt: string): string {
  const [date, time] = createdAt.split(/[ T]/);
  return time ? `${date} ${time.slice(0, 8)}` : date;
}

function groupOf(o: ObservationRecord, key: GroupKey): string {
  switch (key) {
    case "fecha": return o.createdAt.slice(0, 10);
    case "pais": return o.country ?? "Sin país";
    case "ciudad": return o.city ?? "Sin ciudad";
    case "hospital": return o.client ?? "Sin cliente";
    case "az": return "";
  }
}

function buildSections(observations: ObservationRecord[], groupKey: GroupKey) {
  if (groupKey === "az") {
    const sorted = [...observations].sort((a, b) => (a.client ?? "").localeCompare(b.client ?? ""));
    return [{ title: "", data: sorted }];
  }
  const groups = new Map<string, ObservationRecord[]>();
  for (const o of observations) {
    const g = groupOf(o, groupKey);
    const list = groups.get(g) ?? [];
    list.push(o);
    groups.set(g, list);
  }
  const titles = [...groups.keys()].sort((a, b) =>
    groupKey === "fecha" ? b.localeCompare(a) : a.localeCompare(b));
  return titles.map((title) => ({
    title,
    data: groups.get(title)!.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  }));
}

export interface RecordsTabHandle {
  /** Cancels an in-progress inline edit. Returns true if it handled (and consumed) the back press. */
  handleBack: () => boolean;
}

export const RecordsTab = forwardRef<RecordsTabHandle, {
  store: Store; focusClient: string | null; onClearFocus: () => void;
}>(function RecordsTab({ store, focusClient, onClearFocus }, ref) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const [groupKey, setGroupKey] = useState<GroupKey>("fecha");
  const [editingId, setEditingId] = useState<number | null>(null);

  useImperativeHandle(ref, () => ({
    handleBack: () => {
      if (editingId !== null) {
        setEditingId(null);
        return true;
      }
      return false;
    },
  }), [editingId]);

  const filtered = focusClient ? store.observations.filter((o) => o.client === focusClient) : store.observations;
  const sections = useMemo(() => buildSections(filtered, groupKey), [filtered, groupKey]);

  return (
    <View style={styles.screen}>
      {focusClient && (
        <View style={styles.focusChip}>
          <Text style={styles.focusChipText} numberOfLines={1} ellipsizeMode="tail">Filtrando por {focusClient}</Text>
          <Pressable style={styles.focusChipClearBtn} onPress={onClearFocus} hitSlop={8}>
            <Text style={styles.focusChipClear}>✕ Quitar</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.groupRow}>
        {GROUP_OPTIONS.map((g) => (
          <Pressable key={g.key} style={[styles.groupBtn, groupKey === g.key && styles.groupBtnActive]} onPress={() => setGroupKey(g.key)}>
            <Text style={[styles.groupBtnText, groupKey === g.key && styles.groupBtnTextActive]}>{g.label}</Text>
          </Pressable>
        ))}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={styles.sectionHeader}>{section.title}</Text> : null
        }
        renderItem={({ item }) =>
          editingId === item.id ? (
            <RecordEditRow record={item} store={store} onDone={() => setEditingId(null)} />
          ) : (
            <RecordRow record={item} onEdit={() => setEditingId(item.id)} onDelete={() => store.remove(item.id)} />
          )
        }
        ListHeaderComponent={<SectionHeader title={`Registros (${filtered.length})`} />}
        ListEmptyComponent={<Text style={styles.muted}>Sin observaciones todavía.</Text>}
      />
    </View>
  );
});

function RecordRow({ record, onEdit, onDelete }: {
  record: ObservationRecord; onEdit: () => void; onDelete: () => void;
}) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const statusColor = theme.statusColor[record.status] ?? theme.color.textTertiary;
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowClient} numberOfLines={2}>{record.client}</Text>
        <Text style={[styles.rowStatus, { color: statusColor }]}>{record.status}</Text>
      </View>
      <Text style={styles.rowMeta}>
        {[record.city, record.country].filter(Boolean).join(", ") || "Ubicación desconocida"}
        {" · "}{formatTimestamp(record.createdAt)}
        {record.submittedBy ? ` · ${record.submittedBy}` : ""}
      </Text>
      <Text style={styles.rowEquip}>
        {record.equipment.map((e) => `${e.quantity ?? "?"}× ${MODALITY_LABELS[e.modality ?? ""] ?? e.modality ?? "equipo"}${e.brand ? ` ${e.brand}` : ""}${e.model ? ` ${e.model}` : ""}`).join("; ") || "Sin equipos extraídos"}
      </Text>
      <Text style={styles.rowSource} numberOfLines={2}>{record.sourceText}</Text>
      <View style={styles.rowActions}>
        <Pressable onPress={onEdit} hitSlop={8}><Text style={styles.actionEdit}>Editar</Text></Pressable>
        <Pressable onPress={onDelete} hitSlop={8}><Text style={styles.actionDelete}>Eliminar</Text></Pressable>
      </View>
    </View>
  );
}

function RecordEditRow({ record, store, onDone }: {
  record: ObservationRecord; store: Store; onDone: () => void;
}) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const [client, setClient] = useState(record.client ?? "");
  const [city, setCity] = useState(record.city ?? "");
  const [country, setCountry] = useState(record.country ?? "");
  const [status, setStatus] = useState<ObservationStatus>(record.status);
  const [equipment, setEquipment] = useState(record.equipment.map((e) => ({ ...e })));

  function updateEq(i: number, field: string, value: string) {
    setEquipment((prev) => {
      const next = [...prev];
      const item = { ...next[i] } as Record<string, unknown>;
      if (field === "quantity" || field === "ageYears") {
        const n = value === "" ? null : Number(value);
        item[field] = Number.isInteger(n) ? n : null;
      } else {
        item[field] = value === "" ? null : value;
      }
      next[i] = item as typeof next[number];
      return next;
    });
  }

  function save() {
    store.update(record.id, {
      client: client.trim() || record.client || undefined,
      city: city.trim() || null,
      country: country.trim() || null,
      status,
      equipment,
    });
    onDone();
  }

  return (
    <View style={[styles.row, styles.rowEditing]}>
      <Input label="Hospital / sede" value={client} onChangeText={setClient} />
      <View style={styles.metaRow}>
        <Input style={{ flex: 1 }} value={city} onChangeText={setCity} placeholder="Ciudad" />
        <Input style={{ flex: 1 }} value={country} onChangeText={setCountry} placeholder="País" />
      </View>
      <View style={styles.pickerWrap}>
        {OBSERVATION_STATUSES.map((s) => (
          <Pressable key={s} style={[styles.pickerBtn, status === s && styles.pickerBtnActive]} onPress={() => setStatus(s)}>
            <Text style={[styles.pickerBtnText, status === s && styles.pickerBtnTextActive]}>{s}</Text>
          </Pressable>
        ))}
      </View>

      {equipment.map((eq, i) => (
        <View key={i} style={styles.equip}>
          <View style={styles.pickerWrap}>
            {MODALITIES.map((m) => (
              <Pressable key={m} style={[styles.pickerBtn, eq.modality === m && styles.pickerBtnActive]} onPress={() => updateEq(i, "modality", m)}>
                <Text style={[styles.pickerBtnText, eq.modality === m && styles.pickerBtnTextActive]}>{MODALITY_LABELS[m] ?? m}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.metaRow}>
            <Input style={styles.inputNarrow} keyboardType="numeric" value={eq.quantity?.toString() ?? ""} onChangeText={(v) => updateEq(i, "quantity", v)} placeholder="Cant." />
            <Input style={{ flex: 1 }} value={eq.brand ?? ""} onChangeText={(v) => updateEq(i, "brand", v)} placeholder="Marca" />
            <Input style={{ flex: 1 }} value={eq.model ?? ""} onChangeText={(v) => updateEq(i, "model", v)} placeholder="Modelo" />
            <Input style={styles.inputNarrow} keyboardType="numeric" value={eq.ageYears?.toString() ?? ""} onChangeText={(v) => updateEq(i, "ageYears", v)} placeholder="Años" />
          </View>
        </View>
      ))}

      <View style={styles.rowActions}>
        <Pressable onPress={save} hitSlop={8}><Text style={styles.actionSave}>Guardar</Text></Pressable>
        <Pressable onPress={onDone} hitSlop={8}><Text style={styles.actionCancel}>Cancelar</Text></Pressable>
      </View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  const { color } = theme;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg },
    focusChip: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: color.surfaceMuted, marginHorizontal: space.lg, marginTop: space.md, padding: space.sm, borderRadius: radius.sm },
    focusChipText: { fontFamily: font.medium, fontSize: 12, color: color.primary, flexShrink: 1, minWidth: 0 },
    focusChipClearBtn: { flexShrink: 0, marginLeft: space.sm },
    focusChipClear: { fontSize: 12, color: color.textSecondary },
    groupRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: space.lg, paddingVertical: space.md },
    groupBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border },
    groupBtnActive: { backgroundColor: color.primary, borderColor: color.primary },
    groupBtnText: { fontSize: 12, color: color.textSecondary },
    groupBtnTextActive: { color: color.primaryText, fontFamily: font.semibold },
    list: { flex: 1 },
    listContent: { paddingHorizontal: space.lg, paddingBottom: 24 },
    sectionHeader: { ...theme.type.caption, fontFamily: font.semibold, textTransform: "uppercase", backgroundColor: color.bg, paddingVertical: 6 },
    muted: { color: color.textTertiary, fontSize: 12, textAlign: "center", marginTop: 24 },
    row: { backgroundColor: color.surface, borderRadius: radius.md, padding: space.md, marginBottom: space.sm, gap: 4, borderWidth: 1, borderColor: color.border },
    rowEditing: { gap: space.sm, borderColor: color.primary },
    rowHeader: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
    rowClient: { ...theme.type.bodyMedium, flexShrink: 1, minWidth: 0 },
    rowStatus: { fontSize: 12, fontFamily: font.semibold, flexShrink: 0 },
    rowMeta: { ...theme.type.caption },
    rowEquip: { ...theme.type.secondary, color: color.text },
    rowSource: { ...theme.type.caption, fontStyle: "italic" },
    rowActions: { flexDirection: "row", gap: space.lg, marginTop: 4 },
    actionEdit: { fontSize: 12, fontFamily: font.semibold, color: color.link },
    actionDelete: { fontSize: 12, fontFamily: font.semibold, color: color.danger },
    actionSave: { fontSize: 13, fontFamily: font.semibold, color: color.link },
    actionCancel: { fontSize: 13, color: color.textSecondary },
    metaRow: { flexDirection: "row", gap: space.sm },
    pickerWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
    pickerBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: color.surfaceMuted, borderWidth: 1, borderColor: color.border },
    pickerBtnActive: { backgroundColor: color.primary, borderColor: color.primary },
    pickerBtnText: { fontSize: 11, color: color.textSecondary },
    pickerBtnTextActive: { color: color.primaryText },
    equip: { backgroundColor: color.surfaceMuted, borderRadius: radius.sm, padding: space.sm, gap: space.sm },
    inputNarrow: { width: 64 },
  });
}
