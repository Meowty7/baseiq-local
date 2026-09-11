import {
  loadModel, completion, unloadModel, translate,
  QWEN3_600M_INST_Q4, LLAMA_3_2_1B_INST_Q4_0, HEALTHCARE_1_7B_MEDICAL_IQ3_XXS,
  QWEN3_1_7B_INST_Q4, SMOLLM2_360M_INST_Q8, SALAMANDRATA_2B_INST_Q4,
  LLAMA_TOOL_CALLING_1B_INST_Q4_K, QWEN3_5_0_8B_MULTIMODAL_Q4_K_M,
  HEALTHCARE_4B_MEDICAL_IQ3_XXS,
} from "@qvac/sdk";
import * as QvacSdk from "@qvac/sdk";
import {
  applyCompletionEvent,
  emptyInferSnapshot,
  mergeSdkStats,
  type InferSnapshot,
} from "./infer-metrics";

export type { InferPhase, InferSnapshot } from "./infer-metrics";
export { formatInferCaption, formatMs, formatTps } from "./infer-metrics";

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
  lastInferStats: InferSnapshot | null;
  device: InferDevice | null;
  gpuFailed: boolean;
  deviceOverride: InferDevice | null;
  tail: Promise<void>;
  inflight: number;
  translators: Record<string, string>;
  translatorLoading: Record<string, Promise<string>>;
  translatorFailed: Record<string, boolean>;
  lastTranslateMs: number | null;
  lastTranslateStats: TranslateStats | null;
  translatorTail: Promise<void>;
  translatorInflight: number;
};

// ponytail: Fast Refresh (bun run start) reinicia este módulo y modelId queda null,
// pero en Android el worker GPU sigue vivo (QVAC-19304). Recargar el modelo encima
// satura Adreno/Mali y la inferencia deja de terminar. El singleton sobrevive al HMR.
const g = globalThis as typeof globalThis & { __baseiqQvac?: QvacState };
const st = g.__baseiqQvac ?? (g.__baseiqQvac = {
  modelId: null,
  loading: null,
  lastInferMs: null,
  lastInferStats: null,
  device: null,
  gpuFailed: false,
  deviceOverride: null,
  tail: Promise.resolve(),
  inflight: 0,
  translators: {},
  translatorLoading: {},
  translatorFailed: {},
  lastTranslateMs: null,
  lastTranslateStats: null,
  translatorTail: Promise.resolve(),
  translatorInflight: 0,
});
st.translators ??= {};
st.translatorLoading ??= {};
st.translatorFailed ??= {};
st.lastTranslateMs ??= null;
st.lastTranslateStats ??= null;
st.lastInferStats ??= null;
st.translatorTail ??= Promise.resolve();
st.translatorInflight ??= 0;

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
export function isTranslatorReady(from?: string, to?: string): boolean {
  if (from && to) {
    if (from === to) return true;
    return Boolean(st.translators[pairKey(from, to)]);
  }
  return Object.keys(st.translators).length > 0;
}
export function isBusy(): boolean {
  return st.inflight > 0 || st.loading !== null || st.translatorInflight > 0 || Object.keys(st.translatorLoading).length > 0;
}
export function getLastInferMs(): number | null { return st.lastInferMs; }
export function getLastInferStats(): InferSnapshot | null { return st.lastInferStats; }
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

async function loadOn(d: InferDevice, onProgress?: (pct: number) => void): Promise<string> {
  return loadModel({
    modelSrc: selected.src,
    modelConfig: modelConfig(d),
    onProgress: (p: { percentage: number }) => onProgress?.(p.percentage),
  } as unknown as Parameters<typeof loadModel>[0]);
}

function withTimeout<T>(p: Promise<T>, ms: number, code: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(code)), ms)),
  ]);
}

export function ensureModel(onProgress?: (pct: number) => void): Promise<string> {
  if (st.modelId) return Promise.resolve(st.modelId);
  if (!st.loading) {
    st.loading = (async () => {
      const preferred = preferredDevice();
      try {
        const id = await withTimeout(loadOn(preferred, onProgress), 120000, "load_timeout");
        st.device = preferred;
        console.log(`▸ QVAC device=${st.device} model=${selected.name}`);
        return id;
      } catch (err) {
        if (preferred === "cpu") throw err;
        st.gpuFailed = true;
        console.warn(`▸ QVAC GPU load failed, falling back to CPU:`, err instanceof Error ? err.message : err);
        const id = await withTimeout(loadOn("cpu", onProgress), 120000, "load_timeout");
        st.device = "cpu";
        console.log(`▸ QVAC device=${st.device} model=${selected.name}`);
        return id;
      }
    })().then((id) => {
      st.modelId = id;
      st.loading = null;
      return id;
    }).catch((err) => {
      st.loading = null;
      throw err;
    });
  }
  return st.loading;
}

