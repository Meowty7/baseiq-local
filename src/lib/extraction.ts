import { EXTRACTION_SCHEMA, normalizeDraft, nextQuestion, groundDraft, toEnglishObservation, type ObservationDraft } from "../../shared/observation";
import { inferJson } from "./qvac";

const SYSTEM =
  "Extract inventory. JSON only. No invent. Absent field = null. Keep original names. " +
  "modality: MRI | CT | ultrasound | X-ray | mammograph | other. evidence: short quote. " +
  "client = named hospital/clinic from input. clinic of city only = null. NEVER invent client names or copy examples. " +
  'in: I saw CT at Saint Jude  out: {"client":"Saint Jude","city":null,"country":null,"equipment":[{"modality":"CT","quantity":1,"brand":null,"model":null,"ageYears":null,"evidence":"I saw CT"}],"missing":["city","country","brand","model","ageYears"]} ' +
  "/no_think";

export async function extractObservation(text: string): Promise<{ draft: ObservationDraft; question: string | null; inferMs: number }> {
  let lastError: unknown = null;
  const english = toEnglishObservation(text).slice(0, 2000);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text: raw, inferMs } = await inferJson(SYSTEM, english, EXTRACTION_SCHEMA);
      const draft = groundDraft(normalizeDraft(JSON.parse(raw.trim())), text, english);
      draft.missing = computeMissing(draft);
      return { draft, question: nextQuestion(draft), inferMs };
    } catch (err) {
      lastError = err;
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
