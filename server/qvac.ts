import { existsSync } from "node:fs";
import {
  loadModel, completion, unloadModel, getSystemResources,
  QWEN3_600M_INST_Q4, LLAMA_3_2_1B_INST_Q4_0,
} from "@qvac/sdk";

export const MODEL_SRC = process.env.QVAC_MODEL === "llama" ? LLAMA_3_2_1B_INST_Q4_0 : QWEN3_600M_INST_Q4;
export const MODEL_NAME = process.env.QVAC_MODEL === "llama" ? "LLAMA_3_2_1B_INST_Q4_0" : "QWEN3_600M_INST_Q4";

export type InferDevice = "gpu" | "cpu";

let modelId: string | null = null;
let loading: Promise<string> | null = null;
let busy = false;
let lastInferMs: number | null = null;
let device: InferDevice | null = null;

export function isReady(): boolean {
  return modelId !== null;
}

export function isBusy(): boolean {
  return busy;
}

export function getLastInferMs(): number | null {
  return lastInferMs;
}

export function getDevice(): InferDevice | null {
  return device;
}

export function pickDevice(env: string | undefined, hasGpu: boolean): InferDevice {
  const v = env?.toLowerCase();
  if (v === "cpu" || v === "gpu") return v;
  return hasGpu ? "gpu" : "cpu";
}

function hostHasGpu(): boolean {
  if (process.platform === "darwin") return true;
  if (process.platform === "win32") return Boolean(process.env.CUDA_PATH);
  return existsSync("/dev/nvidia0") || existsSync("/dev/dri/renderD128");
}

async function probeHasGpu(): Promise<boolean> {
  try {
    const res = await getSystemResources();
    const gpus = res.capabilities?.gpus;
    if (gpus && gpus.status === "supported" && Array.isArray(gpus.value)) return gpus.value.length > 0;
  } catch {
    // SDK aún no tiene worker; el probe de host basta.
  }
  return hostHasGpu();
}

function modelConfig(d: InferDevice) {
  return d === "gpu" ? { device: "gpu", gpu_layers: 99 } : { device: "cpu", gpu_layers: 0 };
}

async function loadOn(d: InferDevice, onProgress?: (pct: number) => void): Promise<string> {
  return loadModel({
    modelSrc: MODEL_SRC,
    modelConfig: modelConfig(d),
    onProgress: (p) => onProgress?.(p.percentage),
  });
}

export function ensureModel(onProgress?: (pct: number) => void): Promise<string> {
  if (modelId) return Promise.resolve(modelId);
  if (!loading) {
    loading = (async () => {
      const preferred = pickDevice(process.env.QVAC_DEVICE, await probeHasGpu());
      try {
        const id = await loadOn(preferred, onProgress);
        device = preferred;
        console.log(`▸ QVAC device=${preferred}`);
        return id;
      } catch (err) {
        if (preferred === "cpu") throw err;
        console.warn("▸ GPU load failed, falling back to CPU:", err instanceof Error ? err.message : err);
        const id = await loadOn("cpu", onProgress);
        device = "cpu";
        console.log("▸ QVAC device=cpu");
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
  const id = await ensureModel();
  busy = true;
  const t0 = Date.now();
  try {
    const run = completion({
      modelId: id,
      history: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
      responseFormat: { type: "json_schema", json_schema: { name: "observation", schema } },
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("infer_timeout")), timeoutMs));
    const final = await Promise.race([run.final, timeout]);
    lastInferMs = Date.now() - t0;
    return { text: final.contentText, inferMs: lastInferMs };
  } finally {
    busy = false;
  }
}

export async function shutdown(): Promise<void> {
  if (modelId) {
    await unloadModel({ modelId }).catch(() => {});
    modelId = null;
    device = null;
  }
}
