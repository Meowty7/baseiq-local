import { useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from "react-native";
import { MODALITIES, OBSERVATION_STATUSES, type ObservationRecord, type ObservationStatus } from "../../shared/observation";
import type { useStore } from "../lib/store";
import { useTheme, type Theme } from "../lib/theme";

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

export function RecordsTab({ store, focusClient, onClearFocus }: {
  store: Store; focusClient: string | null; onClearFocus: () => void;
}) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const [groupKey, setGroupKey] = useState<GroupKey>("fecha");
  const [editingId, setEditingId] = useState<number | null>(null);

  const filtered = focusClient ? store.observations.filter((o) => o.client === focusClient) : store.observations;
  const sections = useMemo(() => buildSections(filtered, groupKey), [filtered, groupKey]);

  return (
    <View style={styles.screen}>
      <View style={styles.controls}>
        <Text style={styles.title}>Registros</Text>
        <Text style={styles.subtitle}>{filtered.length} observaciones</Text>
      </View>

      {focusClient && (
        <View style={styles.focusChip}>
          <Text style={styles.focusChipText} numberOfLines={1} ellipsizeMode="tail">Filtrando por {focusClient}</Text>
          <Pressable style={styles.focusChipClearBtn} onPress={onClearFocus}><Text style={styles.focusChipClear}>✕ Quitar</Text></Pressable>
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
            <RecordEditRow record={item} store={store} onDone={() => setEditingId(null)} theme={theme} />
          ) : (
            <RecordRow record={item} theme={theme} onEdit={() => setEditingId(item.id)} onDelete={() => store.remove(item.id)} />
          )
        }
        ListEmptyComponent={<Text style={styles.muted}>Sin observaciones todavía.</Text>}
      />
    </View>
  );
}

function RecordRow({ record, theme, onEdit, onDelete }: {
  record: ObservationRecord; theme: Theme; onEdit: () => void; onDelete: () => void;
}) {
  const styles = makeStyles(theme);
  const statusColor = theme.statusColors[record.status] ?? theme.textMuted;
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowClient} numberOfLines={1} ellipsizeMode="tail">{record.client}</Text>
        <Text style={[styles.rowStatus, { color: statusColor }]}>{record.status}</Text>
      </View>
      <Text style={styles.rowMeta}>
        {[record.city, record.country].filter(Boolean).join(", ") || "Ubicación desconocida"}
        {" · "}{formatTimestamp(record.createdAt)}
        {record.submittedBy ? ` · ${record.submittedBy}` : ""}
      </Text>
      <Text style={styles.rowEquip}>
        {record.equipment.map((e) => `${e.quantity ?? "?"}× ${e.modality ?? "equipo"}${e.brand ? ` ${e.brand}` : ""}${e.model ? ` ${e.model}` : ""}`).join("; ") || "Sin equipos extraídos"}
      </Text>
      <Text style={styles.rowSource} numberOfLines={2}>{record.sourceText}</Text>
      <View style={styles.rowActions}>
        <Pressable onPress={onEdit}><Text style={styles.actionEdit}>✎ Editar</Text></Pressable>
        <Pressable onPress={onDelete}><Text style={styles.actionDelete}>🗑 Eliminar</Text></Pressable>
      </View>
    </View>
  );
}

