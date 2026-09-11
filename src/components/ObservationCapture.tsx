import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { getDevice } from "../lib/qvac";
import { dash, formatInferCaption, formatMs, formatTps, liveThroughput, type InferSnapshot } from "../lib/infer-metrics";
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { appendFollowUp, MODALITIES, type Modality, type ObservationDraft } from "../../shared/observation";
import { type useStore, OBSERVATION_STATUSES, SOURCE_TYPES } from "../lib/store";
import { Button, Card, Input, Select } from "../ui/primitives";
import { radius, space, useTheme, type Theme } from "../ui/theme";
import { modalityLabels, statusLabels, useI18n } from "../i18n";
import { VoiceMicButton } from "./VoiceMicButton";

type Store = ReturnType<typeof useStore>;

type MediaStage =
  | { kind: "voice-load"; pct: number }
  | null;

const EXAMPLES = [
  "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo. Uno de los resonadores parece de unos ocho años.",
  "Clínica Brisa del Norte, Bogotá, Colombia. Tres ecógrafos Novascan NS-200 de unos cinco años.",
  "Hospital Valle Serena en Madrid. Un tomógrafo Medtron de tres años y dos equipos de rayos X sin marca visible.",
];
const EXAMPLE_LABELS: Record<string, string> = Object.fromEntries(EXAMPLES.map((e) => [e, `${e.slice(0, 40).trimEnd()}…`]));
const GREETING_KEY = "capture.greeting";

interface Msg {
  id: string;
  role: "assistant" | "user";
  text: string;
  caption?: string;
}

const msgId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const msg = (role: Msg["role"], text: string, caption?: string): Msg => ({ id: msgId(), role, text, caption });

export interface ObservationCaptureHandle {
  /** Backs out of an in-progress draft/result review. Returns true if it handled (and consumed) the back press. */
  handleBack: () => boolean;
}

