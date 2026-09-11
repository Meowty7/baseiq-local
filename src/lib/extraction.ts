import { EXTRACTION_SCHEMA, normalizeDraft, nextQuestion, groundDraft, toEnglishObservation, type ObservationDraft } from "../../shared/observation";
import { inferJson, inferJsonWithImage, translateNote, type InferSnapshot } from "./qvac";
import { emptyInferSnapshot } from "./infer-metrics";

const SYSTEM =
  "Extract inventory. JSON only. No invent. Absent field = null. Keep original names. " +
  "modality: MRI | CT | ultrasound | X-ray | mammograph | other. evidence: short quote. " +
  "client = named hospital/clinic from input. clinic of city only = null. NEVER invent client names or copy examples. " +
  'in: I saw CT at Saint Jude  out: {"client":"Saint Jude","city":null,"country":null,"equipment":[{"modality":"CT","quantity":1,"brand":null,"model":null,"ageYears":null,"evidence":"I saw CT"}],"missing":["city","country","brand","model","ageYears"]} ' +
  "/no_think";

const SYSTEM_VISION =
  "Extract inventory from the photo. JSON only. Only what is visible on the equipment nameplate or room. " +
  "Absent field = null. modality: MRI | CT | ultrasound | X-ray | mammograph | other. " +
  "evidence: short quote of text visible on the nameplate. brand/model: only if printed on the plate. " +
  "client: hospital name only if visible on a sign. quantity: count units in the photo. /no_think";

export type TranslateVia = "nmt" | "regex";

export function pickObservationEnglish(source: string, nmt: string | null | undefined, lang = "es"): { english: string; via: TranslateVia } {
  if (lang === "en") return { english: source.slice(0, 800), via: "nmt" };
  const trimmed = (nmt ?? "").trim();
  if (trimmed) return { english: trimmed.slice(0, 800), via: "nmt" };
  if (lang === "es") return { english: toEnglishObservation(source).slice(0, 800), via: "regex" };
  return { english: source.slice(0, 800), via: "regex" };
}

export async function resolveObservationEnglish(text: string, lang = "es"): Promise<{ english: string; via: TranslateVia }> {
  if (lang === "en") return pickObservationEnglish(text, text, lang);
  try {
    const nmt = await translateNote(lang, text);
    return pickObservationEnglish(text, nmt, lang);
  } catch {
    return pickObservationEnglish(text, null, lang);
  }
}

function retryableInferError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message === "infer_timeout" || err.message === "model_busy" || err.message === "load_timeout") return false;
  return err instanceof SyntaxError;
}

export async function extractObservation(
  text: string,
  lang = "es",
  onProgress?: (snap: InferSnapshot) => void,
): Promise<{ draft: ObservationDraft; question: string | null; inferMs: number; stats: InferSnapshot; english: string; translateVia: TranslateVia }> {
  let lastError: unknown = null;
  if (lang !== "en") onProgress?.(emptyInferSnapshot("translating"));
  const { english, via } = await resolveObservationEnglish(text, lang);
  // Blindar contra original + inglés: nombres propios vienen de L, cantidades/edad del NMT.
  const sourceForGrounding = lang === "es" ? text : (english === text ? text : `${text}\n${english}`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      onProgress?.(emptyInferSnapshot("decoding"));
      const { text: raw, inferMs, stats } = await inferJson(SYSTEM, english, EXTRACTION_SCHEMA, 45000, onProgress);
      const draft = groundDraft(normalizeDraft(JSON.parse(raw.trim())), sourceForGrounding, english);
      draft.missing = computeMissing(draft);
      return { draft, question: nextQuestion(draft, lang), inferMs, stats, english, translateVia: via };
    } catch (err) {
      lastError = err;
      if (err instanceof Error) console.warn(`extract attempt ${attempt + 1} failed: ${err.message}`);
      if (!retryableInferError(err)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("infer_failed");
}

export async function extractObservationFromImage(
  uri: string,
  lang = "es",
  onProgress?: (snap: InferSnapshot) => void,
): Promise<{ draft: ObservationDraft; question: string | null; inferMs: number; stats: InferSnapshot }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      onProgress?.(emptyInferSnapshot("decoding"));
      const { text: raw, inferMs, stats } = await inferJsonWithImage(SYSTEM_VISION, "Extract the inventory from this photo.", uri, EXTRACTION_SCHEMA, 60000, onProgress);
      const draft = normalizeDraft(JSON.parse(raw.trim()));
      // For images there is no source text to ground against. The VLM counted units
      // and read the nameplate directly, so keep its quantity/modality/age/client/geo.
      // Only brand/model get validated against the VLM's own evidence quotes: a brand
      // not printed on the plate it read is almost certainly a hallucination.
      const evidenceLow = draft.equipment.map((e) => e.evidence ?? "").join(" ").toLowerCase();
      for (const eq of draft.equipment) {
        if (eq.brand && !evidenceLow.includes(eq.brand.toLowerCase())) eq.brand = null;
        if (eq.model && !evidenceLow.includes(eq.model.toLowerCase())) eq.model = null;
      }
      draft.missing = computeMissing(draft);
      return { draft, question: nextQuestion(draft, lang), inferMs, stats };
    } catch (err) {
      lastError = err;
      if (err instanceof Error) console.warn(`extract image attempt ${attempt + 1} failed: ${err.message}`);
      if (!retryableInferError(err)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("infer_failed");
}

function computeMissing(draft: ObservationDraft): string[] {
  const missing = new Set<string>();
  if (!draft.client) missing.add("client");
  if (!draft.city) missing.add("city");
  if (!draft.country) missing.add("country");
  for (const e of draft.equipment) {
    if (!e.modality) missing.add("modality");
    if (e.quantity === null) missing.add("quantity");
  }
  return [...missing];
}
