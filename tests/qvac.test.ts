import { expect, test } from "bun:test";
import { isMissingModelError, isTranslatorReady, isWhisperReady, isVisionReady } from "../src/lib/qvac";
import { pickObservationEnglish } from "../src/lib/extraction";

test("detecta reinicio del worker por modelo perdido", () => {
  expect(isMissingModelError(new Error('Model with ID "abc123" not found'))).toBe(true);
  expect(isMissingModelError(new Error("infer_timeout"))).toBe(false);
});

test("el traductor no está listo hasta loadModel", () => {
  expect(isTranslatorReady()).toBe(false);
  expect(isTranslatorReady("es", "en")).toBe(false);
});

test("whisper y vision no están listos hasta loadModel", () => {
  expect(isWhisperReady()).toBe(false);
  expect(isVisionReady()).toBe(false);
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
