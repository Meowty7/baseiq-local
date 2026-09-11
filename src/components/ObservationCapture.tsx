import { useEffect, useRef, useState } from "react";
import { getDevice } from "../lib/qvac";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { appendFollowUp, MODALITIES, type Modality, type ObservationDraft } from "../../shared/observation";
import { type useStore, OBSERVATION_STATUSES, SOURCE_TYPES } from "../lib/store";
import { Button, Card, Input, Select } from "../ui/primitives";
import { MODALITY_LABELS, radius, space, useTheme, type Theme } from "../ui/theme";

type Store = ReturnType<typeof useStore>;

const EXAMPLES = [
  "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo. Uno de los resonadores parece de unos ocho años.",
  "Clínica Brisa del Norte, Bogotá, Colombia. Tres ecógrafos Novascan NS-200 de unos cinco años.",
  "Hospital Valle Serena en Madrid. Un tomógrafo Medtron de tres años y dos equipos de rayos X sin marca visible.",
];
const EXAMPLE_LABELS: Record<string, string> = Object.fromEntries(EXAMPLES.map((e) => [e, `${e.slice(0, 40).trimEnd()}…`]));
const SOURCE_LABELS: Record<string, string> = Object.fromEntries(SOURCE_TYPES.map((s) => [s, `Fuente: ${s}`]));
const GREETING = "Cuéntame qué viste en la visita: hospital, ciudad, equipos, marcas, antigüedad.";

interface Msg {
  id: string;
  role: "assistant" | "user";
  text: string;
  caption?: string;
}

const msgId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const msg = (role: Msg["role"], text: string, caption?: string): Msg => ({ id: msgId(), role, text, caption });

