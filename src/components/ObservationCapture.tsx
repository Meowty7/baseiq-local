import { useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { appendFollowUp, MODALITIES, type ObservationDraft, type ObservationRecord } from "../../shared/observation";
import { type useStore, OBSERVATION_STATUSES, SOURCE_TYPES } from "../lib/store";
import { useTheme, type Theme } from "../lib/theme";

type Store = ReturnType<typeof useStore>;

const EXAMPLES = [
  "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo. Uno de los resonadores parece de unos ocho años.",
  "Clínica Brisa del Norte, Bogotá, Colombia. Tres ecógrafos Novascan NS-200 de unos cinco años.",
  "Hospital Valle Serena en Madrid. Un tomógrafo Medtron de tres años y dos equipos de rayos X sin marca visible.",
];

// Compara el borrador contra observaciones ya guardadas del mismo cliente para
// avisar de posibles contradicciones antes de confirmar (no bloquea el guardado).
function findConflicts(draft: ObservationDraft, existing: ObservationRecord[]): string[] {
  if (!draft.client) return [];
  const prior = existing.filter((o) => o.client === draft.client);
  const msgs = new Set<string>();
  for (const eq of draft.equipment) {
    if (!eq.modality) continue;
    for (const o of prior) {
      for (const e of o.equipment) {
        if (e.modality !== eq.modality) continue;
        const diffs: string[] = [];
        if (eq.quantity !== null && e.quantity !== null && eq.quantity !== e.quantity) diffs.push(`cantidad ${e.quantity} vs ${eq.quantity}`);
        if (eq.brand && e.brand && eq.brand.toLowerCase() !== e.brand.toLowerCase()) diffs.push(`marca "${e.brand}" vs "${eq.brand}"`);
        if (eq.model && e.model && eq.model.toLowerCase() !== e.model.toLowerCase()) diffs.push(`modelo "${e.model}" vs "${eq.model}"`);
        if (diffs.length > 0) msgs.add(`${eq.modality} (obs #${o.id}): ${diffs.join(", ")}`);
      }
    }
  }
  return [...msgs];
}

export function ObservationCapture({ store, onGoToRecords }: { store: Store; onGoToRecords: (client: string) => void }) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const [text, setText] = useState("");
  const [sentText, setSentText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResultLocal | null>(null);
  const [draft, setDraft] = useState<ObservationDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [submittedBy, setSubmittedBy] = useState("");
  const [observedAt, setObservedAt] = useState(new Date().toISOString().slice(0, 10));
  const [sourceType, setSourceType] = useState("visita");
  const [followAnswer, setFollowAnswer] = useState("");
  const transcriptRef = useRef("");

  async function extract() {
    if (text.trim().length < 10 || loading) return;
    const value = text.trim();
    transcriptRef.current = value;
    setSentText(value);
    setText("");
    await runExtraction(value);
  }

  async function answerFollowUp() {
    if (!result || followAnswer.trim().length < 2 || loading) return;
    transcriptRef.current = appendFollowUp(transcriptRef.current, followAnswer);
    setFollowAnswer("");
    await runExtraction(transcriptRef.current);
  }

  async function runExtraction(input: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await store.extract(input);
      setResult(res);
      setDraft(JSON.parse(JSON.stringify(res.draft)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "extract_failed");
    } finally {
      setLoading(false);
    }
  }

  function closePanel() {
    setResult(null);
    setDraft(null);
    setSentText(null);
  }

  function confirm(status: (typeof OBSERVATION_STATUSES)[number]) {
    if (!draft || !result || saving) return;
    if (!draft.client) {
      setError("Falta el cliente: complétalo antes de guardar.");
      return;
    }
    if (!submittedBy.trim()) {
      setError("Falta quién observó: complétalo antes de guardar.");
      return;
    }
    if (!sourceType) {
      setError("Falta la fuente: elige una antes de guardar.");
      return;
    }
    const missingQty = draft.equipment.find((eq) => eq.modality && (eq.quantity === null || eq.quantity <= 0));
    if (missingQty) {
      setError(`Falta la cantidad para ${missingQty.modality}: complétala antes de guardar.`);
      return;
    }
    setSaving(true);
    try {
      store.save({
        client: draft.client,
        city: draft.city,
        country: draft.country,
        status,
        sourceText: result.sourceText,
        equipment: draft.equipment,
        submittedBy: submittedBy.trim() || null,
        observedAt: observedAt || null,
        sourceType,
        comments: null,
      });
      closePanel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }

  function updateEquipment(index: number, field: string, value: string) {
    if (!draft) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const eq = [...prev.equipment];
      const item = { ...eq[index] };
      if (field === "quantity" || field === "ageYears") {
        const n = value === "" ? null : Number(value);
        (item as Record<string, unknown>)[field] = Number.isInteger(n) ? n : null;
      } else {
        (item as Record<string, unknown>)[field] = value === "" ? null : value;
      }
      eq[index] = item;
      return { ...prev, equipment: eq };
    });
  }

  const conflicts = draft ? findConflicts(draft, store.observations) : [];

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {!sentText ? (
        <ScrollView contentContainerStyle={styles.greeting}>
          <Text style={styles.greetingEmoji}>👋</Text>
          <Text style={styles.greetingTitle}>Hola, ¿qué viste hoy?</Text>
          <Text style={styles.greetingSubtitle}>Cuéntame la visita y extraigo el inventario con IA local, sin conexión.</Text>
          <View style={styles.exampleList}>
            {EXAMPLES.map((ex) => (
              <Pressable key={ex} style={styles.exampleChip} onPress={() => setText(ex)}>
                <Text style={styles.exampleChipText}>{ex}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : (
        <ScrollView style={styles.chatLog} contentContainerStyle={styles.chatLogContent}>
          <View style={styles.bubbleUser}>
            <Text style={styles.bubbleUserText}>{sentText}</Text>
          </View>
          {loading && (
            <View style={styles.bubbleBot}>
              <ActivityIndicator size="small" color={theme.accent} />
              <Text style={styles.bubbleBotText}>Extrayendo con IA Local</Text>
            </View>
          )}
          {!loading && error && !result && (
            <View style={styles.bubbleBotError}>
              <Text style={styles.bubbleBotErrorText}>{error}</Text>
            </View>
          )}
          {!loading && result && (
            <View style={styles.bubbleBot}>
              <Text style={styles.bubbleBotText}>Listo — revisa el borrador abajo ↓</Text>
            </View>
          )}
        </ScrollView>
      )}

      <View style={styles.composeArea}>
        <View style={styles.composeRow}>
          <TextInput
            style={styles.composeInput}
            value={text}
            onChangeText={setText}
            multiline
            placeholder="Escribe lo que viste en la visita…"
            placeholderTextColor={theme.placeholder}
          />
          <Pressable
            style={[styles.sendBtn, (loading || text.trim().length < 10) && styles.btnDisabled]}
            onPress={extract}
            disabled={loading || text.trim().length < 10}
          >
            {loading ? <ActivityIndicator color={theme.accentText} size="small" /> : <Text style={styles.sendBtnText}>➤</Text>}
          </Pressable>
        </View>
        <Text style={styles.footer}>100% en el dispositivo · QVAC {store.status.model} · datos sintéticos</Text>
      </View>

      <Modal visible={!!(result && draft)} animationType="slide" transparent onRequestClose={closePanel}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <ScrollView contentContainerStyle={styles.sheetContent}>
              {result && draft && (
                <>
                  <View style={styles.sheetHeader}>
                    <Text style={styles.h3} numberOfLines={1} ellipsizeMode="tail">
                      Borrador extraído <Text style={styles.muted}>({(result.inferMs / 1000).toFixed(1)} s en local)</Text>
                    </Text>
                    <Pressable style={styles.closeBtnWrap} onPress={closePanel}><Text style={styles.closeBtn}>✕</Text></Pressable>
                  </View>

                  {conflicts.length > 0 && (
                    <View style={styles.conflictBox}>
                      <Text style={styles.conflictTitle}>⚠ Posible conflicto con observaciones previas de {draft.client}</Text>
                      {conflicts.map((c, i) => <Text key={i} style={styles.conflictText}>{c}</Text>)}
                      <Pressable onPress={() => { closePanel(); onGoToRecords(draft.client!); }}>
                        <Text style={styles.conflictLink}>Resolver en Registros →</Text>
                      </Pressable>
                    </View>
                  )}

                  <View style={styles.metaRow}>
                    <View style={styles.metaField}>
                      <Text style={styles.label}>Quién observó *</Text>
                      <TextInput style={[styles.input, !submittedBy.trim() && styles.inputErrorBorder]} value={submittedBy} onChangeText={setSubmittedBy} placeholder="Nombre" placeholderTextColor={theme.placeholder} />
                    </View>
                    <View style={styles.metaField}>
                      <Text style={styles.label}>Fecha</Text>
                      <TextInput style={styles.input} value={observedAt} onChangeText={setObservedAt} placeholder="YYYY-MM-DD" placeholderTextColor={theme.placeholder} />
                    </View>
                    <View style={styles.metaFieldWide}>
                      <Text style={styles.label}>Fuente *</Text>
                      <View style={styles.pickerWrap}>
                        {SOURCE_TYPES.map((st) => (
                          <Pressable key={st} style={[styles.pickerBtn, sourceType === st && styles.pickerBtnActive]} onPress={() => setSourceType(st)}>
                            <Text style={[styles.pickerBtnText, sourceType === st && styles.pickerBtnTextActive]}>{st}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  </View>

                  <View style={styles.grid}>
                    <View style={styles.gridField}>
                      <Text style={styles.label}>Cliente *</Text>
                      <TextInput style={[styles.input, !draft.client && styles.inputErrorBorder]} value={draft.client ?? ""} onChangeText={(v) => setDraft({ ...draft, client: v })} placeholderTextColor={theme.placeholder} />
                    </View>
                    <View style={styles.gridField}>
                      <Text style={styles.label}>Ciudad</Text>
                      <TextInput style={styles.input} value={draft.city ?? ""} onChangeText={(v) => setDraft({ ...draft, city: v })} placeholderTextColor={theme.placeholder} />
                    </View>
                    <View style={styles.gridField}>
                      <Text style={styles.label}>País</Text>
                      <TextInput style={styles.input} value={draft.country ?? ""} onChangeText={(v) => setDraft({ ...draft, country: v })} placeholderTextColor={theme.placeholder} />
                    </View>
                  </View>

                  {draft.equipment.map((eq, i) => (
                    <View key={i} style={styles.equip}>
                      <Text style={styles.h4}>Equipo {i + 1}</Text>
                      <View style={styles.fieldFull}>
                        <Text style={styles.label}>Modalidad</Text>
                        <View style={styles.pickerWrap}>
                          {MODALITIES.map((m) => (
                            <Pressable key={m} style={[styles.pickerBtn, eq.modality === m && styles.pickerBtnActive]} onPress={() => updateEquipment(i, "modality", m)}>
                              <Text style={[styles.pickerBtnText, eq.modality === m && styles.pickerBtnTextActive]}>{m}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                      <View style={styles.fieldRow}>
                        <View style={styles.fieldNarrow}>
                          <Text style={styles.label}>Cantidad{eq.modality ? " *" : ""}</Text>
                          <TextInput
                            style={[styles.input, styles.inputNarrow, eq.modality && !eq.quantity && styles.inputErrorBorder]}
                            keyboardType="numeric"
                            value={eq.quantity?.toString() ?? ""}
                            onChangeText={(v) => updateEquipment(i, "quantity", v)}
                            placeholderTextColor={theme.placeholder}
                          />
                        </View>
                        <View style={styles.fieldNarrow}>
                          <Text style={styles.label}>Antigüedad</Text>
                          <TextInput style={[styles.input, styles.inputNarrow]} keyboardType="numeric" value={eq.ageYears?.toString() ?? ""} onChangeText={(v) => updateEquipment(i, "ageYears", v)} placeholderTextColor={theme.placeholder} />
                        </View>
                      </View>
                      <View style={styles.fieldRow}>
                        <View style={styles.fieldFlex}>
                          <Text style={styles.label}>Marca</Text>
                          <TextInput style={styles.input} value={eq.brand ?? ""} onChangeText={(v) => updateEquipment(i, "brand", v)} placeholderTextColor={theme.placeholder} />
                        </View>
                        <View style={styles.fieldFlex}>
                          <Text style={styles.label}>Modelo</Text>
                          <TextInput style={styles.input} value={eq.model ?? ""} onChangeText={(v) => updateEquipment(i, "model", v)} placeholderTextColor={theme.placeholder} />
                        </View>
                      </View>
                      {eq.evidence ? <Text style={styles.evidence}>"{eq.evidence}"</Text> : null}
                    </View>
                  ))}

                  {result.question && (
                    <>
                      <Text style={styles.question}>{result.question}</Text>
                      <View style={styles.followRow}>
                        <TextInput style={styles.input} value={followAnswer} onChangeText={setFollowAnswer} placeholder="Responde aquí…" placeholderTextColor={theme.placeholder} onSubmitEditing={answerFollowUp} />
                        <Pressable style={[styles.btn, (loading || followAnswer.trim().length < 2) && styles.btnDisabled]} onPress={answerFollowUp} disabled={loading || followAnswer.trim().length < 2}>
                          <Text style={styles.btnText}>Agregar</Text>
                        </Pressable>
                      </View>
                    </>
                  )}

                  {error && <Text style={styles.error}>{error}</Text>}

                  <View style={styles.confirmRow}>
                    {OBSERVATION_STATUSES.map((s) => (
                      <Pressable key={s} style={[styles.btn, s === "Confirmado" && styles.btnPrimary, saving && styles.btnDisabled]} onPress={() => confirm(s)} disabled={saving}>
                        <Text style={styles.btnText}>{s}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

interface ExtractionResultLocal {
  draft: ObservationDraft;
  question: string | null;
  inferMs: number;
  sourceText: string;
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg },
    greeting: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 6 },
    greetingEmoji: { fontSize: 48 },
    greetingTitle: { color: theme.text, fontSize: 28, fontWeight: "700", textAlign: "center", marginTop: 12 },
    greetingSubtitle: { color: theme.textMuted, fontSize: 14, textAlign: "center", marginTop: 6, maxWidth: 280 },
    exampleList: { marginTop: 20, gap: 8, width: "100%" },
    exampleChip: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12 },
    exampleChipText: { color: theme.textMuted, fontSize: 12 },
    chatLog: { flex: 1 },
    chatLogContent: { padding: 16, gap: 8 },
    bubbleUser: { backgroundColor: theme.accent, borderRadius: 14, borderBottomRightRadius: 4, padding: 12, alignSelf: "flex-end", maxWidth: "85%" },
    bubbleUserText: { color: theme.accentText, fontSize: 14 },
    bubbleBot: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.surface, borderRadius: 14, borderBottomLeftRadius: 4, padding: 12, alignSelf: "flex-start", maxWidth: "85%" },
    bubbleBotText: { color: theme.textMuted, fontSize: 13 },
    bubbleBotError: { backgroundColor: theme.warningBg, borderRadius: 14, borderBottomLeftRadius: 4, padding: 12, alignSelf: "flex-start", maxWidth: "85%" },
    bubbleBotErrorText: { color: theme.warningText, fontSize: 13 },
    composeArea: { borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.surface, padding: 12, gap: 8 },
    composeRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
    composeInput: { flex: 1, backgroundColor: theme.surfaceAlt, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, maxHeight: 100 },
    sendBtn: { backgroundColor: theme.accent, width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
    sendBtnText: { color: theme.accentText, fontSize: 16, fontWeight: "700" },
    footer: { color: theme.textMuted, fontSize: 10, textAlign: "center" },
    h3: { color: theme.text, fontSize: 16, fontWeight: "600", flexShrink: 1, minWidth: 0 },
    h4: { color: theme.textMuted, fontSize: 13, fontWeight: "600", marginBottom: 4 },
    label: { color: theme.textMuted, fontSize: 11, marginBottom: 4 },
    muted: { color: theme.textMuted, fontSize: 12, fontWeight: "400" },
    input: { backgroundColor: theme.surfaceAlt, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 8, fontSize: 14, flex: 1 },
    inputErrorBorder: { borderColor: theme.dangerText },
    metaRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    metaField: { flex: 1, minWidth: 90 },
    metaFieldWide: { flex: 1.4, minWidth: 120 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    gridField: { width: "31%", minWidth: 90 },
    fieldFull: { width: "100%" },
    fieldRow: { flexDirection: "row", gap: 8 },
    fieldNarrow: { width: 76 },
    fieldFlex: { flex: 1 },
    inputNarrow: { textAlign: "center" },
    pickerWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
    pickerBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.border },
    pickerBtnActive: { backgroundColor: theme.accent, borderColor: theme.accent },
    pickerBtnText: { color: theme.textMuted, fontSize: 11 },
    pickerBtnTextActive: { color: theme.accentText },
    btn: { backgroundColor: theme.accent, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, alignItems: "center", marginTop: 4 },
    btnPrimary: { backgroundColor: theme.statusColors.Confirmado },
    btnDisabled: { opacity: 0.4 },
    btnText: { color: theme.accentText, fontSize: 14, fontWeight: "600" },
    error: { color: theme.dangerText, fontSize: 13 },
    equip: { backgroundColor: theme.surfaceAlt, borderRadius: 8, padding: 10, gap: 8 },
    evidence: { color: theme.textMuted, fontSize: 11, fontStyle: "italic" },
    question: { color: theme.warningText, fontSize: 13, backgroundColor: theme.warningBg, padding: 8, borderRadius: 6 },
    followRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    confirmRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
    modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheet: { backgroundColor: theme.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "88%", paddingTop: 8 },
    sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: "center", marginBottom: 8 },
    sheetContent: { padding: 16, gap: 10 },
    sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
    closeBtnWrap: { flexShrink: 0 },
    closeBtn: { color: theme.textMuted, fontSize: 18, paddingHorizontal: 8 },
    conflictBox: { backgroundColor: theme.warningBg, borderRadius: 8, padding: 10, gap: 4 },
    conflictTitle: { color: theme.warningText, fontSize: 12, fontWeight: "700" },
    conflictText: { color: theme.warningText, fontSize: 11 },
    conflictLink: { color: theme.accent, fontSize: 12, fontWeight: "600", marginTop: 4 },
  });
}
