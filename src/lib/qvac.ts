import {
  loadModel, completion, unloadModel,
  QWEN3_600M_INST_Q4, LLAMA_3_2_1B_INST_Q4_0, HEALTHCARE_1_7B_MEDICAL_IQ3_XXS,
  QWEN3_1_7B_INST_Q4, SMOLLM2_360M_INST_Q8, SALAMANDRATA_2B_INST_Q4,
  LLAMA_TOOL_CALLING_1B_INST_Q4_K, QWEN3_5_0_8B_MULTIMODAL_Q4_K_M,
  HEALTHCARE_4B_MEDICAL_IQ3_XXS,
} from "@qvac/sdk";

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

function pick(key?: string) {
  const fallback = defaultModelKey();
  return MODELS[(key ?? process.env.QVAC_MODEL ?? fallback).toLowerCase() as ModelKey] ?? MODELS[fallback];
}

let selected = pick();
export let MODEL_SRC = selected.src;
export let MODEL_NAME = selected.name;

export type InferDevice = "gpu" | "cpu";

// ponytail: Fast Refresh (bun run start) reinicia este módulo y modelId queda null,
// pero en Android el worker GPU sigue vivo (QVAC-19304). Recargar el modelo encima
// satura Adreno/Mali y la inferencia deja de terminar. El singleton sobrevive al HMR.
const g = globalThis as typeof globalThis & {
  __baseiqQvac?: {
    modelId: string | null;
    loading: Promise<string> | null;
    lastInferMs: number | null;
    device: InferDevice | null;
    gpuFailed: boolean;
    deviceOverride: InferDevice | null;
    tail: Promise<void>;
    inflight: number;
  };
};
const st = g.__baseiqQvac ?? (g.__baseiqQvac = {
  modelId: null,
  loading: null,
  lastInferMs: null,
  device: null,
  gpuFailed: false,
  deviceOverride: null,
  tail: Promise.resolve(),
  inflight: 0,
});

export async function switchModel(key: string): Promise<void> {
  await shutdown();
  st.gpuFailed = false;
  selected = pick(key);
  MODEL_SRC = selected.src;
  MODEL_NAME = selected.name;
}

export function setDeviceOverride(d: InferDevice | null): void {
  st.deviceOverride = d;
}

export function isReady(): boolean { return st.modelId !== null; }
export function isBusy(): boolean { return st.inflight > 0 || st.loading !== null; }
export function getLastInferMs(): number | null { return st.lastInferMs; }
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

export async function inferJson(system: string, user: string, schema: object, timeoutMs = 45000): Promise<{ text: string; inferMs: number }> {
  const prev = st.tail;
  let release!: () => void;
  st.tail = new Promise<void>((r) => { release = r; });
  await prev;
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
        // ponytail: race no cancela el worker. Esperar el final nativo antes de la siguiente inferencia.
        await run.final.catch(() => {});
        throw err;
      }
    };

    let id = await ensureModel();
    let final;
    try {
      final = await complete(id);
    } catch (error) {
      if (st.device !== "gpu" || !isMissingModelError(error)) throw error;
      st.gpuFailed = true;
      st.modelId = null;
      st.loading = null;
      st.device = null;
      id = await ensureModel();
      final = await complete(id);
    }
    st.lastInferMs = Date.now() - t0;
    return { text: final.contentText, inferMs: st.lastInferMs };
  } finally {
    st.inflight = Math.max(0, st.inflight - 1);
    release();
  }
}

export async function shutdown(): Promise<void> {
  if (!st.modelId) return;
  if (isAndroid()) return;
  await unloadModel({ modelId: st.modelId }).catch(() => {});
  st.modelId = null;
  st.device = null;
}
