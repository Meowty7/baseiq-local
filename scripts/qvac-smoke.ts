import { MODEL_NAME, TRANSLATOR_NAME, shutdown, ensureTranslator, translateEsEn } from "../src/lib/qvac";
import { extractObservation } from "../src/lib/extraction";

const SAMPLE =
  "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo. Uno de los resonadores parece de unos ocho años.";

try {
  const translatorId = await ensureTranslator();
  if (!translatorId) throw new Error("translator_unavailable");
  const translated = await translateEsEn(SAMPLE);
  if (!translated) throw new Error("translate_empty");
  console.log(`translator=${TRANSLATOR_NAME}`);
  console.log(`en=${translated}`);
  const low = translated.toLowerCase();
  const transFails: string[] = [];
  if (!/\bmri\b/.test(low) && !/magnetic\s+resonance/.test(low)) transFails.push("falta MRI");
  if (!/\bct\b/.test(low) && !/tomograph/.test(low)) transFails.push("falta CT");
  if (transFails.length) {
    console.log(`TRANSLATE FAIL: ${transFails.join("; ")}`);
    await shutdown();
    process.exit(1);
  }
  console.log("TRANSLATE PASS");

  const { draft, question, inferMs, translateVia } = await extractObservation(SAMPLE);
  console.log(`model=${MODEL_NAME} inferMs=${inferMs} via=${translateVia}`);
  console.log(JSON.stringify(draft, null, 2));
  console.log(`question=${question}`);

  const failures: string[] = [];
  if (draft.client === null) failures.push("client null");
  const modalities = draft.equipment.map((e) => e.modality);
  if (!modalities.includes("resonador")) failures.push("falta resonador");
  if (!modalities.includes("tomografo")) failures.push("falta tomografo");
  for (const e of draft.equipment) {
    if (e.brand !== null) failures.push(`marca inventada: ${e.brand}`);
    if (e.model !== null) failures.push(`modelo inventado: ${e.model}`);
  }
  if (failures.length === 0) console.log("SMOKE PASS");
  else console.log(`SMOKE FAIL: ${failures.join("; ")}`);
  await shutdown();
  process.exit(failures.length === 0 ? 0 : 1);
} catch (error) {
  console.error("✖", error);
  await shutdown();
  process.exit(1);
}
