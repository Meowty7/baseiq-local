import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { getDevice } from "../lib/qvac";
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MODALITIES, nextQuestionFieldExcluding, normalizeModality, type Modality, type ObservationDraft } from "../../shared/observation";
import { type useStore, OBSERVATION_STATUSES, SOURCE_TYPES } from "../lib/store";
import { Button, Card, Input, Select } from "../ui/primitives";
import { radius, space, useTheme, type Theme } from "../ui/theme";
import { modalityLabels, statusLabels, useI18n } from "../i18n";
import { getQuestion } from "../i18n/questions";

type Store = ReturnType<typeof useStore>;

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

function missingFieldKey(f: { field: string; equipmentIndex: number | null }): string {
  return f.equipmentIndex == null ? f.field : `${f.field}.${f.equipmentIndex}`;
}

// Who-submitted / when / source aren't part of ObservationDraft (the model
// never fills them — they're always asked at the end, in this fixed order)
// so they're ranked separately from the draft's own missing-field scoring,
// once that's exhausted.
const META_FIELDS = ["submittedBy", "observedAt", "sourceType"] as const;
type MetaField = (typeof META_FIELDS)[number];

interface ReviewQuestion {
  kind: "draft" | "meta";
  field: string;
  equipmentIndex: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  // Entered by pressing Save when the draft still has missing fields: instead
  // of saving right away, the flow asks about each missing field one at a
  // time (answer or skip), then shows a final summary to confirm before the
  // record actually gets written.
  const [reviewing, setReviewing] = useState(false);
  const [skippedFields, setSkippedFields] = useState<Set<string>>(new Set());
  const [submittedBy, setSubmittedBy] = useState("");
  const [observedAt, setObservedAt] = useState(new Date().toISOString().slice(0, 10));
  const [sourceType, setSourceType] = useState<(typeof SOURCE_TYPES)[number]>("visita");
  const [status, setStatus] = useState<(typeof OBSERVATION_STATUSES)[number]>("Confirmado");
  const [showDetails, setShowDetails] = useState(false);
  const transcriptRef = useRef("");
  const scrollRef = useRef<ScrollView>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  useEffect(() => {
    onBusyChange?.(loading || saving);
  }, [loading, saving, onBusyChange]);

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

  // Who-submitted / when / source are form state, not part of the draft, so
  // their "missing" check reads submittedBy/observedAt/sourceType directly.
  // Asked in fixed order, only once every draft field has been resolved.
  function nextMetaField(skip: ReadonlySet<string>, meta: { submittedBy: string; observedAt: string; sourceType: string }): MetaField | null {
    for (const f of META_FIELDS) {
      if (skip.has(`meta.${f}`)) continue;
      if (f === "submittedBy" && !meta.submittedBy.trim()) return f;
      if (f === "observedAt" && !meta.observedAt.trim()) return f;
      if (f === "sourceType" && !meta.sourceType) return f;
    }
    return null;
  }

  function getReviewQuestion(
    d: ObservationDraft | null,
    skip: ReadonlySet<string>,
    meta: { submittedBy: string; observedAt: string; sourceType: string },
  ): ReviewQuestion | null {
    if (!d) return null;
    const draftField = nextQuestionFieldExcluding(d, skip);
    if (draftField) return { kind: "draft", field: draftField.field, equipmentIndex: draftField.equipmentIndex };
    const meta_ = nextMetaField(skip, meta);
    return meta_ ? { kind: "meta", field: meta_, equipmentIndex: null } : null;
  }

  function questionTextFor(q: ReviewQuestion, d: ObservationDraft | null): string {
    if (q.kind === "meta") return getQuestion(q.field, lang);
    const equipmentNumber = q.equipmentIndex != null && d && d.equipment.length > 1 ? q.equipmentIndex + 1 : undefined;
    return getQuestion(q.field, lang, equipmentNumber);
  }

  const currentMeta = { submittedBy, observedAt, sourceType };
  const reviewQuestion = reviewing ? getReviewQuestion(draft, skippedFields, currentMeta) : null;
  const awaitingAnswer = !!reviewQuestion;

  async function extract() {
    if (text.trim().length < 10 || loading) return;
    transcriptRef.current = text.trim();
    push(msg("user", transcriptRef.current));
    setText("");
    setSaved(false);
    setReviewing(false);
    setLoading(true);
    setError(null);
    try {
      const res = await store.extract(transcriptRef.current);
      setResult(res);
      setDraft(JSON.parse(JSON.stringify(res.draft)));
      const dev = getDevice()?.toUpperCase() ?? "?";
      // No question is asked here — that only happens after the user presses
      // Save, so a first extraction never triggers the "Extrayendo…" popup
      // again on every follow-up answer the way re-extracting used to.
      push(msg("assistant", t("capture.understood"), t("capture.inferCaption", { sec: (res.inferMs / 1000).toFixed(1), device: dev })));
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
    }
  }

