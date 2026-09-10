import { shutdown, ensureModel, MODEL_NAME } from "../server/qvac";
import { extractObservation } from "../server/extraction";
import fixtures from "../fixtures/observations.es.json";

await ensureModel();

let valid = 0;
let clientHit = 0;
let cityHit = 0;
let countryHit = 0;
let modalityHit = 0;
let quantityHit = 0;
let hallucinations = 0;
const latencies: number[] = [];

const norm = (s: string | null) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

for (const fx of fixtures as { text: string; expect: { client: string | null; city: string | null; country: string | null; modalities: string[]; quantities: Record<string, number> } }[]) {
  const t0 = Date.now();
  try {
    const { draft, inferMs } = await extractObservation(fx.text);
    latencies.push(Date.now() - t0);
    valid++;
    const wantClient = norm(fx.expect.client);
    if (fx.expect.client === null ? draft.client === null : norm(draft.client).startsWith(wantClient)) clientHit++;
    else console.log(`CLIENT_MISS: got=${draft.client} want=${fx.expect.client} (${inferMs}ms)`);
    if (fx.expect.city === null ? draft.city === null : norm(draft.city).startsWith(norm(fx.expect.city))) cityHit++;
    else console.log(`CITY_MISS: got=${draft.city} want=${fx.expect.city} (${inferMs}ms)`);
    if (fx.expect.country === null ? draft.country === null : norm(draft.country).startsWith(norm(fx.expect.country))) countryHit++;
    else console.log(`COUNTRY_MISS: got=${draft.country} want=${fx.expect.country} (${inferMs}ms)`);
    const got = new Set(draft.equipment.map((e) => e.modality));
    if (fx.expect.modalities.every((m) => got.has(m))) modalityHit++;
    else console.log(`MODALITY_MISS: got=${[...got]} want=${fx.expect.modalities} :: ${fx.text.slice(0, 60)}`);
    for (const [mod, wantQty] of Object.entries(fx.expect.quantities)) {
      const eq = draft.equipment.find((e) => e.modality === mod);
      if (eq?.quantity === wantQty) quantityHit++;
      else console.log(`QUANTITY_MISS: ${mod} got=${eq?.quantity} want=${wantQty} :: ${fx.text.slice(0, 60)}`);
    }
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
  } catch (err) {
    latencies.push(Date.now() - t0);
    console.log(`FAILED: ${fx.text.slice(0, 50)} :: ${err instanceof Error ? err.message : err}`);
  }
}

latencies.sort((a, b) => a - b);
const n = fixtures.length;
const totalQty = (fixtures as { expect: { quantities: Record<string, number> } }[]).reduce((s, fx) => s + Object.keys(fx.expect.quantities).length, 0);
const p95 = latencies[Math.min(n - 1, Math.floor(n * 0.95))];
console.log(`\nmodel=${MODEL_NAME} n=${n}`);
console.log(`valid=${valid}/${n} client=${clientHit}/${n} city=${cityHit}/${n} country=${countryHit}/${n} modality=${modalityHit}/${n} quantity=${quantityHit}/${totalQty} halluc=${hallucinations}`);
console.log(`latency p50=${latencies[Math.floor(n / 2)]}ms p95=${p95}ms`);

const pass = valid === n && clientHit >= 11 && modalityHit >= 11 && hallucinations === 0 && p95 <= 6000;
console.log(pass ? "EVALUATE PASS" : "EVALUATE FAIL");
await shutdown();
process.exit(pass ? 0 : 1);
