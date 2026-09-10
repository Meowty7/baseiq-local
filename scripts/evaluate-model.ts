import { loadModel, completion, unloadModel } from "@qvac/sdk";
import { MODEL_SRC, MODEL_NAME } from "../server/qvac";
import { EXTRACTION_SCHEMA, normalizeDraft, groundDraft } from "../shared/observation";
import fixtures from "../fixtures/observations.es.json";

const SYSTEM =
  "Extraes inventario hospitalario de observaciones de campo en español. Respondes SOLO con el JSON del esquema. " +
  "REGLA CRÍTICA: si el texto no menciona un dato, su valor es null. Inventar una marca, modelo o edad que no aparece en el texto es un error grave. " +
  "modality usa exactamente una de: resonador, tomografo, ecografo, rayos-x, mamografo, otra. /no_think";

const modelId = await loadModel({ modelSrc: MODEL_SRC });
console.log(`model: ${MODEL_NAME}`);
let valid = 0;
let clientHit = 0;
let modalityHit = 0;
let hallucinations = 0;
const latencies: number[] = [];

for (const fx of fixtures as { text: string; expect: { client: string | null; modalities: string[] } }[]) {
  const t0 = Date.now();
  const run = completion({
    modelId,
    history: [
      { role: "system", content: SYSTEM },
      { role: "user", content: fx.text },
    ],
    stream: false,
    responseFormat: { type: "json_schema", json_schema: { name: "observation", schema: EXTRACTION_SCHEMA } },
  });
  const final = await run.final;
  latencies.push(Date.now() - t0);
  let parsed: unknown;
  try {
    parsed = JSON.parse(final.contentText.trim());
    valid++;
  } catch {
    console.log(`INVALID_JSON: ${fx.text.slice(0, 50)}`);
    continue;
  }
  const draft = groundDraft(normalizeDraft(parsed), fx.text);
  const norm = (s: string | null) => (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const wantClient = norm(fx.expect.client);
  if (fx.expect.client === null ? draft.client === null : (norm(draft.client).startsWith(wantClient) || wantClient.startsWith(norm(draft.client)))) clientHit++;
  else console.log(`CLIENT_MISS: got=${draft.client} want=${fx.expect.client}`);
  const got = new Set(draft.equipment.map((e) => e.modality));
  if (fx.expect.modalities.every((m) => got.has(m))) modalityHit++;
  else console.log(`MODALITY_MISS: got=${[...got]} want=${fx.expect.modalities} :: ${fx.text.slice(0, 60)}`);
  const textLow = fx.text.toLowerCase();
  for (const e of draft.equipment) {
    if (e.brand && !textLow.includes(e.brand.toLowerCase())) {
      hallucinations++;
      console.log(`HALLUCINATION brand=${e.brand} :: ${fx.text.slice(0, 60)}`);
    }
    if (e.model && !textLow.includes(e.model.toLowerCase())) {
      hallucinations++;
      console.log(`HALLUCINATION model=${e.model} :: ${fx.text.slice(0, 60)}`);
    }
  }
}

latencies.sort((a, b) => a - b);
const n = fixtures.length;
console.log(`\nmodel=${MODEL_NAME} n=${n}`);
console.log(`json_valid=${valid}/${n} client_acc=${clientHit}/${n} modality_acc=${modalityHit}/${n} hallucinations=${hallucinations}`);
console.log(`latency p50=${latencies[Math.floor(n / 2)]}ms p95=${latencies[Math.min(n - 1, Math.floor(n * 0.95))]}ms`);
await unloadModel({ modelId });
