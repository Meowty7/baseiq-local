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

export async function switchModel(key: string): Promise<void> {
  await shutdown();
  gpuFailed = false;
  selected = pick(key);
  MODEL_SRC = selected.src;
  MODEL_NAME = selected.name;
}

export type InferDevice = "gpu" | "cpu";

let modelId: string | null = null;
let loading: Promise<string> | null = null;
let busy = false;
let lastInferMs: number | null = null;
let device: InferDevice | null = null;
let gpuFailed = false;
let deviceOverride: InferDevice | null = null;

export function setDeviceOverride(d: InferDevice | null): void {
  deviceOverride = d;
}

export function isReady(): boolean { return modelId !== null; }
export function isBusy(): boolean { return busy; }
export function getLastInferMs(): number | null { return lastInferMs; }
export function getDevice(): InferDevice | null { return device; }

export function isMissingModelError(error: unknown): boolean {
  return error instanceof Error && /Model with ID ".+" not found/i.test(error.message);
}

function nativePlatform(): string | null {
  try {
    // require lazy: react-native es Flow-typed y revienta bajo bun/node (solo existe en Metro).
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
  if (deviceOverride === "cpu" || deviceOverride === "gpu") return deviceOverride;
  const v = process.env.QVAC_DEVICE?.toLowerCase();
  if (v === "cpu" || v === "gpu") return v;
  return gpuFailed ? "cpu" : "gpu";
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

export function ensureModel(onProgress?: (pct: number) => void): Promise<string> {
  if (modelId) return Promise.resolve(modelId);
  if (!loading) {
    loading = (async () => {
      const preferred = preferredDevice();
      try {
        const id = await loadOn(preferred, onProgress);
        device = preferred;
        console.log(`▸ QVAC device=${device} model=${selected.name}`);
        return id;
      } catch (err) {
        if (preferred === "cpu") throw err;
        gpuFailed = true;
        console.warn(`▸ QVAC GPU load failed, falling back to CPU:`, err instanceof Error ? err.message : err);
        const id = await loadOn("cpu", onProgress);
        device = "cpu";
        console.log(`▸ QVAC device=${device} model=${selected.name}`);
        return id;
      }
    })().then((id) => {
      modelId = id;
      loading = null;
      return id;
    }).catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

export async function inferJson(system: string, user: string, schema: object, timeoutMs = 90000): Promise<{ text: string; inferMs: number }> {
  if (busy) throw new Error("model_busy");
  busy = true;
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
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("infer_timeout")), timeoutMs));
      return Promise.race([run.final, timeout]);
    };

    let id = await ensureModel();
    let final;
    try {
      final = await complete(id);
    } catch (error) {
      if (device !== "gpu" || !isMissingModelError(error)) throw error;
      gpuFailed = true;
      modelId = null;
      loading = null;
      device = null;
      id = await ensureModel();
      final = await complete(id);
    }
    lastInferMs = Date.now() - t0;
    return { text: final.contentText, inferMs: lastInferMs };
  } finally {
    busy = false;
  }
}

export async function shutdown(): Promise<void> {
  if (!modelId) return;
  // ponytail: QVAC-19304 — unload/kill of a GPU worker crashes the Android process.
  // Keep the model loaded for the session; process exit is the only teardown.
  if (isAndroid()) return;
  await unloadModel({ modelId }).catch(() => {});
  modelId = null;
  device = null;
}