export function ObservationCapture({ store, onBusyChange }: { store: Store; onBusyChange?: (busy: boolean) => void }) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const [messages, setMessages] = useState<Msg[]>(() => [msg("assistant", GREETING)]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResultLocal | null>(null);
  const [draft, setDraft] = useState<ObservationDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [submittedBy, setSubmittedBy] = useState("");
  const [observedAt, setObservedAt] = useState(new Date().toISOString().slice(0, 10));
  const [sourceType, setSourceType] = useState<(typeof SOURCE_TYPES)[number]>("visita");
  const [status, setStatus] = useState<(typeof OBSERVATION_STATUSES)[number]>("Confirmado");
  const [showDetails, setShowDetails] = useState(false);
  const transcriptRef = useRef("");
  const scrollRef = useRef<ScrollView>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    onBusyChange?.(loading || saving);
  }, [loading, saving, onBusyChange]);

  useEffect(() => {
    if (!loading) {
      setElapsedSec(0);
      return;
    }
    const t0 = Date.now();
    setElapsedSec(0);
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [loading]);

  const push = (...items: Msg[]) => setMessages((prev) => [...prev, ...items]);
  const awaitingAnswer = !!result?.question;

  async function extract() {
    if (text.trim().length < 10 || loading) return;
    transcriptRef.current = text.trim();
    push(msg("user", transcriptRef.current));
    setText("");
    setSaved(false);
    await runExtraction(transcriptRef.current);
  }

  async function answerFollowUp() {
    if (!result || text.trim().length < 2 || loading) return;
    transcriptRef.current = appendFollowUp(transcriptRef.current, text);
    push(msg("user", text.trim()));
    setText("");
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
      const dev = getDevice()?.toUpperCase() ?? "?";
      const items = [msg("assistant", "Esto es lo que entendí. Revisa y corrige lo necesario.", `Inferencia ${(res.inferMs / 1000).toFixed(1)} s · ${dev}`)];
      if (res.question) items.push(msg("assistant", res.question));
      push(...items);
    } catch (e) {
      const code = e instanceof Error ? e.message : "extract_failed";
      setError(
        code === "infer_timeout" ? "La IA local tardó demasiado. Cierra la app y vuelve a abrirla (el worker GPU puede haber quedado ocupado)."
          : code === "model_busy" ? "El modelo está ocupado. Espera un momento e inténtalo de nuevo."
          : code === "load_timeout" ? "No se pudo cargar el modelo a tiempo. Reinicia la app."
          : code,
      );
    } finally {
      setLoading(false);
    }
  }

  function confirm(nextStatus: (typeof OBSERVATION_STATUSES)[number]) {
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
        status: nextStatus,
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
      setError(null);
      setSaved(true);
      const summary = draft.equipment
        .map((e) => `${e.quantity ?? "?"} × ${MODALITY_LABELS[e.modality ?? ""] ?? e.modality ?? "equipo"}`)
        .join(", ");
      push(msg("assistant", `Guardada · ${draft.client} · ${summary || "sin equipos"} · ${nextStatus}.`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }

  function updateEquipment(index: number, field: string, value: string | number | null) {
    if (!draft) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const eq = [...prev.equipment];
      eq[index] = { ...eq[index], [field]: value };
      return { ...prev, equipment: eq };
    });
  }

  function reset() {
    setMessages([msg("assistant", GREETING)]);
    setResult(null);
    setDraft(null);
    setError(null);
    setSaved(false);
    setText("");
    transcriptRef.current = "";
  }

  const toInt = (v: string) => (v.trim() === "" ? null : Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : null);
  const canSend = !loading && text.trim().length >= (awaitingAnswer ? 2 : 10);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        ref={scrollRef}
        style={styles.thread}
        contentContainerStyle={styles.threadContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((m) => <Bubble key={m.id} msg={m} />)}

        {loading && (
          <View style={[styles.bubble, styles.assistant, styles.loadingRow]}>
            <ActivityIndicator color={theme.color.textSecondary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={theme.type.body}>Extrayendo con IA local…</Text>
              <Text style={theme.type.caption}>
                {elapsedSec > 0 ? `${elapsedSec} s transcurridos` : "Iniciando…"}
                {getDevice() ? ` · ${getDevice()?.toUpperCase()}` : ""}
              </Text>
            </View>
          </View>
        )}

        {result && draft && (
          <>
            <Card style={styles.draftCard}>
              <Input label="Cliente (requerido)" value={draft.client ?? ""} onChangeText={(v) => setDraft({ ...draft, client: v })} placeholder="Hospital o clínica" />
              <View style={styles.pair}>
                <Input style={styles.half} label="Ciudad" value={draft.city ?? ""} onChangeText={(v) => setDraft({ ...draft, city: v || null })} />
                <Input style={styles.half} label="País" value={draft.country ?? ""} onChangeText={(v) => setDraft({ ...draft, country: v || null })} />
              </View>

              {draft.equipment.map((eq, i) => (
                <View key={i} style={styles.equipment}>
                  <Text style={theme.type.heading}>Equipo {i + 1}</Text>
                  <Select label="Modalidad" value={(eq.modality ?? "otra") as Modality} options={MODALITIES} labels={MODALITY_LABELS} onChange={(v) => updateEquipment(i, "modality", v)} />
                  <View style={styles.pair}>
                    <Input style={styles.half} label="Cantidad" keyboardType="numeric" value={eq.quantity == null ? "" : String(eq.quantity)} onChangeText={(v) => updateEquipment(i, "quantity", toInt(v))} />
                    <Input style={styles.half} label="Antigüedad (años)" keyboardType="numeric" value={eq.ageYears == null ? "" : String(eq.ageYears)} onChangeText={(v) => updateEquipment(i, "ageYears", toInt(v))} />
                  </View>
                  <View style={styles.pair}>
                    <Input style={styles.half} label="Marca" value={eq.brand ?? ""} onChangeText={(v) => updateEquipment(i, "brand", v || null)} />
                    <Input style={styles.half} label="Modelo" value={eq.model ?? ""} onChangeText={(v) => updateEquipment(i, "model", v || null)} />
                  </View>
                  {eq.evidence ? <Text style={styles.evidence}>“{eq.evidence}”</Text> : null}
                </View>
              ))}
            </Card>

            <View style={[styles.bubble, styles.assistant, { gap: space.md }]}>
              <Text style={theme.type.body}>Cuando esté correcto, elige el estado y guarda.</Text>
              <Select label="Estado" value={status} options={OBSERVATION_STATUSES} onChange={setStatus} />
              <Button label="Guardar observación" onPress={() => confirm(status)} loading={saving} />
            </View>
          </>
        )}

        {error && (
          <View style={[styles.bubble, styles.assistant]}>
            <Text style={[theme.type.body, { color: theme.color.danger }]}>{error}</Text>
          </View>
        )}

        {saved && <Button label="Nueva observación" variant="secondary" onPress={reset} style={styles.newBtn} />}
      </ScrollView>

      <View style={styles.composer}>
        <View style={styles.pair}>
          <Select style={styles.half} value={null} options={EXAMPLES} labels={EXAMPLE_LABELS} placeholder="Ejemplos" onChange={setText} />
          <Select style={styles.half} value={sourceType} options={SOURCE_TYPES} labels={SOURCE_LABELS} onChange={setSourceType} />
        </View>
        <Pressable onPress={() => setShowDetails((s) => !s)} accessibilityRole="button" accessibilityState={{ expanded: showDetails }} hitSlop={8}>
          <Text style={styles.link}>{showDetails ? "Ocultar detalles" : "Detalles"}</Text>
        </Pressable>
        {showDetails && (
          <View style={styles.pair}>
            <Input style={styles.half} label="Quién observó" value={submittedBy} onChangeText={setSubmittedBy} placeholder="Nombre" />
            <Input style={styles.half} label="Fecha (AAAA-MM-DD)" value={observedAt} onChangeText={setObservedAt} placeholder="AAAA-MM-DD" />
          </View>
        )}
        <View style={styles.sendRow}>
          <Input
            style={{ flex: 1 }}
            value={text}
            onChangeText={setText}
            multiline
            inputStyle={styles.composerInput}
            placeholder={awaitingAnswer ? "Responde aquí…" : "Escribe lo que viste…"}
          />
          <Button label="Enviar" onPress={awaitingAnswer ? answerFollowUp : extract} disabled={!canSend} style={styles.sendBtn} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ msg: m }: { msg: Msg }) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  const user = m.role === "user";
  return (
    <View style={[styles.bubble, user ? styles.user : styles.assistant]}>
      <Text style={[theme.type.body, user && { color: theme.color.primaryText }]}>{m.text}</Text>
      {m.caption ? <Text style={[theme.type.caption, styles.caption]}>{m.caption}</Text> : null}
    </View>
  );
}

interface ExtractionResultLocal {
  draft: ObservationDraft;
  question: string | null;
  inferMs: number;
  sourceText: string;
}

function makeStyles(theme: Theme) {
  const { color } = theme;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: color.bg },
    thread: { flex: 1 },
    threadContent: { padding: space.lg, gap: space.sm },
    bubble: { maxWidth: "85%", borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm + 2 },
    assistant: { alignSelf: "flex-start", backgroundColor: color.surfaceMuted },
    user: { alignSelf: "flex-end", backgroundColor: color.primary },
    caption: { marginTop: space.xs },
    loadingRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
    draftCard: { alignSelf: "stretch", padding: space.md, gap: space.md },
    equipment: { gap: space.sm, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
    pair: { flexDirection: "row", gap: space.sm },
    half: { flex: 1 },
    evidence: { ...theme.type.secondary, fontStyle: "italic" },
    newBtn: { alignSelf: "flex-start" },
    composer: { backgroundColor: color.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border, padding: space.md, gap: space.sm },
    link: { ...theme.type.caption, color: color.link, alignSelf: "flex-start" },
    sendRow: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
    sendBtn: { minHeight: 44, paddingHorizontal: space.md },
    composerInput: { minHeight: 44, maxHeight: 120 },
  });
}
