import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { appendFollowUp, MODALITIES, type Modality, type ObservationDraft } from "../../shared/observation";
import { type useStore, OBSERVATION_STATUSES, SOURCE_TYPES } from "../lib/store";

type Store = ReturnType<typeof useStore>;

const EXAMPLES = [
  "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo. Uno de los resonadores parece de unos ocho años.",
  "Clínica Brisa del Norte, Bogotá, Colombia. Tres ecógrafos Novascan NS-200 de unos cinco años.",
  "Hospital Valle Serena en Madrid. Un tomógrafo Medtron de tres años y dos equipos de rayos X sin marca visible.",
];

export function ObservationCapture({ store }: { store: Store }) {
  const [text, setText] = useState("");
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
    transcriptRef.current = text.trim();
    await runExtraction(transcriptRef.current);
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

  function confirm(status: (typeof OBSERVATION_STATUSES)[number]) {
    if (!draft || !result || saving) return;
    if (!draft.client) {
      setError("Falta el cliente: complétalo antes de guardar.");
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
      setResult(null);
      setDraft(null);
      setText("");
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

  return (
    <View style={styles.card}>
      <Text style={styles.h2}>Nueva observación</Text>

      <Text style={styles.label}>Lo que viste en la visita</Text>
      <TextInput
        style={styles.textarea}
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={4}
        placeholder="Ej.: Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores…"
        placeholderTextColor="#555"
      />

      <View style={styles.metaRow}>
        <View style={styles.metaField}>
          <Text style={styles.label}>Quién observó</Text>
          <TextInput style={styles.input} value={submittedBy} onChangeText={setSubmittedBy} placeholder="Nombre" placeholderTextColor="#555" />
        </View>
        <View style={styles.metaField}>
          <Text style={styles.label}>Fecha</Text>
          <TextInput style={styles.input} value={observedAt} onChangeText={setObservedAt} placeholder="YYYY-MM-DD" placeholderTextColor="#555" />
        </View>
        <View style={styles.metaField}>
          <Text style={styles.label}>Fuente</Text>
          <View style={styles.pickerWrap}>
            {SOURCE_TYPES.map((st) => (
              <Pressable key={st} style={[styles.pickerBtn, sourceType === st && styles.pickerBtnActive]} onPress={() => setSourceType(st)}>
                <Text style={[styles.pickerBtnText, sourceType === st && styles.pickerBtnTextActive]}>{st}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <Pressable style={[styles.btn, (loading || text.trim().length < 10) && styles.btnDisabled]} onPress={extract} disabled={loading || text.trim().length < 10}>
        {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>Extraer con IA local</Text>}
      </Pressable>

      <ScrollView horizontal style={styles.examples} showsHorizontalScrollIndicator={false}>
        {EXAMPLES.map((ex) => (
          <Pressable key={ex} style={styles.exampleBtn} onPress={() => setText(ex)}>
            <Text style={styles.exampleText}>{ex.slice(0, 50)}…</Text>
          </Pressable>
        ))}
      </ScrollView>

      {error && <Text style={styles.error}>{error}</Text>}

      {result && draft && (
        <View style={styles.review}>
          <Text style={styles.h3}>Borrador extraído <Text style={styles.muted}>({(result.inferMs / 1000).toFixed(1)} s en local)</Text></Text>

          <View style={styles.grid}>
            <View style={styles.gridField}>
              <Text style={styles.label}>Cliente</Text>
              <TextInput style={styles.input} value={draft.client ?? ""} onChangeText={(v) => setDraft({ ...draft, client: v })} placeholderTextColor="#555" />
            </View>
            <View style={styles.gridField}>
              <Text style={styles.label}>Ciudad</Text>
              <TextInput style={styles.input} value={draft.city ?? ""} onChangeText={(v) => setDraft({ ...draft, city: v })} placeholderTextColor="#555" />
            </View>
            <View style={styles.gridField}>
              <Text style={styles.label}>País</Text>
              <TextInput style={styles.input} value={draft.country ?? ""} onChangeText={(v) => setDraft({ ...draft, country: v })} placeholderTextColor="#555" />
            </View>
          </View>

          {draft.equipment.map((eq, i) => (
            <View key={i} style={styles.equip}>
              <Text style={styles.h4}>Equipo {i + 1}</Text>
              <View style={styles.grid}>
                <View style={styles.gridField}>
                  <Text style={styles.label}>Modalidad</Text>
                  <View style={styles.pickerWrap}>
                    {MODALITIES.map((m) => (
                      <Pressable key={m} style={[styles.pickerBtn, eq.modality === m && styles.pickerBtnActive]} onPress={() => updateEquipment(i, "modality", m)}>
                        <Text style={[styles.pickerBtnText, eq.modality === m && styles.pickerBtnTextActive]}>{m}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <View style={styles.gridField}>
                  <Text style={styles.label}>Cantidad</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={eq.quantity?.toString() ?? ""} onChangeText={(v) => updateEquipment(i, "quantity", v)} placeholderTextColor="#555" />
                </View>
                <View style={styles.gridField}>
                  <Text style={styles.label}>Marca</Text>
                  <TextInput style={styles.input} value={eq.brand ?? ""} onChangeText={(v) => updateEquipment(i, "brand", v)} placeholderTextColor="#555" />
                </View>
                <View style={styles.gridField}>
                  <Text style={styles.label}>Modelo</Text>
                  <TextInput style={styles.input} value={eq.model ?? ""} onChangeText={(v) => updateEquipment(i, "model", v)} placeholderTextColor="#555" />
                </View>
                <View style={styles.gridField}>
                  <Text style={styles.label}>Antigüedad</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={eq.ageYears?.toString() ?? ""} onChangeText={(v) => updateEquipment(i, "ageYears", v)} placeholderTextColor="#555" />
                </View>
              </View>
              {eq.evidence ? <Text style={styles.evidence}>"{eq.evidence}"</Text> : null}
            </View>
          ))}

          {result.question && (
            <>
              <Text style={styles.question}>{result.question}</Text>
              <View style={styles.followRow}>
                <TextInput style={styles.input} value={followAnswer} onChangeText={setFollowAnswer} placeholder="Responde aquí…" placeholderTextColor="#555" onSubmitEditing={answerFollowUp} />
                <Pressable style={[styles.btn, (loading || followAnswer.trim().length < 2) && styles.btnDisabled]} onPress={answerFollowUp} disabled={loading || followAnswer.trim().length < 2}>
                  <Text style={styles.btnText}>Agregar</Text>
                </Pressable>
              </View>
            </>
          )}

          <View style={styles.confirmRow}>
            {OBSERVATION_STATUSES.map((s) => (
              <Pressable key={s} style={[styles.btn, s === "Confirmado" && styles.btnPrimary, saving && styles.btnDisabled]} onPress={() => confirm(s)} disabled={saving}>
                <Text style={styles.btnText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

interface ExtractionResultLocal {
  draft: ObservationDraft;
  question: string | null;
  inferMs: number;
  sourceText: string;
}

const BORDER = "#2A2A33";
const CARD_BG = "#121219";

const styles = StyleSheet.create({
  card: { backgroundColor: CARD_BG, borderRadius: 12, padding: 16, gap: 12 },
  h2: { color: "#fff", fontSize: 18, fontWeight: "600" },
  h3: { color: "#fff", fontSize: 16, fontWeight: "600", marginTop: 4 },
  h4: { color: "#A7A7B3", fontSize: 13, fontWeight: "600", marginBottom: 4 },
  label: { color: "#7E7E8A", fontSize: 11, marginBottom: 4 },
  muted: { color: "#7E7E8A", fontSize: 12, fontWeight: "400" },
  textarea: { backgroundColor: "#0B0B0F", color: "#fff", borderWidth: 1, borderColor: BORDER, borderRadius: 8, padding: 10, fontSize: 14, minHeight: 80 },
  input: { backgroundColor: "#0B0B0F", color: "#fff", borderWidth: 1, borderColor: BORDER, borderRadius: 8, padding: 8, fontSize: 14, flex: 1 },
  metaRow: { flexDirection: "row", gap: 8 },
  metaField: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridField: { width: "31%", minWidth: 90 },
  pickerWrap: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  pickerBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, backgroundColor: "#0B0B0F", borderWidth: 1, borderColor: BORDER },
  pickerBtnActive: { backgroundColor: "#2B2BFF", borderColor: "#2B2BFF" },
  pickerBtnText: { color: "#A7A7B3", fontSize: 11 },
  pickerBtnTextActive: { color: "#fff" },
  btn: { backgroundColor: "#2B2BFF", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, alignItems: "center", marginTop: 4 },
  btnPrimary: { backgroundColor: "#22C55E" },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  examples: { flexDirection: "row", gap: 8 },
  exampleBtn: { backgroundColor: "#0B0B0F", borderWidth: 1, borderColor: BORDER, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginRight: 8 },
  exampleText: { color: "#7E7E8A", fontSize: 11 },
  error: { color: "#EF4444", fontSize: 13 },
  review: { marginTop: 8, gap: 8 },
  equip: { backgroundColor: "#0B0B0F", borderRadius: 8, padding: 10, gap: 8 },
  evidence: { color: "#7E7E8A", fontSize: 11, fontStyle: "italic" },
  question: { color: "#FBBF24", fontSize: 13, backgroundColor: "rgba(251,191,36,0.08)", padding: 8, borderRadius: 6 },
  followRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  confirmRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
});