export function ensureTranslator(from: string, to: string, onProgress?: (pct: number) => void): Promise<string | null> {
  if (from === to) return Promise.resolve(null);
  const key = pairKey(from, to);
  if (st.translators[key]) return Promise.resolve(st.translators[key]);
  if (st.translatorFailed[key] && !st.translatorLoading[key]) return Promise.resolve(null);
  if (!st.translatorLoading[key]) {
    st.translatorLoading[key] = (async () => {
      const src = BERGAMOT_PAIRS[key] ?? bergamotModel(from, to);
      if (!src) throw new Error(`no_bergamot_pair:${key}`);
      const id = await withTimeout(
        loadModel({
          modelSrc: src,
          modelType: "nmt",
          modelConfig: { engine: "Bergamot", from, to },
          onProgress: (p: { percentage: number }) => onProgress?.(Math.max(1, Math.min(40, p.percentage * 0.4))),
        } as unknown as Parameters<typeof loadModel>[0]),
        120000,
        "load_timeout",
      );
      console.log(`▸ QVAC translator=${translatorName(from, to)} device=cpu`);
      return id;
    })().then((id) => {
      st.translators[key] = id;
      delete st.translatorLoading[key];
      return id;
    }).catch((err) => {
      st.translatorFailed[key] = true;
      delete st.translatorLoading[key];
      console.warn(`▸ QVAC translator ${key} load failed:`, err instanceof Error ? err.message : err);
      throw err;
    });
  }
  return st.translatorLoading[key].catch(() => null);
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
  const id = await ensureTranslator(from, to, onProgress);
  if (!id) return null;
  const prev = st.translatorTail;
  let release!: () => void;
  st.translatorTail = new Promise<void>((r) => { release = r; });
  await prev;
  st.translatorInflight += 1;
  try {
    return await fn(id);
  } catch (err) {
    console.warn(`▸ QVAC translate ${from}->${to} failed:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    st.translatorInflight = Math.max(0, st.translatorInflight - 1);
    release();
  }
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
  onProgress?.(45);
  return withTranslatorQueue(from, to, async (id) => {
    const result = await runTranslate(id, texts, timeoutMs);
    const translations = (result.translations ?? []).map((item) => (item ?? "").trim());
    if (translations.length !== texts.length || translations.some((item) => !item)) {
      throw new Error("translate_batch_mismatch");
    }
    const ms = Date.now() - t0;
    st.lastTranslateMs = ms;
    st.lastTranslateStats = result.stats;
    onProgress?.(90);
    return { translations, stats: result.stats, ms };
  }, onProgress);
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

type CompletionFinal = { contentText: string; stats?: unknown };
type CompletionRun = {
  events?: AsyncIterable<{ type?: unknown; text?: unknown; stats?: unknown }>;
  tokenStream?: AsyncIterable<string>;
  final: Promise<CompletionFinal>;
};

async function runStructuredCompletion(
  id: string,
  system: string,
  user: string,
  schema: object,
  timeoutMs: number,
  onProgress: ((snap: InferSnapshot) => void) | undefined,
  t0: number,
): Promise<{ final: CompletionFinal; snap: InferSnapshot }> {
  const run = completion({
    modelId: id,
    history: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    stream: true,
    responseFormat: { type: "json_schema", json_schema: { name: "observation", schema: schema as Record<string, unknown> } },
  }) as CompletionRun;

  let snap = emptyInferSnapshot("decoding");
  const emit = (next: InferSnapshot) => {
    snap = { ...next, inferMs: Date.now() - t0 };
    st.lastInferStats = snap;
    onProgress?.(snap);
  };
  emit(snap);

  const work = (async () => {
    if (run.events) {
      for await (const event of run.events) {
        emit(applyCompletionEvent(snap, event, Date.now(), t0));
      }
    } else if (run.tokenStream) {
      for await (const text of run.tokenStream) {
        emit(applyCompletionEvent(snap, { type: "contentDelta", text }, Date.now(), t0));
      }
    }
    return await run.final;
  })();

  try {
    const final = await withTimeout(work, timeoutMs, "infer_timeout");
    return { final, snap };
  } catch (err) {
    // ponytail: race no cancela el worker. Esperar el final nativo antes de la siguiente inferencia.
    await run.final.catch(() => {});
    throw err;
  }
}

export async function inferJson(
  system: string,
  user: string,
  schema: object,
  timeoutMs = 45000,
  onProgress?: (snap: InferSnapshot) => void,
): Promise<{ text: string; inferMs: number; stats: InferSnapshot }> {
  const prev = st.tail;
  let release!: () => void;
  st.tail = new Promise<void>((r) => { release = r; });
  await prev;
  st.inflight += 1;

  const t0 = Date.now();
  try {
    let id = await ensureModel();
    let result: { final: CompletionFinal; snap: InferSnapshot };
    try {
      result = await runStructuredCompletion(id, system, user, schema, timeoutMs, onProgress, t0);
    } catch (error) {
      if (st.device !== "gpu" || !isMissingModelError(error)) throw error;
      st.gpuFailed = true;
      st.modelId = null;
      st.loading = null;
      st.device = null;
      id = await ensureModel();
      result = await runStructuredCompletion(id, system, user, schema, timeoutMs, onProgress, t0);
    }
    st.lastInferMs = Date.now() - t0;
    const stats = mergeSdkStats({ ...result.snap, phase: "done" }, result.final.stats, st.lastInferMs);
    st.lastInferStats = stats;
    onProgress?.(stats);
    const tps = stats.tokensPerSecond != null ? stats.tokensPerSecond.toFixed(1) : "?";
    console.log(
      `▸ QVAC infer ${st.lastInferMs}ms TTFT=${stats.ttftMs ?? "?"}ms tok=${stats.tokens ?? "?"} ${tps} tok/s`,
    );
    return { text: result.final.contentText, inferMs: st.lastInferMs, stats };
  } finally {
    st.inflight = Math.max(0, st.inflight - 1);
    release();
  }
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
