import {
  loadModel, completion, unloadModel, translate, transcribe,
  QWEN3_600M_INST_Q4, LLAMA_3_2_1B_INST_Q4_0, HEALTHCARE_1_7B_MEDICAL_IQ3_XXS,
  QWEN3_1_7B_INST_Q4, SMOLLM2_360M_INST_Q8, SALAMANDRATA_2B_INST_Q4,
  LLAMA_TOOL_CALLING_1B_INST_Q4_K, QWEN3_5_0_8B_MULTIMODAL_Q4_K_M,
  MMPROJ_QWEN3_5_0_8B_MULTIMODAL_Q8_0,
  WHISPER_SPANISH_TINY_Q8_0,
  HEALTHCARE_4B_MEDICAL_IQ3_XXS,
} from "@qvac/sdk";
import * as QvacSdk from "@qvac/sdk";

export const MODELS = {
  qwen: { src: QWEN3_600M_INST_Q4, name: "QWEN3_600M_INST_Q4" },
  llama: { src: LLAMA_3_2_1B_INST_Q4_0, name: "LLAMA_3_2_1B_INST_Q4_0" },
  medpsy: { src: HEALTHCARE_1_7B_MEDICAL_IQ3_XXS, name: "HEALTHCARE_1_7B_MEDICAL_IQ3_XXS" },
  qwen17: { src: QWEN3_1_7B_INST_Q4, name: "QWEN3_1_7B_INST_Q4" },
  smol: { src: SMOLLM2_360M_INST_Q8, name: "SMOLLM2_360M_INST_Q8" },
  salamandra: { src: SALAMANDRATA_2B_INST_Q4, name: "SALAMANDRATA_2B_INST_Q4" },
  toolcall: { src: LLAMA_TOOL_CALLING_1B_INST_Q4_K, name: "LLAMA_TOOL_CALLING_1B_INST_Q4_K" },
  qwen35: { src: QWEN3_5_0_8B_MULTIMODAL_Q4_K_M, name: "QWEN3_5_0_8B_MULTIMODAL_Q4_K_M" },
  medpsy4: { src: HEALTHCARE_4B_MEDICAL_IQ3_XXS, name: "HEALTHCARE_4B_MEDICAL_IQ3_XXS" },
} as const;
export type ModelKey = keyof typeof MODELS;

const PAIR_LANGS = ["es", "pt", "fr", "de", "it", "nl", "pl", "ro", "cs", "sv", "da", "ru", "tr", "ar", "zh", "ja", "ko"] as const;

export function pairKey(from: string, to: string): string {
  return `${from}-${to}`;
}

export function translatorName(from: string, to: string): string {
  return `BERGAMOT_${from.toUpperCase()}_${to.toUpperCase()}`;
}

function bergamotModel(from: string, to: string): unknown {
  return (QvacSdk as unknown as Record<string, unknown>)[translatorName(from, to)] ?? null;
}

export const BERGAMOT_PAIRS: Record<string, unknown> = {};
for (const lang of PAIR_LANGS) {
  const toEn = bergamotModel(lang, "en");
  const fromEn = bergamotModel("en", lang);
  if (toEn) BERGAMOT_PAIRS[pairKey(lang, "en")] = toEn;
  if (fromEn) BERGAMOT_PAIRS[pairKey("en", lang)] = fromEn;
}

function pick(key?: string) {
  const fallback = defaultModelKey();
  return MODELS[(key ?? process.env.QVAC_MODEL ?? fallback).toLowerCase() as ModelKey] ?? MODELS[fallback];
}

let selected = pick();
export let MODEL_SRC = selected.src;
export let MODEL_NAME = selected.name;

export type InferDevice = "gpu" | "cpu";

export type TranslateStats = {
  totalTokens?: number;
  totalTime?: number;
  decodeTime?: number;
  TPS?: number;
  TTFT?: number;
  [key: string]: unknown;
};

export type TranslateBatchResult = {
  translations: string[];
  stats: TranslateStats | null;
  ms: number;
};

