import { expect, test } from "bun:test";
import {
  applyCompletionEvent,
  emptyInferSnapshot,
  formatInferCaption,
  formatMs,
  formatTps,
  liveThroughput,
  mergeSdkStats,
} from "../src/lib/infer-metrics";

test("liveThroughput espera una ventana de decode estable", () => {
  expect(liveThroughput(1, 100, 120)).toBeUndefined();
  expect(liveThroughput(8, 100, 300)).toBeCloseTo(40, 5);
  expect(liveThroughput(0, 100, 400)).toBeUndefined();
});

test("formatMs y formatTps son legibles en video", () => {
  expect(formatMs(180)).toBe("180 ms");
  expect(formatMs(1200)).toBe("1.2 s");
  expect(formatTps(38.21)).toBe("38.2");
  expect(formatTps(142.7)).toBe("143");
});

test("applyCompletionEvent marca TTFT en el primer delta y cuenta tokens", () => {
  const t0 = 1_000;
  let snap = emptyInferSnapshot("decoding");
  snap = applyCompletionEvent(snap, { type: "contentDelta", text: "{" }, t0 + 180, t0);
  expect(snap.ttftMs).toBe(180);
  expect(snap.tokens).toBe(1);
  snap = applyCompletionEvent(snap, { type: "contentDelta", text: "a" }, t0 + 280, t0);
  expect(snap.tokens).toBe(2);
  expect(snap.ttftMs).toBe(180);
  snap = applyCompletionEvent(snap, { type: "contentDelta", text: "" }, t0 + 300, t0);
  expect(snap.tokens).toBe(2);
});

test("applyCompletionEvent fusiona completionStats del SDK", () => {
  const t0 = 0;
  let snap = applyCompletionEvent(emptyInferSnapshot("decoding"), { type: "contentDelta", text: "{" }, 120, t0);
  snap = applyCompletionEvent(snap, {
    type: "completionStats",
    stats: { timeToFirstToken: 110, tokensPerSecond: 44.5, generatedTokens: 40, promptTokens: 300 },
  }, 900, t0);
  expect(snap.ttftMs).toBe(110);
  expect(snap.tokens).toBe(40);
  expect(snap.promptTokens).toBe(300);
  expect(snap.tokensPerSecond).toBe(44.5);
});

test("mergeSdkStats prefiere generatedTokens, TTFT y tok/s del SDK", () => {
  const live = applyCompletionEvent(emptyInferSnapshot("decoding"), { type: "contentDelta", text: "x" }, 200, 0);
  const merged = mergeSdkStats(live, {
    timeToFirstToken: 164,
    tokensPerSecond: 52.4,
    generatedTokens: 61,
    promptTokens: 412,
    emittedTokens: 58,
  }, 980);
  expect(merged.ttftMs).toBe(164);
  expect(merged.tokens).toBe(61);
  expect(merged.promptTokens).toBe(412);
  expect(merged.tokensPerSecond).toBe(52.4);
  expect(merged.inferMs).toBe(980);
});

test("formatInferCaption arma la línea de la demo", () => {
  expect(formatInferCaption({ phase: "done", inferMs: 940, ttftMs: 180, tokens: 52, promptTokens: 390, tokensPerSecond: 58.3 }, "GPU"))
    .toBe("0.9 s · TTFT 180 ms · 52 tok · prompt 390 · 58.3 tok/s · GPU");
  expect(formatInferCaption({ phase: "done", inferMs: 1100 }, "CPU")).toBe("1.1 s · CPU");
});