export const ObservationCapture = forwardRef<ObservationCaptureHandle, { store: Store; onBusyChange?: (busy: boolean) => void; tabBarHeight?: number }>(
  function ObservationCapture({ store, onBusyChange, tabBarHeight = 0 }, ref) {
  const { theme } = useTheme();
  const { t, lang } = useI18n();
  const styles = makeStyles(theme);
  const labels = modalityLabels(lang);
  const statuses = statusLabels(lang);
  const sourceLabels: Record<string, string> = Object.fromEntries(
    SOURCE_TYPES.map((s) => [s, t("source.prefix", { name: t(`source.${s}`) })]),
  );
  const [messages, setMessages] = useState<Msg[]>(() => [msg("assistant", t(GREETING_KEY))]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResultLocal | null>(null);
  const [draft, setDraft] = useState<ObservationDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [questionSkipped, setQuestionSkipped] = useState(false);
  const [submittedBy, setSubmittedBy] = useState("");
  const [observedAt, setObservedAt] = useState(new Date().toISOString().slice(0, 10));
  const [sourceType, setSourceType] = useState<(typeof SOURCE_TYPES)[number]>("visita");
  const [status, setStatus] = useState<(typeof OBSERVATION_STATUSES)[number]>("Confirmado");
  const [showDetails, setShowDetails] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  /** What the busy bubble should say while dictation work runs. */
  const [mediaStage, setMediaStage] = useState<MediaStage>(null);
  const transcriptRef = useRef("");
  const scrollRef = useRef<ScrollView>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [live, setLive] = useState<InferSnapshot | null>(null);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  useEffect(() => {
    onBusyChange?.(loading || saving || transcribing);
  }, [loading, saving, onBusyChange, transcribing]);

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].role === "assistant") {
        return [msg("assistant", t(GREETING_KEY))];
      }
      return prev;
    });
  }, [t, lang]);

  useEffect(() => {
    // adjustResize already lifts the tab bar. Padding the composer by the full
    // keyboard height double-counts that bar; subtract the measured height.
    if (Platform.OS !== "android") return;
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setAndroidKeyboardHeight(Math.max(0, e.endCoordinates.height - tabBarHeight));
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setAndroidKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [tabBarHeight]);

  const working = loading || transcribing;
  useEffect(() => {
    if (!working) {
      setElapsedSec(0);
      return;
    }
    const t0 = Date.now();
    setElapsedSec(0);
    const id = setInterval(() => {
      const inferMs = Date.now() - t0;
      setElapsedSec(Math.floor(inferMs / 1000));
      setLive((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          inferMs,
          tokensPerSecond: liveThroughput(prev.tokens, prev.ttftMs, inferMs) ?? prev.tokensPerSecond,
        };
      });
    }, 200);
    return () => clearInterval(id);
  }, [working]);

  const push = (...items: Msg[]) => setMessages((prev) => [...prev, ...items]);
  const awaitingAnswer = !!result?.question && !questionSkipped;

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
    setQuestionSkipped(false);
    setLive({ phase: "waiting", inferMs: 0 });
    try {
      const res = await store.extract(input, setLive);
      setResult(res);
      setDraft(JSON.parse(JSON.stringify(res.draft)));
      const dev = getDevice()?.toUpperCase() ?? "?";
      const detail = formatInferCaption(res.stats ?? { phase: "done", inferMs: res.inferMs }, dev);
      const items = [msg("assistant", t("capture.understood"), t("capture.inferCaption", { detail }))];
      if (res.question) items.push(msg("assistant", res.question));
      push(...items);
    } catch (e) {
      const code = e instanceof Error ? e.message : "extract_failed";
      setError(
        code === "infer_timeout" ? t("capture.timeout")
          : code === "model_busy" ? t("capture.busy")
          : code === "load_timeout" ? t("capture.loadTimeout")
          : code,
      );
    } finally {
      setLoading(false);
      setLive(null);
    }
  }

  function mediaErrorMessage(e: unknown, fallbackKey: string): string {
    const code = e instanceof Error ? e.message : "";
    if (code === "load_timeout") return t("capture.loadTimeout");
    if (code === "infer_timeout" || code === "transcribe_timeout") return t("capture.timeout");
    if (code === "model_busy") return t("capture.busy");
    return t(fallbackKey);
  }

  async function transcribeUri(uri: string, durationMs: number) {
    setTranscribing(true);
    setMediaStage(null);
    setError(null);
    try {
      const transcript = await store.transcribe(uri, {
        durationMs,
        onLoadProgress: (pct) => setMediaStage(pct >= 100 ? null : { kind: "voice-load", pct }),
      });
      if (transcript.trim()) setText((prev) => (prev.trim() ? `${prev} ` : "") + transcript.trim());
    } catch (e) {
      setError(mediaErrorMessage(e, "capture.micError"));
    } finally {
      setTranscribing(false);
      setMediaStage(null);
    }
  }

  function confirm(nextStatus: (typeof OBSERVATION_STATUSES)[number]) {
    if (!draft || !result || saving) return;
    if (!draft.client) {
      setError(t("capture.missingClient"));
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
        .map((e) => `${e.quantity ?? "?"} × ${labels[e.modality ?? ""] ?? e.modality ?? t("modality.equipo")}`)
        .join(", ");
      push(msg("assistant", t("capture.saved", { client: draft.client, summary: summary || t("capture.noEquipment"), status: statuses[nextStatus] ?? nextStatus })));
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
    setMessages([msg("assistant", t(GREETING_KEY))]);
    setResult(null);
    setDraft(null);
    setError(null);
    setSaved(false);
    setQuestionSkipped(false);
    setText("");
    transcriptRef.current = "";
  }

  useImperativeHandle(ref, () => ({
    handleBack: () => {
      if (result || draft || saved) {
        reset();
        return true;
      }
      return false;
    },
  }), [result, draft, saved]);

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

        {(loading) && (
          <View style={[styles.bubble, styles.assistant, styles.loadingCard]}>
            <View style={styles.loadingRow}>
              <ActivityIndicator color={theme.color.textSecondary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={theme.type.body}>
                  {live?.phase === "translating" ? t("capture.translating")
                    : t("capture.extracting")}
                </Text>
                <Text style={theme.type.caption}>
                  {elapsedSec > 0 ? t("capture.elapsed", { n: elapsedSec }) : t("capture.starting")}
                  {getDevice() ? ` · ${getDevice()?.toUpperCase()}` : ""}
                </Text>
              </View>
            </View>
            <MetricsHud live={live} />
          </View>
        )}

        {transcribing && (
          <View style={[styles.bubble, styles.assistant, styles.loadingRow]}>
            <ActivityIndicator color={theme.color.textSecondary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={theme.type.body}>
                {mediaStage?.kind === "voice-load"
                  ? t("capture.loadingVoiceModel", { n: Math.round(mediaStage.pct) })
                  : t("capture.transcribing")}
              </Text>
              {elapsedSec > 0 && <Text style={theme.type.caption}>{t("capture.elapsed", { n: elapsedSec })}</Text>}
            </View>
          </View>
        )}

        {result && draft && (
          <>
            <Card style={styles.draftCard}>
              <Input label={t("capture.client")} value={draft.client ?? ""} onChangeText={(v) => setDraft({ ...draft, client: v })} placeholder={t("capture.clientPlaceholder")} />
              <View style={styles.pair}>
                <Input style={styles.half} label={t("capture.city")} value={draft.city ?? ""} onChangeText={(v) => setDraft({ ...draft, city: v || null })} />
                <Input style={styles.half} label={t("capture.country")} value={draft.country ?? ""} onChangeText={(v) => setDraft({ ...draft, country: v || null })} />
              </View>

              {draft.equipment.map((eq, i) => (
                <View key={i} style={styles.equipment}>
                  <Text style={theme.type.heading}>{t("capture.equipmentN", { n: i + 1 })}</Text>
                  <Select label={t("capture.modality")} value={(eq.modality ?? "otra") as Modality} options={MODALITIES} labels={labels} onChange={(v) => updateEquipment(i, "modality", v)} placeholder={t("select.placeholder")} />
                  <View style={styles.pair}>
                    <Input style={styles.half} label={t("capture.quantity")} keyboardType="numeric" value={eq.quantity == null ? "" : String(eq.quantity)} onChangeText={(v) => updateEquipment(i, "quantity", toInt(v))} />
                    <Input style={styles.half} label={t("capture.age")} keyboardType="numeric" value={eq.ageYears == null ? "" : String(eq.ageYears)} onChangeText={(v) => updateEquipment(i, "ageYears", toInt(v))} />
                  </View>
                  <View style={styles.pair}>
                    <Input style={styles.half} label={t("capture.brand")} value={eq.brand ?? ""} onChangeText={(v) => updateEquipment(i, "brand", v || null)} />
                    <Input style={styles.half} label={t("capture.model")} value={eq.model ?? ""} onChangeText={(v) => updateEquipment(i, "model", v || null)} />
                  </View>
                  {eq.evidence ? <Text style={styles.evidence}>“{eq.evidence}”</Text> : null}
                </View>
              ))}
            </Card>

            <View style={[styles.bubble, styles.assistant, { gap: space.md }]}>
              <Text style={theme.type.body}>
                {awaitingAnswer
                  ? t("capture.answerFirst")
                  : t("capture.readyToSave")}
              </Text>
              <Select label={t("capture.status")} value={status} options={OBSERVATION_STATUSES} labels={statuses} onChange={setStatus} placeholder={t("select.placeholder")} />
              <Button label={t("capture.save")} onPress={() => confirm(status)} loading={saving} disabled={awaitingAnswer} />
              {awaitingAnswer && (
                <Pressable onPress={() => setQuestionSkipped(true)} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.link}>{t("capture.skipQuestion")}</Text>
                </Pressable>
              )}
            </View>
          </>
        )}

        {error && (
          <View style={[styles.bubble, styles.assistant]}>
            <Text style={[theme.type.body, { color: theme.color.danger }]}>{error}</Text>
          </View>
        )}

        {saved && <Button label={t("capture.new")} variant="secondary" onPress={reset} style={styles.newBtn} />}
      </ScrollView>

      <View style={[styles.composer, androidKeyboardHeight > 0 && { paddingBottom: androidKeyboardHeight }]}>
        <View style={styles.pair}>
          <Select style={styles.half} value={null} options={EXAMPLES} labels={EXAMPLE_LABELS} placeholder={t("capture.examples")} onChange={setText} />
          <Select style={styles.half} value={sourceType} options={SOURCE_TYPES} labels={sourceLabels} onChange={setSourceType} placeholder={t("select.placeholder")} />
        </View>
        <Pressable onPress={() => setShowDetails((s) => !s)} accessibilityRole="button" accessibilityState={{ expanded: showDetails }} hitSlop={8}>
          <Text style={styles.link}>{showDetails ? t("capture.hideDetails") : t("capture.details")}</Text>
        </Pressable>
        {showDetails && (
          <View style={styles.pair}>
            <Input style={styles.half} label={t("capture.observer")} value={submittedBy} onChangeText={setSubmittedBy} placeholder={t("capture.observerPlaceholder")} />
            <Input style={styles.half} label={t("capture.date")} value={observedAt} onChangeText={setObservedAt} placeholder={t("capture.datePlaceholder")} />
          </View>
        )}
        <View style={styles.sendRow}>
          {lang === "es" && (
            <VoiceMicButton
              disabled={loading}
              transcribing={transcribing}
              accessibilityLabel={t("capture.mic")}
              onRecordingChange={setRecording}
              onTranscribe={transcribeUri}
              onPermissionDenied={() => setError(t("capture.micPermission"))}
              onError={(e) => setError(mediaErrorMessage(e, "capture.micError"))}
              onTooShort={() => setError(t("capture.recordingTooShort"))}
            />
          )}
          <Input
            style={{ flex: 1 }}
            value={text}
            onChangeText={setText}
            multiline
            inputStyle={styles.composerInput}
            placeholder={recording ? t("capture.recording") : awaitingAnswer ? t("capture.placeholderMore") : t("capture.placeholder")}
          />
          <Button label={t("capture.send")} onPress={awaitingAnswer ? answerFollowUp : extract} disabled={!canSend || recording} style={styles.sendBtn} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
});

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

