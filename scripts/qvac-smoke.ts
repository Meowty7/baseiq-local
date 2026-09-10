import { MODEL_NAME, shutdown } from "../src/lib/qvac";
import { extractObservation } from "../src/lib/extraction";

const SAMPLE =
  "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo. Uno de los resonadores parece de unos ocho años.";

try {
  const { draft, question, inferMs } = await extractObservation(SAMPLE);
  console.log(`model=${MODEL_NAME} inferMs=${inferMs}`);
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
