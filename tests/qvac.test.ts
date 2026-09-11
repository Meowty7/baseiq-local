import { expect, test } from "bun:test";
import { isMissingModelError, isWorkerInitError, isTranslatorReady, isWhisperReady, isVisionReady, visionModelConfig } from "../src/lib/qvac";
import { pickObservationEnglish } from "../src/lib/extraction";
import { MMPROJ_QWEN3_5_0_8B_MULTIMODAL_Q8_0 } from "@qvac/sdk";

test("detecta reinicio del worker por modelo perdido", () => {
  expect(isMissingModelError(new Error('Model with ID "abc123" not found'))).toBe(true);
  expect(isMissingModelError(new Error("infer_timeout"))).toBe(false);
});

test("no trata un BareKit caído como fallo de GPU", () => {
  expect(isWorkerInitError(new Error("undefined cannot be used as a constructor."))).toBe(true);
  expect(isWorkerInitError(new Error("TurboModuleRegistry.getEnforcing(...): 'BareKit' could not be found"))).toBe(true);
  expect(isWorkerInitError(new Error("load_timeout"))).toBe(false);
});

test("el traductor no está listo hasta loadModel", () => {
  expect(isTranslatorReady()).toBe(false);
  expect(isTranslatorReady("es", "en")).toBe(false);
});

test("whisper y vision no están listos hasta loadModel", () => {
  expect(isWhisperReady()).toBe(false);
  expect(isVisionReady()).toBe(false);
});

test("el VLM carga en CPU+mmap y el mmproj va en modelConfig", () => {
  const cfg = visionModelConfig();
  expect(cfg.projectionModelSrc).toBe(MMPROJ_QWEN3_5_0_8B_MULTIMODAL_Q8_0);
  expect(cfg.device).toBe("cpu");
  expect(cfg.gpu_layers).toBe(0);
  expect(cfg.load_mode).toBe("mmap");
  expect(cfg.ctx_size).toBe(4096);
  expect(cfg["mmproj-use-gpu"]).toBe(false);
  expect("modelSrc" in cfg).toBe(false);
});

test("pickObservationEnglish usa NMT si hay texto y cae al regex si no", () => {
  const source = "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo.";
  const nmt = pickObservationEnglish(source, "I am at Hospital DemoCare Pacific, in Panama. I saw two MRI scanners and a CT scanner.");
  expect(nmt.via).toBe("nmt");
  expect(nmt.english).toContain("Hospital DemoCare Pacific");
  expect(nmt.english).toMatch(/MRI/);
  const regex = pickObservationEnglish(source, null);
  expect(regex.via).toBe("regex");
  expect(regex.english).toMatch(/MRI/);
  expect(regex.english).toMatch(/CT/);
  expect(pickObservationEnglish(source, "   ").via).toBe("regex");
});
