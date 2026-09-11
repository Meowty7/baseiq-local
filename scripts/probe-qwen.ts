import { shutdown, ensureModel, MODEL_NAME } from "../src/lib/qvac";
import { extractObservation } from "../src/lib/extraction";
import { groundDraft, normalizeDraft, type ObservationDraft } from "../shared/observation";
import official from "../fixtures/observations.es.json";
import probes from "../fixtures/probe.es.json";

type Expect = {
  client: string | null;
  city: string | null;
  country: string | null;
  modalities: string[];
  quantities: Record<string, number | null>;
};
type Case = { id: string; kind: string; text: string; expect: Expect };

const HOSTILE = {
  client: "Saint Jude", city: "Atlantis", country: "Narnia",
  equipment: [{ modality: "CT", quantity: 1, brand: "Eliptica", model: "E080", ageYears: 3, evidence: "I saw CT" }],
  missing: [],
};

const norm = (s: string | null) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const geoOk = (got: string | null, want: string | null) =>
  want === null ? got === null : norm(got).startsWith(norm(want));

function score(fx: Case, draft: ObservationDraft): string[] {
  const miss: string[] = [];
  if (!geoOk(draft.client, fx.expect.client)) miss.push(`client got=${draft.client} want=${fx.expect.client}`);
  if (!geoOk(draft.city, fx.expect.city)) miss.push(`city got=${draft.city} want=${fx.expect.city}`);
  if (!geoOk(draft.country, fx.expect.country)) miss.push(`country got=${draft.country} want=${fx.expect.country}`);
  const got = new Set(draft.equipment.map((e) => e.modality));
  if (!fx.expect.modalities.every((m) => got.has(m))) miss.push(`mod got=${[...got]} want=${fx.expect.modalities}`);
  for (const [mod, wantQty] of Object.entries(fx.expect.quantities)) {
    const eq = draft.equipment.find((e) => e.modality === mod);
    if ((eq?.quantity ?? null) !== wantQty) miss.push(`qty ${mod} got=${eq?.quantity} want=${wantQty}`);
  }
  const low = fx.text.toLowerCase();
  for (const e of draft.equipment) {
    if (e.brand && !low.includes(e.brand.toLowerCase())) miss.push(`halluc brand=${e.brand}`);
    if (e.model && !low.includes(e.model.toLowerCase())) miss.push(`halluc model=${e.model}`);
  }
  return miss;
}

const officialCases: Case[] = (official as { text: string; expect: Expect }[]).map((fx, i) => ({
  id: `official-${i + 1}`, kind: "correct", text: fx.text, expect: fx.expect,
}));
const probeCases = probes as Case[];
const all = [...officialCases, ...probeCases];

console.log("▸ grounding vs borrador hostil — literales del texto, no listado de lugares\n");
let gPass = 0;
for (const fx of all) {
  const draft = groundDraft(normalizeDraft(HOSTILE), fx.text);
  const miss: string[] = [];
  if (draft.city === "Atlantis" || draft.country === "Narnia") miss.push("geo inventada");
  if (norm(draft.client).includes("saint jude") && !norm(fx.text).includes("saint jude")) miss.push("client leak");
  if (norm(draft.client).includes("orilla") && !norm(fx.text).includes("orilla")) miss.push("few-shot leak");
  for (const e of draft.equipment) {
    if (e.brand && !fx.text.toLowerCase().includes(e.brand.toLowerCase())) miss.push(`halluc brand=${e.brand}`);
    if (e.model && !fx.text.toLowerCase().includes(e.model.toLowerCase())) miss.push(`halluc model=${e.model}`);
  }
  if (miss.length === 0) {
    gPass++;
    console.log(`  PASS  ${fx.kind.padEnd(9)} ${fx.id} city=${draft.city} country=${draft.country}`);
  } else {
    console.log(`  FAIL  ${fx.kind.padEnd(9)} ${fx.id} :: ${miss.join("; ")}`);
  }
}
console.log(`\nground-safe ${gPass}/${all.length}`);

if (!process.argv.includes("--live")) {
  process.exit(gPass === all.length ? 0 : 1);
}

console.log(`\n▸ live Qwen (${MODEL_NAME})\n`);
await ensureModel();
let livePass = 0;
const lat: number[] = [];
for (const fx of all) {
  const t0 = Date.now();
  try {
    const { draft, inferMs } = await extractObservation(fx.text);
    lat.push(Date.now() - t0);
    const miss = score(fx, draft);
    if (miss.length === 0) {
      livePass++;
      console.log(`  PASS  ${fx.kind.padEnd(9)} ${fx.id} ${inferMs}ms`);
    } else {
      console.log(`  FAIL  ${fx.kind.padEnd(9)} ${fx.id} ${inferMs}ms :: ${miss.join("; ")}`);
      console.log(`        draft=${JSON.stringify({ client: draft.client, city: draft.city, country: draft.country, eq: draft.equipment.map((e) => ({ m: e.modality, q: e.quantity, b: e.brand })) })}`);
    }
  } catch (err) {
    lat.push(Date.now() - t0);
    console.log(`  FAIL  ${fx.kind.padEnd(9)} ${fx.id} :: ${err instanceof Error ? err.message : err}`);
  }
}
lat.sort((a, b) => a - b);
const mean = Math.round(lat.reduce((s, t) => s + t, 0) / lat.length);
console.log(`\nlive ${livePass}/${all.length} mean=${mean}ms p95=${lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))]}ms`);
await shutdown();
process.exit(livePass === all.length ? 0 : 1);