function RecordEditRow({ record, store, onDone, theme }: {
  record: ObservationRecord; store: Store; onDone: () => void; theme: Theme;
}) {
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
      <Text style={styles.label}>Hospital / sede</Text>
      <TextInput style={styles.input} value={client} onChangeText={setClient} placeholderTextColor={theme.placeholder} />
      <View style={styles.metaRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={city} onChangeText={setCity} placeholder="Ciudad" placeholderTextColor={theme.placeholder} />
        <TextInput style={[styles.input, { flex: 1 }]} value={country} onChangeText={setCountry} placeholder="País" placeholderTextColor={theme.placeholder} />
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
                <Text style={[styles.pickerBtnText, eq.modality === m && styles.pickerBtnTextActive]}>{m}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.metaRow}>
            <TextInput style={[styles.input, styles.inputNarrow]} keyboardType="numeric" value={eq.quantity?.toString() ?? ""} onChangeText={(v) => updateEq(i, "quantity", v)} placeholder="Cant." placeholderTextColor={theme.placeholder} />
            <TextInput style={[styles.input, { flex: 1 }]} value={eq.brand ?? ""} onChangeText={(v) => updateEq(i, "brand", v)} placeholder="Marca" placeholderTextColor={theme.placeholder} />
            <TextInput style={[styles.input, { flex: 1 }]} value={eq.model ?? ""} onChangeText={(v) => updateEq(i, "model", v)} placeholder="Modelo" placeholderTextColor={theme.placeholder} />
            <TextInput style={[styles.input, styles.inputNarrow]} keyboardType="numeric" value={eq.ageYears?.toString() ?? ""} onChangeText={(v) => updateEq(i, "ageYears", v)} placeholder="Años" placeholderTextColor={theme.placeholder} />
          </View>
        </View>
      ))}

      <View style={styles.rowActions}>
        <Pressable onPress={save}><Text style={styles.actionSave}>✓ Guardar</Text></Pressable>
        <Pressable onPress={onDone}><Text style={styles.actionCancel}>Cancelar</Text></Pressable>
      </View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg },
    controls: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 16, paddingTop: 16 },
    title: { color: theme.text, fontSize: 20, fontWeight: "700" },
    subtitle: { color: theme.textMuted, fontSize: 12 },
    focusChip: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: theme.accentSoft, marginHorizontal: 16, marginTop: 8, padding: 8, borderRadius: 8 },
    focusChipText: { color: theme.accent, fontSize: 12, fontWeight: "600", flexShrink: 1, minWidth: 0 },
    focusChipClearBtn: { flexShrink: 0, marginLeft: 8 },
    focusChipClear: { color: theme.textMuted, fontSize: 12 },
    groupRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
    groupBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
    groupBtnActive: { backgroundColor: theme.accent, borderColor: theme.accent },
    groupBtnText: { color: theme.textMuted, fontSize: 12 },
    groupBtnTextActive: { color: theme.accentText, fontWeight: "600" },
    list: { flex: 1 },
    listContent: { paddingHorizontal: 16, paddingBottom: 24 },
    sectionHeader: { color: theme.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", backgroundColor: theme.bg, paddingVertical: 6 },
    muted: { color: theme.textMuted, fontSize: 12, textAlign: "center", marginTop: 24 },
    row: { backgroundColor: theme.surface, borderRadius: 10, padding: 12, marginBottom: 8, gap: 4, borderWidth: 1, borderColor: theme.border },
    rowEditing: { gap: 8, borderColor: theme.accent },
    rowHeader: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
    rowClient: { color: theme.text, fontSize: 14, fontWeight: "600", flexShrink: 1, minWidth: 0 },
    rowStatus: { fontSize: 12, fontWeight: "600", flexShrink: 0 },
    rowMeta: { color: theme.textMuted, fontSize: 11 },
    rowEquip: { color: theme.text, fontSize: 12 },
    rowSource: { color: theme.textMuted, fontSize: 11, fontStyle: "italic" },
    rowActions: { flexDirection: "row", gap: 16, marginTop: 4 },
    actionEdit: { color: theme.accent, fontSize: 12, fontWeight: "600" },
    actionDelete: { color: theme.dangerText, fontSize: 12, fontWeight: "600" },
    actionSave: { color: theme.accent, fontSize: 13, fontWeight: "700" },
    actionCancel: { color: theme.textMuted, fontSize: 13 },
    label: { color: theme.textMuted, fontSize: 11 },
    input: { backgroundColor: theme.surfaceAlt, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 8, fontSize: 13 },
    inputNarrow: { width: 56, textAlign: "center" },
    metaRow: { flexDirection: "row", gap: 8 },
    pickerWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
    pickerBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.border },
    pickerBtnActive: { backgroundColor: theme.accent, borderColor: theme.accent },
    pickerBtnText: { color: theme.textMuted, fontSize: 11 },
    pickerBtnTextActive: { color: theme.accentText },
    equip: { backgroundColor: theme.surfaceAlt, borderRadius: 8, padding: 8, gap: 6 },
  });
}