type QvacState = {
  modelId: string | null;
  loading: Promise<string> | null;
  lastInferMs: number | null;
  device: InferDevice | null;
  gpuFailed: boolean;
  deviceOverride: InferDevice | null;
  tail: Promise<void>;
  nativeUnified: boolean;
  inflight: number;
  translators: Record<string, string>;
  translatorLoading: Record<string, Promise<string>>;
  translatorFailed: Record<string, boolean>;
  lastTranslateMs: number | null;
  lastTranslateStats: TranslateStats | null;
  translatorTail: Promise<void>;
  translatorInflight: number;
  whisperId: string | null;
  whisperLoading: Promise<string> | null;
  visionId: string | null;
  visionLoading: Promise<string> | null;
  auxProgress: Record<AuxModel, Set<(pct: number) => void>>;
};

/** Models loaded on demand next to the LLM; their download progress is broadcast. */
export type AuxModel = "whisper" | "vision";

// ponytail: Fast Refresh (bun run start) reinicia este módulo y modelId queda null,
// pero en Android el worker GPU sigue vivo (QVAC-19304). Recargar el modelo encima
// satura Adreno/Mali y la inferencia deja de terminar. El singleton sobrevive al HMR.
const g = globalThis as typeof globalThis & { __baseiqQvac?: QvacState };
const st = g.__baseiqQvac ?? (g.__baseiqQvac = {
  modelId: null,
  loading: null,
  lastInferMs: null,
  device: null,
  gpuFailed: false,
  deviceOverride: null,
  tail: Promise.resolve(),
  nativeUnified: false,
  inflight: 0,
  translators: {},
  translatorLoading: {},
  translatorFailed: {},
  lastTranslateMs: null,
  lastTranslateStats: null,
  translatorTail: Promise.resolve(),
  translatorInflight: 0,
  whisperId: null,
  whisperLoading: null,
  visionId: null,
  visionLoading: null,
  auxProgress: { whisper: new Set(), vision: new Set() },
});
st.translators ??= {};
st.translatorLoading ??= {};
st.translatorFailed ??= {};
st.lastTranslateMs ??= null;
st.lastTranslateStats ??= null;
st.translatorTail ??= Promise.resolve();
st.translatorInflight ??= 0;
st.whisperId ??= null;
st.whisperLoading ??= null;
st.visionId ??= null;
st.visionLoading ??= null;
st.auxProgress ??= { whisper: new Set(), vision: new Set() };
if (!st.nativeUnified) {
  // LLM + NMT share one Bare worker. Overlapping loadModel/completion on Adreno
  // never returns (same failure mode as reloading the LLM on HMR).
  st.tail = Promise.all([st.tail, st.translatorTail]).then(() => {});
  st.translatorTail = st.tail;
  st.nativeUnified = true;
}

/**
 * Subscribe to download/load progress of an auxiliary model. A warm-up started
 * elsewhere (e.g. when the camera button is tapped) and the call that later
 * needs the model both see the same ticks, so the UI can show a percentage
 * even when it was not the one to start the load.
 */
export function onAuxProgress(kind: AuxModel, fn: (pct: number) => void): () => void {
  st.auxProgress[kind].add(fn);
  return () => { st.auxProgress[kind].delete(fn); };
}

function emitAuxProgress(kind: AuxModel, pct: number): void {
  for (const fn of st.auxProgress[kind]) {
    try {
      fn(pct);
    } catch {
      /* listener errors must not break the load */
    }
  }
}

function withNativeLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = st.tail;
  let release!: () => void;
  st.tail = st.translatorTail = new Promise<void>((r) => { release = r; });
  return prev.then(async () => {
    try {
      return await fn();
    } finally {
      release();
    }
  });
}

export async function switchModel(key: string): Promise<void> {
  await shutdownLlm();
  st.gpuFailed = false;
  selected = pick(key);
  MODEL_SRC = selected.src;
  MODEL_NAME = selected.name;
}

export function setDeviceOverride(d: InferDevice | null): void {
  st.deviceOverride = d;
}

