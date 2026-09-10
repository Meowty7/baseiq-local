import { loadModel, completion, unloadModel, QWEN3_600M_INST_Q4, LLAMA_3_2_1B_INST_Q4_0 } from "@qvac/sdk";

export const MODEL_SRC = process.env.QVAC_MODEL === "llama" ? LLAMA_3_2_1B_INST_Q4_0 : QWEN3_600M_INST_Q4;
export const MODEL_NAME = process.env.QVAC_MODEL === "llama" ? "LLAMA_3_2_1B_INST_Q4_0" : "QWEN3_600M_INST_Q4";

let modelId: string | null = null;
let loading: Promise<string> | null = null;
let busy = false;
let lastInferMs: number | null = null;

export function isReady(): boolean {
  return modelId !== null;
}

export function isBusy(): boolean {
  return busy;
}

export function getLastInferMs(): number | null {
  return lastInferMs;
}

export function ensureModel(onProgress?: (pct: number) => void): Promise<string> {
  if (modelId) return Promise.resolve(modelId);
  if (!loading) {
    loading = loadModel({
      modelSrc: MODEL_SRC,
      onProgress: (p) => onProgress?.(p.percentage),
    }).then((id) => {
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
  }
}