function MetricsHud({ live }: { live: InferSnapshot | null }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const styles = makeStyles(theme);
  const ttft = live?.ttftMs != null ? formatMs(live.ttftMs) : undefined;
  const tokens = live?.tokens != null ? String(Math.round(live.tokens)) : undefined;
  const tps = live?.tokensPerSecond != null ? formatTps(live.tokensPerSecond) : undefined;
  return (
    <View
      style={styles.metrics}
      accessibilityLabel={[
        ttft ? `${t("metrics.ttft")} ${ttft}` : null,
        tokens ? `${t("metrics.tokens")} ${tokens}` : null,
        tps ? `${t("metrics.throughput")} ${tps}` : null,
      ].filter(Boolean).join(" · ") || t("capture.starting")}
    >
      <MetricCell label={t("metrics.ttft")} value={dash(ttft)} />
      <MetricCell label={t("metrics.tokens")} value={dash(tokens)} />
      <MetricCell label={t("metrics.throughput")} value={dash(tps)} last />
    </View>
  );
}

function MetricCell({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const { theme } = useTheme();
  const styles = makeStyles(theme);
  return (
    <View style={[styles.metricCell, !last && styles.metricCellBorder]}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

interface ExtractionResultLocal {
  draft: ObservationDraft;
  question: string | null;
  inferMs: number;
  stats?: InferSnapshot;
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
    loadingCard: { alignSelf: "stretch", maxWidth: "100%", gap: space.md, paddingVertical: space.md },
    metrics: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border, paddingTop: space.sm },
    metricCell: { flex: 1, alignItems: "center", gap: 2, paddingVertical: 2 },
    metricCellBorder: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: color.border },
    metricValue: { ...theme.type.heading, fontSize: 20, lineHeight: 24, color: color.primary, fontVariant: ["tabular-nums"] },
    metricLabel: { ...theme.type.caption, textTransform: "uppercase", letterSpacing: 0.4 },
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