export function isReady(): boolean { return st.modelId !== null; }
export function isWhisperReady(): boolean { return st.whisperId !== null; }
export function isVisionReady(): boolean { return st.visionId !== null; }
export function isTranslatorReady(from?: string, to?: string): boolean {
  if (from && to) {
    if (from === to) return true;
    return Boolean(st.translators[pairKey(from, to)]);
  }
  return Object.keys(st.translators).length > 0;
}
export function isBusy(): boolean {
  return st.inflight > 0 || st.loading !== null || st.translatorInflight > 0 || Object.keys(st.translatorLoading).length > 0 || st.whisperLoading !== null || st.visionLoading !== null;
}
export function getLastInferMs(): number | null { return st.lastInferMs; }
export function getLastTranslateMs(): number | null { return st.lastTranslateMs; }
export function getLastTranslateStats(): TranslateStats | null { return st.lastTranslateStats; }
export function getDevice(): InferDevice | null { return st.device; }

export function isMissingModelError(error: unknown): boolean {
  return error instanceof Error && /Model with ID ".+" not found/i.test(error.message);
}

function nativePlatform(): string | null {
  try {
    return require("react-native").Platform.OS;
  } catch {
    return null;
  }
}

function isAndroid(): boolean {
  return nativePlatform() === "android";
}

function defaultModelKey(): ModelKey {
  return "qwen";
}

function preferredDevice(): InferDevice {
  if (st.deviceOverride === "cpu" || st.deviceOverride === "gpu") return st.deviceOverride;
  const v = process.env.QVAC_DEVICE?.toLowerCase();
  if (v === "cpu" || v === "gpu") return v;
  return st.gpuFailed ? "cpu" : "gpu";
}

function modelConfig(d: InferDevice) {
  return d === "gpu" ? { device: "gpu", gpu_layers: 99 } : { device: "cpu", gpu_layers: 0 };
}

const LOAD_STALL_MS = 120000;

async function loadOn(d: InferDevice, onProgress?: (pct: number) => void): Promise<string> {
  return withStallTimeout(
    (report) => loadModel({
      modelSrc: selected.src,
      modelConfig: modelConfig(d),
      onProgress: (p: { percentage: number }) => report(p.percentage),
    } as unknown as Parameters<typeof loadModel>[0]),
    LOAD_STALL_MS,
    "load_timeout",
    onProgress,
  );
}

function withTimeout<T>(p: Promise<T>, ms: number, code: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(code)), ms)),
  ]);
}

/**
 * Timeout that only fires after `stallMs` without a progress tick. A fixed
 * budget rejected slow first downloads (hundreds of MB on mobile data) while
 * the fetch kept going in the background; here progress keeps the load alive
 * and only a real stall (no bytes, no native load completion) fails it.
 */
export function withStallTimeout<T>(
  start: (report: (pct: number) => void) => Promise<T>,
  stallMs: number,
  code: string,
  onProgress?: (pct: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(code));
      }, stallMs);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    arm();
    let last = -1;
    start((pct) => {
      if (settled) return;
      if (pct > last) {
        last = pct;
        arm();
      }
      onProgress?.(pct);
    }).then(
      (value) => finish(() => resolve(value)),
      (err) => finish(() => reject(err)),
    );
  });
}

/**
 * Expo hands out `file://` URIs (recorder, image picker, manipulator). The Bare
 * worker resolves attachments and audio with plain `fs` calls, so a URI fails
 * `existsSync` and surfaces as "attachment/audio not found" after the model
 * has already been loaded. Strip the scheme and percent-decoding here.
 */