  /**
   * Applies a review answer straight to the relevant field — no re-running
   * the model. Re-extracting on every answer used to risk the model
   * "forgetting" data it had already captured when re-deriving the whole
   * draft from a growing transcript, and it re-triggered the loading
   * indicator on every single follow-up turn. Numeric/enum fields are
   * validated before being written; on a bad answer the same question is
   * re-asked instead of silently accepting garbage.
   *
   * Returns the resulting draft/meta explicitly (rather than only calling
   * setDraft/setSubmittedBy/…) because React state updates aren't visible
   * until the next render — the caller needs the up-to-date values *now* to
   * decide what to ask next in the same turn.
   */
  function applyReviewAnswer(
    q: ReviewQuestion,
    raw: string,
  ): { ok: true; draft: ObservationDraft | null; meta: typeof currentMeta } | { ok: false; error: string } {
    const value = raw.trim();
    if (q.kind === "meta") {
      if (q.field === "submittedBy") {
        setSubmittedBy(value);
        return { ok: true, draft, meta: { ...currentMeta, submittedBy: value } };
      }
      if (q.field === "observedAt") {
        if (!DATE_RE.test(value)) return { ok: false, error: t("capture.badDate") };
        setObservedAt(value);
        return { ok: true, draft, meta: { ...currentMeta, observedAt: value } };
      }
      const match = SOURCE_TYPES.find((s) => s === value.toLowerCase() || t(`source.${s}`).toLowerCase() === value.toLowerCase());
      if (!match) return { ok: false, error: t("capture.badSource", { options: SOURCE_TYPES.map((s) => t(`source.${s}`)).join(", ") }) };
      setSourceType(match);
      return { ok: true, draft, meta: { ...currentMeta, sourceType: match } };
    }
    if (!draft) return { ok: false, error: "no_draft" };
    const idx = q.equipmentIndex;
    if (q.field === "client") {
      const next = { ...draft, client: value };
      setDraft(next);
      return { ok: true, draft: next, meta: currentMeta };
    }
    if (q.field === "location") {
      // A single answer to the combined "city and country" question — split on the first comma if present.
      const [c1, c2] = value.split(",").map((s) => s.trim());
      const next = { ...draft, city: c1 || null, country: c2 || c1 || null };
      setDraft(next);
      return { ok: true, draft: next, meta: currentMeta };
    }
    if (q.field === "modality") {
      const mod = normalizeModality(value);
      if (!mod) return { ok: false, error: t("capture.badModality") };
      const eq = [...draft.equipment];
      if (idx != null && eq[idx]) eq[idx] = { ...eq[idx], modality: mod };
      const next = { ...draft, equipment: eq };
      setDraft(next);
      return { ok: true, draft: next, meta: currentMeta };
    }
    if (q.field === "quantity" || q.field === "ageYears") {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n) || String(n) !== value.replace(/^\+/, "")) return { ok: false, error: t("capture.badNumber") };
      const eq = [...draft.equipment];
      if (idx != null && eq[idx]) eq[idx] = { ...eq[idx], [q.field]: n };
      const next = { ...draft, equipment: eq };
      setDraft(next);
      return { ok: true, draft: next, meta: currentMeta };
    }
    if (q.field === "brand" || q.field === "model") {
      const eq = [...draft.equipment];
      if (idx != null && eq[idx]) eq[idx] = { ...eq[idx], [q.field]: value };
      const next = { ...draft, equipment: eq };
      setDraft(next);
      return { ok: true, draft: next, meta: currentMeta };
    }
    return { ok: false, error: "unknown_field" };
  }

  function answerFollowUp() {
    if (!reviewQuestion || text.trim().length < 1 || loading) return;
    const answer = text.trim();
    push(msg("user", answer));
    setText("");
    const applied = applyReviewAnswer(reviewQuestion, answer);
    if (!applied.ok) {
      push(msg("assistant", applied.error));
      push(msg("assistant", questionTextFor(reviewQuestion, draft)));
      return;
    }
    const next = getReviewQuestion(applied.draft, skippedFields, applied.meta);
    push(msg("assistant", next ? questionTextFor(next, applied.draft) : t("capture.reviewDone")));
  }

  function skipReviewQuestion() {
    if (!reviewQuestion) return;
    const key = reviewQuestion.kind === "meta" ? `meta.${reviewQuestion.field}` : missingFieldKey(reviewQuestion);
    const nextSkipped = new Set(skippedFields).add(key);
    setSkippedFields(nextSkipped);
    const next = getReviewQuestion(draft, nextSkipped, currentMeta);
    push(msg("assistant", next ? questionTextFor(next, draft) : t("capture.reviewDone")));
  }

  /** Save button: starts the missing-field review if anything's missing, otherwise saves right away. */
  function startSaveOrReview(nextStatus: (typeof OBSERVATION_STATUSES)[number]) {
    if (!draft || saving) return;
    if (!draft.client) {
      setError(t("capture.missingClient"));
      return;
    }
    const firstQuestion = getReviewQuestion(draft, new Set(), currentMeta);
    if (firstQuestion) {
      setReviewing(true);
      setSkippedFields(new Set());
      push(msg("assistant", t("capture.reviewStart")));
      push(msg("assistant", questionTextFor(firstQuestion, draft)));
      return;
    }
    commitSave(nextStatus);
  }

  function commitSave(nextStatus: (typeof OBSERVATION_STATUSES)[number]) {
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
      const summary = draft.equipment
        .map((e) => `${e.quantity ?? "?"} × ${labels[e.modality ?? ""] ?? e.modality ?? t("modality.equipo")}`)
        .join(", ");
      const savedClient = draft.client;
      setResult(null);
      setDraft(null);
      setReviewing(false);
      setSkippedFields(new Set());
      setText("");
      setError(null);
      setSaved(true);
      push(msg("assistant", t("capture.saved", { client: savedClient, summary: summary || t("capture.noEquipment"), status: statuses[nextStatus] ?? nextStatus })));
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
    setReviewing(false);
    setSkippedFields(new Set());
    setText("");
    transcriptRef.current = "";
  }

  /** Leaves the missing-field review and goes back to editing the draft directly, without discarding it. */
  function cancelReview() {
    setReviewing(false);
    setSkippedFields(new Set());
  }

  useImperativeHandle(ref, () => ({
    handleBack: () => {
      if (reviewing) {
        cancelReview();
        return true;
      }
      if (result || draft || saved) {
        reset();
        return true;
      }
      return false;
    },
  }), [result, draft, saved, reviewing]);

  const toInt = (v: string) => (v.trim() === "" ? null : Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : null);
  // Once review has run out of questions (showing the final summary), the
  // composer shouldn't accept free text — that text would otherwise start a
  // brand-new observation instead of the intended "confirm and save".
  const canSend = !loading && !(reviewing && !awaitingAnswer) && text.trim().length >= (awaitingAnswer ? 2 : 10);

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
              <Text style={theme.type.body}>{t("capture.extracting")}</Text>
              <Text style={theme.type.caption}>
                {elapsedSec > 0 ? t("capture.elapsed", { n: elapsedSec }) : t("capture.starting")}
                {getDevice() ? ` · ${getDevice()?.toUpperCase()}` : ""}
              </Text>
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
              {reviewing ? (
                awaitingAnswer ? (
                  <>
                    <Text style={theme.type.body}>{t("capture.answerFirst")}</Text>
                    <Pressable onPress={skipReviewQuestion} accessibilityRole="button" hitSlop={8}>
                      <Text style={styles.link}>{t("capture.skipQuestion")}</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={theme.type.body}>{t("capture.reviewSummaryReady")}</Text>
                    <Select label={t("capture.status")} value={status} options={OBSERVATION_STATUSES} labels={statuses} onChange={setStatus} placeholder={t("select.placeholder")} />
                    <Button label={t("capture.confirmAndSave")} onPress={() => commitSave(status)} loading={saving} />
                    <Pressable onPress={cancelReview} accessibilityRole="button" hitSlop={8}>
                      <Text style={styles.link}>{t("capture.backToEdit")}</Text>
                    </Pressable>
                  </>
                )
              ) : (
                <>
                  <Text style={theme.type.body}>{t("capture.readyToSave")}</Text>
                  <Select label={t("capture.status")} value={status} options={OBSERVATION_STATUSES} labels={statuses} onChange={setStatus} placeholder={t("select.placeholder")} />
                  <Button label={t("capture.save")} onPress={() => startSaveOrReview(status)} loading={saving} />
                </>
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
          <Input
            style={{ flex: 1 }}
            value={text}
            onChangeText={setText}
            multiline
            inputStyle={styles.composerInput}
            placeholder={awaitingAnswer ? t("capture.placeholderMore") : t("capture.placeholder")}
          />
          <Button label={t("capture.send")} onPress={awaitingAnswer ? answerFollowUp : extract} disabled={!canSend} style={styles.sendBtn} />
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

interface ExtractionResultLocal {
  draft: ObservationDraft;
  question: string | null;
  questionField: { field: string; equipmentIndex: number | null } | null;
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
