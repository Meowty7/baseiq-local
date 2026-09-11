import { useCallback, useEffect, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import {
  getDb, listObservations, saveObservation,
  updateObservation, updateObservationClient, updateEquipment, deleteObservation,
} from "./db";
import {
  ensureModel, ensureWhisper, ensureVisionModel, isReady, isBusy, getLastInferMs, getDevice, setDeviceOverride,
  MODEL_NAME, releaseUnusedTranslators, transcribeAudio, type InferSnapshot, type TranscribeOptions,
} from "./qvac";
import { extractObservation, extractObservationFromImage } from "./extraction";
import { discardTempFile, prepareImageForVision, type Size } from "./media";
import { isLang, localizeUi, type Lang } from "../i18n";
import {
  OBSERVATION_STATUSES, SOURCE_TYPES, freshness, detectConflicts, normalizeDraft,
  type ObservationDraft, type ObservationRecord, type ObservationStatus,
} from "../../shared/observation";
import fixtures from "../../fixtures/observations.es.json";

function documentDir(): string {
  return FileSystem.documentDirectory ?? "";
}

/**
 * Dictation is Spanish-only (WHISPER_SPANISH_TINY). Loading the ~80 MB model
 * right after the LLM means the first mic tap transcribes instead of sitting
 * on a download. Runs under the shared native lock, so it never overlaps the
 * GPU llama load; failures are logged and retried on first use.
 */
function warmWhisper(lang: Lang): void {
  if (lang !== "es") return;
  void ensureWhisper().catch((err) => {
    console.warn("▸ whisper warm-up failed:", err instanceof Error ? err.message : err);
  });
}

export interface OverviewResult {
  observations: number;
  byModality: Record<string, number>;
  byCountry: Record<string, number>;
  fieldsUnknown: number;
  duplicates: string[];
  stale: string[];
  conflicts: { client: string; modality: string; detail: string; dates: string[]; statuses: string[] }[];
  renewals: { client: string; modality: string | null; brand: string | null; model: string | null; ageYears: number | null }[];
}

export interface StatusResult {
  ready: boolean;
  busy: boolean;
  model: string;
  device: "gpu" | "cpu" | null;
  lastInferMs: number | null;
}

/** Phases of a photo extraction, in order: downscale → (first-run VLM download) → inference. */
export type ImageProgress =
  | { stage: "prepare" }
  | { stage: "load"; pct: number }
  | { stage: "infer" };

export interface ExtractionResult {
  draft: ObservationDraft;
  question: string | null;
  inferMs: number;
  stats: InferSnapshot;
  sourceText: string;
}

export { OBSERVATION_STATUSES, SOURCE_TYPES };

export function computeOverview(obs: ObservationRecord[]): OverviewResult {
  const byModality: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  let unknown = 0;
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  const stale: string[] = [];
  const renewals: OverviewResult["renewals"] = [];
  for (const o of obs) {
    if (o.country) byCountry[o.country] = (byCountry[o.country] ?? 0) + 1;
    const f = freshness(o.observedAt, o.confirmedAt);
    if (f !== "reciente") stale.push(`${o.client} (${f}, ${o.status})`);
    for (const e of o.equipment) {
      if (e.modality) byModality[e.modality] = (byModality[e.modality] ?? 0) + (e.quantity ?? 1);
      if (!e.brand || !e.model || e.ageYears === null) unknown++;
      const key = `${o.client}||${e.modality ?? ""}||${e.brand ?? ""}||${e.model ?? ""}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (seen.get(key) === 2) duplicates.push(`${o.client}: ${e.quantity ?? "?"}× ${e.modality ?? "equipo"}${e.brand ? ` ${e.brand}` : ""}${e.model ? ` ${e.model}` : ""} reportado dos veces`);
      if (e.ageYears !== null && e.ageYears >= 7 && (o.status === "Confirmado" || o.status === "Estimado")) {
        renewals.push({ client: o.client ?? "Sin cliente", modality: e.modality, brand: e.brand, model: e.model, ageYears: e.ageYears });
      }
    }
  }
  return { observations: obs.length, byModality, byCountry, fieldsUnknown: unknown, duplicates, stale, renewals, conflicts: detectConflicts(obs) };
}

export function useStore() {
  const [status, setStatus] = useState<StatusResult>({ ready: false, busy: false, model: MODEL_NAME, device: null, lastInferMs: null });
  const [observations, setObservations] = useState<ObservationRecord[]>([]);
  const [overview, setOverview] = useState<OverviewResult | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [lang, setLangState] = useState<Lang>("es");
  const [uiLocalizing, setUiLocalizing] = useState(false);
  const [uiLocalizeProgress, setUiLocalizeProgress] = useState<number | null>(null);

  const refresh = useCallback(() => {
    const db = getDb();
    const list = listObservations(db);
    setObservations(list);
    setOverview(computeOverview(list));
    setStatus((s) => ({ ...s, ready: isReady(), busy: isBusy(), lastInferMs: getLastInferMs(), device: getDevice() }));
  }, []);

  const seedIfEmpty = useCallback(() => {
    const db = getDb();
    if (listObservations(db).length > 0) return;
    // Seed desde expect, sin inferencia: 12 llamadas al modelo al arrancar
    // calentaban y trababan la GPU del Poco (8–10s → timeout / hang).
    for (const fx of fixtures as unknown as { text: string; expect: { client: string | null; city: string | null; country: string | null; modalities: string[]; quantities?: Record<string, number> } }[]) {
      const client = fx.expect.client;
      if (!client) continue;
      saveObservation(db, {
        client, city: fx.expect.city, country: fx.expect.country,
        status: "Reportado", sourceText: fx.text,
        submittedBy: "seed", observedAt: "2026-09-01", sourceType: "visita", comments: null, confirmedAt: null,
      }, fx.expect.modalities.map((m) => ({
        modality: m, quantity: fx.expect.quantities?.[m] ?? 1,
        brand: null, model: null, ageYears: null, evidence: null,
      })));
    }
    refresh();
  }, [refresh]);

  useEffect(() => {
    (async () => {
      try {
        const flag = `${documentDir()}qvac.device`;
        const raw = (await FileSystem.readAsStringAsync(flag).catch(() => "")).trim().toLowerCase();
        if (raw === "cpu" || raw === "gpu") setDeviceOverride(raw);
        const savedLang = (await FileSystem.readAsStringAsync(`${documentDir()}baseiq.lang`).catch(() => "es")).trim();
        const initial: Lang = isLang(savedLang) ? savedLang : "es";
        setLangState(initial);
        seedIfEmpty();
        if (initial !== "es" && initial !== "en") setUiLocalizing(true);
        // One Bare worker: never overlap GPU llama load with Bergamot loadModel.
        await ensureModel((pct) => setProgress(pct));
        setProgress(null);
        try {
          await localizeUi(initial, (pct) => setUiLocalizeProgress(pct));
        } catch (err) {
          console.warn("ui localize failed:", err);
        }
        setUiLocalizing(false);
        setUiLocalizeProgress(null);
        refresh();
        warmWhisper(initial);
      } catch (err) {
        console.error("model preload failed:", err);
        setUiLocalizing(false);
        setUiLocalizeProgress(null);
      }
    })();
  }, [refresh, seedIfEmpty]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    void (async () => {
      try {
        await FileSystem.writeAsStringAsync(`${documentDir()}baseiq.lang`, next);
      } catch { /* ignore */ }
      if (next !== "es" && next !== "en") setUiLocalizing(true);
      try {
        await localizeUi(next, (pct) => setUiLocalizeProgress(pct));
      } catch (err) {
        console.warn("setLang localize failed:", err);
      } finally {
        setUiLocalizing(false);
        setUiLocalizeProgress(null);
      }
      // L→EN loads on first extract; preloading it here stacked Bergamot models
      // on Android (no unload) and timed out IT→EN while DE was still loading.
      await releaseUnusedTranslators(next).catch(() => {});
      warmWhisper(next);
    })();
  }, []);

  const extract = useCallback(async (text: string, onProgress?: (snap: InferSnapshot) => void): Promise<ExtractionResult> => {
    const { draft, question, inferMs, stats } = await extractObservation(text.trim(), lang, onProgress);
    return { draft, question, inferMs, stats, sourceText: text.trim() };
  }, [lang]);

  const transcribe = useCallback(async (audioUri: string, opts: TranscribeOptions = {}): Promise<string> => {
    try {
      return await transcribeAudio(audioUri, opts);
    } finally {
      // Each dictation is a fresh .m4a in the cache dir; nothing reads it again.
      void discardTempFile(audioUri);
    }
  }, []);

  /** Start downloading/loading the VLM while the user is still picking a photo. */
  const warmVision = useCallback((onProgress?: (pct: number) => void): Promise<void> => {
    return ensureVisionModel(onProgress).then(() => undefined, (err) => {
      console.warn("▸ vision warm-up failed:", err instanceof Error ? err.message : err);
    });
  }, []);

  const extractImage = useCallback(async (
    uri: string,
    size?: Partial<Size> | null,
    onProgress?: (p: ImageProgress) => void,
    onInfer?: (snap: InferSnapshot) => void,
  ): Promise<ExtractionResult> => {
    onProgress?.({ stage: "prepare" });
    const prepared = await prepareImageForVision(uri, size);
    onProgress?.({ stage: "infer" });
    try {
      const { draft, question, inferMs, stats } = await extractObservationFromImage(
        prepared.uri,
        lang,
        onInfer,
        (pct) => onProgress?.(pct >= 100 ? { stage: "infer" } : { stage: "load", pct }),
      );
      return { draft, question, inferMs, stats, sourceText: "(imagen)" };
    } finally {
      if (prepared.temp) void discardTempFile(prepared.uri);
    }
  }, [lang]);

  const save = useCallback((input: {
    client: string; city: string | null; country: string | null;
    status: ObservationStatus; sourceText: string;
    equipment: ObservationDraft["equipment"];
    submittedBy: string | null; observedAt: string | null; sourceType: string | null; comments: string | null;
  }): number => {
    const db = getDb();
    // Lo revisado en el chat se guarda tal cual. Re-blindar aquí pisaba cantidad/modalidad
    // (p. ej. 200 resonadores) y dejaba la observación sin equipos en el 360.
    const draft = normalizeDraft({
      client: input.client.trim(),
      city: input.city, country: input.country,
      equipment: input.equipment, missing: [],
    });
    const id = saveObservation(db, {
      client: draft.client ?? input.client.trim(),
      city: draft.city, country: draft.country,
      status: input.status, sourceText: input.sourceText,
      submittedBy: input.submittedBy, observedAt: input.observedAt,
      sourceType: input.sourceType, comments: input.comments,
      confirmedAt: input.status === "Confirmado" ? new Date().toISOString() : null,
    }, draft.equipment);
    refresh();
    return id;
  }, [refresh]);

  const update = useCallback((id: number, input: {
    client?: string; city?: string | null; country?: string | null;
    status?: ObservationStatus; submittedBy?: string | null; observedAt?: string | null;
    sourceType?: string | null; comments?: string | null;
    equipment?: ObservationDraft["equipment"];
  }): void => {
    const db = getDb();
    const { client, equipment, ...rest } = input;
    if (client) updateObservationClient(db, id, client.trim(), input.city ?? null, input.country ?? null);
    const fields: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) fields[k] = v as string | number | null;
    if (Object.keys(fields).length > 0) updateObservation(db, id, fields);
    if (equipment) updateEquipment(db, id, equipment);
    refresh();
  }, [refresh]);

  const remove = useCallback((id: number): void => {
    deleteObservation(getDb(), id);
    refresh();
  }, [refresh]);

  return { status, observations, overview, progress, lang, setLang, uiLocalizing, uiLocalizeProgress, refresh, extract, transcribe, warmVision, extractImage, save, update, remove };
}