export function toNativePath(uri: string): string {
  let out = uri.trim();
  if (/^file:\/\//i.test(out)) {
    out = out.replace(/^file:\/\/(localhost)?/i, "");
    // Windows drive URIs (`file:///C:/x`) keep their leading slash stripped.
    if (/^\/[A-Za-z]:\//.test(out)) out = out.slice(1);
    try {
      out = decodeURIComponent(out);
    } catch {
      /* keep the raw path if it has stray % */
    }
  }
  return out;
}

async function loadLlmLocked(onProgress?: (pct: number) => void): Promise<string> {
  if (st.modelId) return st.modelId;
  const preferred = preferredDevice();
  const run = async () => {
    try {
      const id = await loadOn(preferred, onProgress);
      st.device = preferred;
      console.log(`▸ QVAC device=${st.device} model=${selected.name}`);
      return id;
    } catch (err) {
      if (preferred === "cpu") throw err;
      st.gpuFailed = true;
      console.warn(`▸ QVAC GPU load failed, falling back to CPU:`, err instanceof Error ? err.message : err);
      const id = await loadOn("cpu", onProgress);
      st.device = "cpu";
      console.log(`▸ QVAC device=${st.device} model=${selected.name}`);
      return id;
    }
  };
  st.loading = run();
  try {
    const id = await st.loading;
    st.modelId = id;
    return id;
  } finally {
    st.loading = null;
  }
}

export function ensureModel(onProgress?: (pct: number) => void): Promise<string> {
  if (st.modelId) return Promise.resolve(st.modelId);
  return withNativeLock(() => loadLlmLocked(onProgress));
}

async function loadTranslatorLocked(from: string, to: string, onProgress?: (pct: number) => void): Promise<string> {
  const key = pairKey(from, to);
  if (st.translators[key]) return st.translators[key];
  if (st.translatorFailed[key]) throw new Error(`translator_failed:${key}`);
  const src = BERGAMOT_PAIRS[key] ?? bergamotModel(from, to);
  if (!src) throw new Error(`no_bergamot_pair:${key}`);
  const run = (async () => {
    const id = await withStallTimeout(
      (report) => loadModel({
        modelSrc: src,
        modelType: "nmt",
        modelConfig: { engine: "Bergamot", from, to },
        onProgress: (p: { percentage: number }) => report(p.percentage),
      } as unknown as Parameters<typeof loadModel>[0]),
      LOAD_STALL_MS,
      "load_timeout",
      onProgress,
    );
    console.log(`▸ QVAC translator=${translatorName(from, to)} device=cpu`);
    return id;
  })();
  st.translatorLoading[key] = run;
  try {
    const id = await run;
    st.translators[key] = id;
    return id;
  } catch (err) {
    const timedOut = err instanceof Error && err.message === "load_timeout";
    if (!timedOut) st.translatorFailed[key] = true;
    console.warn(`▸ QVAC translator ${key} load failed:`, err instanceof Error ? err.message : err);
    throw err;
  } finally {
    delete st.translatorLoading[key];
  }
}

export function ensureTranslator(from: string, to: string, onProgress?: (pct: number) => void): Promise<string | null> {
  if (from === to) return Promise.resolve(null);
  const key = pairKey(from, to);
  if (st.translators[key]) return Promise.resolve(st.translators[key]);
  if (st.translatorFailed[key] && !st.translatorLoading[key]) return Promise.resolve(null);
  return withNativeLock(() => loadTranslatorLocked(from, to, onProgress)).catch(() => null);
}

function normalizeTranslateStats(stats: TranslateStats | null | undefined): TranslateStats | null {
  if (!stats) return null;
  return {
    ...stats,
    TPS: typeof stats.TPS === "number" ? stats.TPS : typeof stats.tokensPerSecond === "number" ? stats.tokensPerSecond : undefined,
    TTFT: typeof stats.TTFT === "number" ? stats.TTFT : typeof stats.timeToFirstToken === "number" ? stats.timeToFirstToken : undefined,
  };
}

async function runTranslate(id: string, text: string | string[], timeoutMs: number) {
  // NMT: from/to van en loadModel(modelConfig), no en translate(). Extra keys rompen el schema.
  const run = translate({
    modelId: id,
    text,
    modelType: "nmtcpp-translation",
    stream: false,
  });
  try {
    const [translated, translations, stats] = await withTimeout(
      Promise.all([
        run.text,
        run.translations,
        run.stats.catch(() => undefined),
      ]),
      timeoutMs,
      "translate_timeout",
    );
    return { translated, translations, stats: normalizeTranslateStats((stats as TranslateStats | undefined) ?? null) };
  } catch (err) {
    await Promise.all([run.text.catch(() => {}), run.translations.catch(() => {}), run.stats.catch(() => {})]);
    throw err;
  }
}

async function withTranslatorQueue<T>(from: string, to: string, fn: (id: string) => Promise<T>, onProgress?: (pct: number) => void): Promise<T | null> {
  return withNativeLock(async () => {
    let id: string;
    try {
      id = await loadTranslatorLocked(from, to, onProgress);
    } catch {
      return null;
    }
    st.translatorInflight += 1;
    try {
      return await fn(id);
    } catch (err) {
      console.warn(`▸ QVAC translate ${from}->${to} failed:`, err instanceof Error ? err.message : err);
      return null;
    } finally {
      st.translatorInflight = Math.max(0, st.translatorInflight - 1);
    }
  });
}

export async function translateBatch(
  from: string,
  to: string,
  texts: string[],
  timeoutMs = 60000,
  onProgress?: (pct: number) => void,
): Promise<TranslateBatchResult | null> {
  if (texts.length === 0) return { translations: [], stats: null, ms: 0 };
  if (from === to) return { translations: [...texts], stats: null, ms: 0 };
  const t0 = Date.now();
  // ponytail: one 100-string Bergamot call looks frozen at download-complete (40%) on phone CPU; chunks keep progress moving.
  const CHUNK = 8;
  const chunkTimeout = Math.min(timeoutMs, 30000);
  return withTranslatorQueue(from, to, async (id) => {
    onProgress?.(50);
    const translations: string[] = [];
    let stats: TranslateStats | null = null;
    for (let i = 0; i < texts.length; i += CHUNK) {
      const slice = texts.slice(i, i + CHUNK);
      try {
        const result = await runTranslate(id, slice, chunkTimeout);
        const part = (result.translations ?? []).map((item) => (item ?? "").trim());
        if (part.length !== slice.length) throw new Error("translate_batch_mismatch");
        for (let j = 0; j < slice.length; j++) translations.push(part[j] || slice[j]);
        stats = result.stats;
      } catch (err) {
        console.warn(`▸ QVAC translate chunk ${i}+${slice.length} failed:`, err instanceof Error ? err.message : err);
        translations.push(...slice);
      }
      onProgress?.(50 + Math.round((50 * translations.length) / texts.length));
    }
    const ms = Date.now() - t0;
    st.lastTranslateMs = ms;
    st.lastTranslateStats = stats;
    return { translations, stats, ms };
  }, (pct) => onProgress?.(Math.round(pct * 0.5)));
}

export async function translateNote(lang: string, text: string, timeoutMs = 15000): Promise<string | null> {
  if (!text.trim()) return text;
  if (lang === "en") return text;
  const t0 = Date.now();
  const out = await withTranslatorQueue(lang, "en", async (id) => {
    const result = await runTranslate(id, text, timeoutMs);
    const value = (result.translated ?? result.translations?.[0] ?? "").trim();
    if (!value) return null;
    st.lastTranslateMs = Date.now() - t0;
    st.lastTranslateStats = result.stats;
    return value;
  });
  return out;
}

export async function unloadTranslator(from: string, to: string): Promise<void> {
  const key = pairKey(from, to);
  const id = st.translators[key];
  if (!id) return;
  if (isAndroid()) return;
  await unloadModel({ modelId: id }).catch(() => {});
  delete st.translators[key];
}

export async function releaseUnusedTranslators(keepLang: string): Promise<void> {
  const keep = new Set([pairKey(keepLang, "en")]);
  for (const key of Object.keys(st.translators)) {
    if (keep.has(key)) continue;
    const [from, to] = key.split("-");
    await unloadTranslator(from, to);
  }
}

export async function inferJson(system: string, user: string, schema: object, timeoutMs = 45000): Promise<{ text: string; inferMs: number }> {
  return withNativeLock(async () => {
    st.inflight += 1;
    const t0 = Date.now();
    try {
      const complete = async (id: string) => {
        const run = completion({
          modelId: id,
          history: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          stream: false,
          responseFormat: { type: "json_schema", json_schema: { name: "observation", schema: schema as Record<string, unknown> } },
        });
        try {
          return await withTimeout(run.final, timeoutMs, "infer_timeout");
        } catch (err) {
          // ponytail: race no cancela el worker. Si el JSON llega tarde, úsalo; no lo tires.
          const late = await run.final.then((v) => v, () => null);
          if (late?.contentText?.trim()) {
            console.warn(`▸ QVAC infer recovered after timeout (${Date.now() - t0}ms)`);
            return late;
          }
          console.warn(`▸ QVAC infer_timeout after ${Date.now() - t0}ms`);
          throw err;
        }
      };

      let id = await loadLlmLocked();
      let final;
      try {
        final = await complete(id);
      } catch (error) {
        if (st.device !== "gpu" || !isMissingModelError(error)) throw error;
        st.gpuFailed = true;
        st.modelId = null;
        st.loading = null;
        st.device = null;
        id = await loadLlmLocked();
        final = await complete(id);
      }
      st.lastInferMs = Date.now() - t0;
      return { text: final.contentText, inferMs: st.lastInferMs };
    } finally {
      st.inflight = Math.max(0, st.inflight - 1);
    }
  });
}

// Domain vocabulary biases the tiny decoder towards the words field notes
// actually contain. Set once at load: passing `prompt` per call makes the SDK
// reload the native context twice per transcription (apply + restore).
const WHISPER_INITIAL_PROMPT =
  "Visita a hospital o clínica. Resonador, tomógrafo, ecógrafo, rayos X, mamógrafo. Philips, Siemens, GE. Años de antigüedad.";

const WHISPER_CONFIG: Record<string, unknown> = {
  language: "es",
  audio_format: "s16le",
  initial_prompt: WHISPER_INITIAL_PROMPT,
  no_timestamps: true,
  suppress_blank: true,
  suppress_nst: true,
  temperature: 0,
};

async function loadWhisperLocked(): Promise<string> {
  if (st.whisperId) return st.whisperId;
  const id = await withStallTimeout(
    (report) => loadModel({
      modelSrc: WHISPER_SPANISH_TINY_Q8_0,
      modelType: "whispercpp-transcription",
      modelConfig: WHISPER_CONFIG,
      onProgress: (p: { percentage: number }) => report(p.percentage),
    } as unknown as Parameters<typeof loadModel>[0]),
    LOAD_STALL_MS,
    "load_timeout",
    (pct) => emitAuxProgress("whisper", pct),
  );
  console.log("▸ QVAC whisper=WHISPER_SPANISH_TINY_Q8_0 device=cpu");
  st.whisperId = id;
  emitAuxProgress("whisper", 100);
  return id;
}

export function ensureWhisper(onProgress?: (pct: number) => void): Promise<string> {
  if (st.whisperId) return Promise.resolve(st.whisperId);
  const off = onProgress ? onAuxProgress("whisper", onProgress) : null;
  if (!st.whisperLoading) {
    st.whisperLoading = withNativeLock(() => loadWhisperLocked())
      .then((id) => { st.whisperLoading = null; return id; })
      .catch((err) => { st.whisperLoading = null; throw err; });
  }
  return st.whisperLoading.finally(() => off?.());
}

export interface TranscribeOptions {
  /** Length of the recording; the timeout scales with it so long dictations are not cut off. */
  durationMs?: number;
  timeoutMs?: number;
  /** Download/load progress of the Whisper model when it is not resident yet. */
  onLoadProgress?: (pct: number) => void;
}

export function transcribeTimeoutMs(durationMs?: number): number {
  // tiny-q8 on a phone CPU runs well under 1× real time; 3× plus a floor
  // covers FFmpeg decode of the .m4a and a slow first run.
  const base = 20000;
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return 45000;
  return Math.min(180000, Math.max(30000, base + durationMs * 3));
}

export async function transcribeAudio(uri: string, opts: TranscribeOptions = {}): Promise<string> {
  const path = toNativePath(uri);
  const timeoutMs = opts.timeoutMs ?? transcribeTimeoutMs(opts.durationMs);
  const off = opts.onLoadProgress ? onAuxProgress("whisper", opts.onLoadProgress) : null;
  return withNativeLock(async () => {
    let id: string;
    try {
      id = await loadWhisperLocked();
    } finally {
      off?.();
    }
    st.inflight += 1;
    const t0 = Date.now();
    try {
      const text = await withTimeout(
        transcribe({ modelId: id, audioChunk: path } as Parameters<typeof transcribe>[0]),
        timeoutMs,
        "transcribe_timeout",
      );
      console.log(`▸ QVAC transcribe ${Date.now() - t0}ms (audio ${opts.durationMs ?? "?"}ms)`);
      return typeof text === "string" ? text.trim() : "";
    } finally {
      st.inflight = Math.max(0, st.inflight - 1);
    }
  });
}

async function loadVisionLocked(): Promise<string> {
  if (st.visionId) return st.visionId;
  const preferred = preferredDevice();
  const cfg = preferred === "gpu"
    ? { device: "gpu", gpu_layers: 99, "mmproj-use-gpu": false }
    : { device: "cpu", gpu_layers: 0, "mmproj-use-gpu": false };
  // GGUF + mmproj together are several hundred MB; the model then has to be
  // mapped onto the GPU. Both phases are slow on a phone, so the stall window
  // is wider than for the text LLM.
  const id = await withStallTimeout(
    (report) => loadModel({
      modelSrc: MODELS.qwen35.src,
      modelType: "llamacpp-completion",
      projectionModelSrc: MMPROJ_QWEN3_5_0_8B_MULTIMODAL_Q8_0,
      modelConfig: cfg,
      onProgress: (p: { percentage: number }) => report(p.percentage),
    } as unknown as Parameters<typeof loadModel>[0]),
    180000,
    "load_timeout",
    (pct) => emitAuxProgress("vision", pct),
  );
  console.log(`▸ QVAC vision=QWEN3_5_0_8B_MULTIMODAL_Q4_K_M device=${preferred}`);
  st.visionId = id;
  emitAuxProgress("vision", 100);
  return id;
}

export function ensureVisionModel(onProgress?: (pct: number) => void): Promise<string> {
  if (st.visionId) return Promise.resolve(st.visionId);
  const off = onProgress ? onAuxProgress("vision", onProgress) : null;
  if (!st.visionLoading) {
    st.visionLoading = withNativeLock(() => loadVisionLocked())
      .then((id) => { st.visionLoading = null; return id; })
      .catch((err) => { st.visionLoading = null; throw err; });
  }
  return st.visionLoading.finally(() => off?.());
}

export async function inferJsonWithImage(
  system: string,
  user: string,
  imageUri: string,
  schema: object,
  timeoutMs = 120000,
  onLoadProgress?: (pct: number) => void,
): Promise<{ text: string; inferMs: number }> {
  const imagePath = toNativePath(imageUri);
  const off = onLoadProgress ? onAuxProgress("vision", onLoadProgress) : null;
  return withNativeLock(async () => {
    st.inflight += 1;
    try {
      let id: string;
      try {
        id = await loadVisionLocked();
      } finally {
        off?.();
      }
      // Measured from prompt submission: a first-run download is not "inference".
      const t0 = Date.now();
      const run = completion({
        modelId: id,
        history: [
          { role: "system", content: system },
          { role: "user", content: user, attachments: [{ path: imagePath }] },
        ],
        stream: false,
        responseFormat: { type: "json_schema", json_schema: { name: "observation", schema: schema as Record<string, unknown> } },
      });
      try {
        const final = await withTimeout(run.final, timeoutMs, "infer_timeout");
        st.lastInferMs = Date.now() - t0;
        return { text: final.contentText, inferMs: st.lastInferMs };
      } catch (err) {
        const late = await run.final.then((v) => v, () => null);
        if (late?.contentText?.trim()) {
          console.warn(`▸ QVAC vision infer recovered after timeout (${Date.now() - t0}ms)`);
          return { text: late.contentText, inferMs: Date.now() - t0 };
        }
        throw err;
      }
    } finally {
      st.inflight = Math.max(0, st.inflight - 1);
    }
  });
}

async function shutdownLlm(): Promise<void> {
  if (!st.modelId) return;
  if (isAndroid()) return;
  await unloadModel({ modelId: st.modelId }).catch(() => {});
  st.modelId = null;
  st.device = null;
}

async function shutdownTranslators(): Promise<void> {
  for (const key of Object.keys(st.translators)) {
    const [from, to] = key.split("-");
    await unloadTranslator(from, to);
  }
}

export async function shutdown(): Promise<void> {
  await shutdownLlm();
  await shutdownTranslators();
}
