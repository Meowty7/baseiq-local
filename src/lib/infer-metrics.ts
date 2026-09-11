/** Live / final LLM telemetry for the capture HUD and demo captions. */

export type InferPhase = "waiting" | "translating" | "decoding" | "done";

export type InferSnapshot = {
  phase: InferPhase;
  inferMs: number;
  ttftMs?: number;
  tokens?: number;
  promptTokens?: number;
  tokensPerSecond?: number;
};

export function emptyInferSnapshot(phase: InferPhase = "waiting"): InferSnapshot {
  return { phase, inferMs: 0 };
}

function num(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/** Decode throughput after the first token. Undefined until there is a stable window. */
export function liveThroughput(tokens?: number, ttftMs?: number, inferMs?: number): number | undefined {
  if (tokens == null || tokens <= 0 || inferMs == null || inferMs <= 0) return undefined;
  const decodeMs = ttftMs != null ? Math.max(0, inferMs - ttftMs) : inferMs;
  if (decodeMs < 80) return undefined;
  return (tokens / decodeMs) * 1000;
}

export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
  return `${Math.round(ms)} ms`;
}

export function formatTps(n: number): string {
  return n >= 100 ? n.toFixed(0) : n.toFixed(1);
}

export function dash(value: string | undefined): string {
  return value && value.length > 0 ? value : "—";
}

type SdkStats = {
  timeToFirstToken?: unknown;
  TTFT?: unknown;
  tokensPerSecond?: unknown;
  TPS?: unknown;
  generatedTokens?: unknown;
  emittedTokens?: unknown;
  totalTokens?: unknown;
  promptTokens?: unknown;
};

export function mergeSdkStats(snap: InferSnapshot, raw: unknown, inferMs: number): InferSnapshot {
  const s = (raw ?? {}) as SdkStats;
  const ttft = num(s.timeToFirstToken) ?? num(s.TTFT);
  const tps = num(s.tokensPerSecond) ?? num(s.TPS);
  const generated = num(s.generatedTokens) ?? num(s.emittedTokens) ?? num(s.totalTokens);
  const prompt = num(s.promptTokens);
  return {
    ...snap,
    inferMs,
    ttftMs: ttft ?? snap.ttftMs,
    tokens: generated ?? snap.tokens,
    promptTokens: prompt ?? snap.promptTokens,
    tokensPerSecond: tps ?? snap.tokensPerSecond ?? liveThroughput(generated ?? snap.tokens, ttft ?? snap.ttftMs, inferMs),
  };
}

export function applyCompletionEvent(
  snap: InferSnapshot,
  event: { type?: unknown; text?: unknown; stats?: unknown },
  now: number,
  startedAt: number,
): InferSnapshot {
  const inferMs = Math.max(0, now - startedAt);
  if (event.type === "contentDelta" && typeof event.text === "string" && event.text.length > 0) {
    const tokens = (snap.tokens ?? 0) + 1;
    const ttftMs = snap.ttftMs ?? inferMs;
    return {
      ...snap,
      phase: snap.phase === "waiting" ? "decoding" : snap.phase,
      inferMs,
      tokens,
      ttftMs,
      tokensPerSecond: liveThroughput(tokens, ttftMs, inferMs),
    };
  }
  if (event.type === "completionStats") {
    return mergeSdkStats({ ...snap, phase: snap.phase === "waiting" ? "decoding" : snap.phase, inferMs }, event.stats, inferMs);
  }
  return { ...snap, inferMs };
}

export function formatInferCaption(snap: InferSnapshot, device: string): string {
  const parts = [`${(snap.inferMs / 1000).toFixed(1)} s`];
  if (snap.ttftMs != null) parts.push(`TTFT ${formatMs(snap.ttftMs)}`);
  if (snap.tokens != null) parts.push(`${Math.round(snap.tokens)} tok`);
  if (snap.promptTokens != null) parts.push(`prompt ${Math.round(snap.promptTokens)}`);
  if (snap.tokensPerSecond != null) parts.push(`${formatTps(snap.tokensPerSecond)} tok/s`);
  if (device) parts.push(device);
  return parts.join(" · ");
}
