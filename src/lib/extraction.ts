import { EXTRACTION_SCHEMA, normalizeDraft, nextQuestion, groundDraft, toEnglishObservation, type ObservationDraft } from "../../shared/observation";
import { inferJson, translateNote } from "./qvac";

const SYSTEM =
  "Extract inventory. JSON only. No invent. Absent field = null. Keep original names. " +
  "modality: MRI | CT | ultrasound | X-ray | mammograph | other. evidence: short quote. " +
  "client = named hospital/clinic from input. clinic of city only = null. NEVER invent client names or copy examples. " +
  'in: I saw CT at Saint Jude  out: {"client":"Saint Jude","city":null,"country":null,"equipment":[{"modality":"CT","quantity":1,"brand":null,"model":null,"ageYears":null,"evidence":"I saw CT"}],"missing":["city","country","brand","model","ageYears"]} ' +
  "/no_think";

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
): Promise<{ draft: ObservationDraft; question: string | null; inferMs: number; english: string; translateVia: TranslateVia }> {
  let lastError: unknown = null;
  const { english, via } = await resolveObservationEnglish(text, lang);
  // Blindar contra original + inglés: nombres propios vienen de L, cantidades/edad del NMT.
  const sourceForGrounding = lang === "es" ? text : (english === text ? text : `${text}\n${english}`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text: raw, inferMs } = await inferJson(SYSTEM, english, EXTRACTION_SCHEMA);
      const draft = groundDraft(normalizeDraft(JSON.parse(raw.trim())), sourceForGrounding, english);
      draft.missing = computeMissing(draft);
      return { draft, question: nextQuestion(draft, lang), inferMs, english, translateVia: via };
    } catch (err) {
      lastError = err;
      if (err instanceof Error) console.warn(`extract attempt ${attempt + 1} failed: ${err.message}`);
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
