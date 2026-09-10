import { EXTRACTION_SCHEMA, normalizeDraft, nextQuestion, groundDraft, type ObservationDraft } from "../shared/observation";
import { inferJson } from "./qvac";

const SYSTEM =
  "You extract hospital inventory from Spanish field observations. Reply ONLY with the schema JSON. " +
  "CRITICAL RULE: if the text does not mention a datum, its value is null. Inventing a brand, model or age absent from the text is a serious error. " +
  "Example: for «Vi un tomógrafo en Hospital X» you must return " +
  '{"client":"Hospital X","city":null,"country":null,"equipment":[{"modality":"tomografo","quantity":1,"brand":null,"model":null,"ageYears":null,"evidence":"Vi un tomógrafo"}],"missing":["city","country","brand","model","ageYears"]}. ' +
  "modality is exactly one of: resonador, tomografo, ecografo, rayos-x, mamografo, otra. " +
  "evidence must be a short literal quote of the original Spanish text. " +
  "missing lists absent fields among client, city, country, modality, quantity, brand, model, ageYears. /no_think";

export async function extractObservation(text: string): Promise<{ draft: ObservationDraft; question: string | null; inferMs: number }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text: raw, inferMs } = await inferJson(SYSTEM, text.slice(0, 2000), EXTRACTION_SCHEMA);
      const draft = groundDraft(normalizeDraft(JSON.parse(raw.trim())), text);
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
    if (!e.brand) missing.add("brand");
    if (!e.model) missing.add("model");
    if (e.ageYears === null) missing.add("ageYears");
  }
  return [...missing];
}
