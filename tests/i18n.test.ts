import { expect, test } from "bun:test";
import { getQuestion, STRINGS, t } from "../src/i18n";
import { nextQuestion, normalizeDraft } from "../shared/observation";
import { BERGAMOT_PAIRS, isTranslatorReady } from "../src/lib/qvac";
import { pickObservationEnglish } from "../src/lib/extraction";

test("t() usa ES/EN escritos a mano y cae a EN si falta el idioma o la clave", () => {
  expect(t("tab.capture", "es")).toBe("Captura");
  expect(t("tab.capture", "en")).toBe("Capture");
  expect(t("tab.capture", "fr")).toBe("Capture");
  expect(t("no.such.key", "en")).toBe("no.such.key");
  expect(t("records.title", "en", { n: 3 })).toBe("Records (3)");
  expect(t("ai.ready", "es", { device: " · GPU" })).toBe("IA local lista · GPU");
});

test("diccionarios ES y EN tienen las mismas claves", () => {
  const es = Object.keys(STRINGS.es).sort();
  const en = Object.keys(STRINGS.en).sort();
  expect(es).toEqual(en);
});

test("getQuestion cae a EN para un idioma desconocido", () => {
  expect(getQuestion("brand", "es")).toContain("marca");
  expect(getQuestion("brand", "en")).toMatch(/brand/i);
  expect(getQuestion("brand", "xx")).toMatch(/brand/i);
  expect(getQuestion("notAField", "zz")).toMatch(/specify notAField/i);
});

test("nextQuestion usa plantillas i18n; sin lang sigue en ES", () => {
  const incomplete = normalizeDraft({ client: null, city: null, country: null, equipment: [], missing: ["brand"] });
  expect(nextQuestion(incomplete)).toContain("marca");
  expect(nextQuestion(incomplete, "en")).toMatch(/brand/i);
  const complete = normalizeDraft({ client: "H", city: null, country: null, equipment: [], missing: [] });
  expect(nextQuestion(complete, "pt")).toBeNull();
});

test("pickObservationEnglish respeta lang: ES regex, NMT, EN identidad, PT sin léxico", () => {
  const source = "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo.";
  const nmt = pickObservationEnglish(source, "I am at Hospital DemoCare Pacific, in Panama. I saw two MRI scanners and a CT scanner.", "es");
  expect(nmt.via).toBe("nmt");
  expect(nmt.english).toMatch(/MRI/);
  const regex = pickObservationEnglish(source, null, "es");
  expect(regex.via).toBe("regex");
  expect(regex.english).toMatch(/MRI/);
  const en = pickObservationEnglish("I saw two MRI units at Saint Jude.", null, "en");
  expect(en.via).toBe("nmt");
  expect(en.english).toContain("Saint Jude");
  const pt = pickObservationEnglish("Estou no Hospital DemoCare. Vi dois ressonadores.", null, "pt");
  expect(pt.via).toBe("regex");
  expect(pt.english).toContain("ressonadores");
  const ptNmt = pickObservationEnglish("Estou no Hospital DemoCare.", "I am at Hospital DemoCare.", "pt");
  expect(ptNmt.via).toBe("nmt");
  expect(ptNmt.english).toContain("Hospital DemoCare");
});

test("pares Bergamot L↔EN existen para los 17 idiomas con modelo", () => {
  const langs = ["es", "pt", "fr", "de", "it", "nl", "pl", "ro", "cs", "sv", "da", "ru", "tr", "ar", "zh", "ja", "ko"];
  for (const lang of langs) {
    expect(BERGAMOT_PAIRS[`${lang}-en`], `${lang}-en`).toBeTruthy();
    expect(BERGAMOT_PAIRS[`en-${lang}`], `en-${lang}`).toBeTruthy();
  }
  expect(isTranslatorReady()).toBe(false);
});
