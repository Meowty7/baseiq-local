import { shutdown, ensureModel, switchModel, MODEL_NAME } from "../src/lib/qvac";
import { extractObservation } from "../src/lib/extraction";
import type { ObservationDraft } from "../shared/observation";
import fixtures from "../fixtures/observations.es.json";

type Fx = { text: string; expect: { client: string | null; city: string | null; country: string | null; modalities: string[]; quantities: Record<string, number> } };
const FIXTURES = fixtures as Fx[];
const KEYS = (process.env.QVAC_MODELS ?? "smol,qwen,qwen35,llama,toolcall,qwen17,salamandra").split(",").map((s) => s.trim()).filter(Boolean);

const norm = (s: string | null) => (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

type Case = { ok: boolean; draft: ObservationDraft | null; ms: number; client: boolean; city: boolean; country: boolean; modality: boolean; qty: number; qtyWant: number; halluc: number };

function score(fx: Fx, draft: ObservationDraft | null, ms: number, ok: boolean): Case {
  const empty: ObservationDraft = { client: null, city: null, country: null, equipment: [], missing: [] };
  const d = draft ?? empty;
  let client = fx.expect.client === null ? d.client === null : norm(d.client).startsWith(norm(fx.expect.client));
  let city = fx.expect.city === null ? d.city === null : norm(d.city).startsWith(norm(fx.expect.city));
  let country = fx.expect.country === null ? d.country === null : norm(d.country).startsWith(norm(fx.expect.country));
  const got = new Set(d.equipment.map((e) => e.modality));
  const modality = fx.expect.modalities.every((m) => got.has(m));
  let qty = 0;
  const qtyWant = Object.keys(fx.expect.quantities).length;
  for (const [mod, want] of Object.entries(fx.expect.quantities)) {
    if (d.equipment.find((e) => e.modality === mod)?.quantity === want) qty++;
  }
  let halluc = 0;
  const textLow = fx.text.toLowerCase();
  for (const e of d.equipment) {
    if (e.brand && !textLow.includes(e.brand.toLowerCase())) halluc++;
    if (e.model && !textLow.includes(e.model.toLowerCase())) halluc++;
  }
  return { ok, draft, ms, client, city, country, modality, qty, qtyWant, halluc };
}

function summarize(key: string, name: string, cases: Case[]) {
  const n = cases.length;
  const lat = cases.map((c) => c.ms).sort((a, b) => a - b);
  const valid = cases.filter((c) => c.ok).length;
  const client = cases.filter((c) => c.client).length;
  const city = cases.filter((c) => c.city).length;
  const country = cases.filter((c) => c.country).length;
  const modality = cases.filter((c) => c.modality).length;
  const qty = cases.reduce((s, c) => s + c.qty, 0);
  const qtyWant = cases.reduce((s, c) => s + c.qtyWant, 0);
  const halluc = cases.reduce((s, c) => s + c.halluc, 0);
  const p50 = lat[Math.floor(n / 2)] ?? 0;
  const p95 = lat[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0;
  const pass = valid === n && client >= 11 && modality >= 11 && halluc === 0 && p95 <= 6000;
  const quality = client + city + country + modality + qty - halluc;
  return { key, name, valid, n, client, city, country, modality, qty, qtyWant, halluc, p50, p95, pass, quality, cases };
}

async function runOne(key: string) {
  await switchModel(key);
  console.log(`\n▸ load ${key} (${MODEL_NAME})`);
  await ensureModel();
  try { await extractObservation(FIXTURES[0].text); } catch { /* warmup */ }
  const cases: Case[] = [];
  for (const fx of FIXTURES) {
    const t0 = Date.now();
    try {
      const { draft, inferMs } = await extractObservation(fx.text);
      const row = score(fx, draft, inferMs, true);
      cases.push(row);
      const miss = ["client", "city", "country", "modality"].filter((k) => !row[k as "client"]);
      if (miss.length) console.log(`  MISS ${miss.join(",")} :: ${fx.text.slice(0, 50)}`);
    } catch (err) {
      cases.push(score(fx, null, Date.now() - t0, false));
      console.log(`  FAIL ${fx.text.slice(0, 50)} :: ${err instanceof Error ? err.message : err}`);
    }
  }
  await shutdown();
  return summarize(key, MODEL_NAME, cases);
}

function fillNull(a: ObservationDraft, b: ObservationDraft): ObservationDraft {
  const aMods = new Set(a.equipment.map((e) => e.modality));
  const bMods = new Set(b.equipment.map((e) => e.modality));
  return {
    client: a.client ?? b.client,
    city: a.city ?? b.city,
    country: a.country ?? b.country,
    equipment: bMods.size > aMods.size ? b.equipment : a.equipment,
    missing: [],
  };
}

function combo(a: ReturnType<typeof summarize>, b: ReturnType<typeof summarize>, label: string) {
  const cases = a.cases.map((ca, i) => {
    const cb = b.cases[i];
    const fx = FIXTURES[i];
    if (!ca.ok && !cb.ok) return score(fx, null, ca.ms + cb.ms, false);
    if (!ca.ok) return { ...cb, ms: ca.ms + cb.ms };
    if (!cb.ok) return { ...ca, ms: ca.ms };
    const need = !ca.city || !ca.country || !ca.modality || !ca.client;
    const draft = fillNull(ca.draft!, cb.draft!);
    return { ...score(fx, draft, ca.ms + (need ? cb.ms : 0), true) };
  });
  return summarize(label, `${a.key}+${b.key} fill-null`, cases);
}

const solos: ReturnType<typeof summarize>[] = [];
try {
  for (const key of KEYS) {
    try {
      solos.push(await runOne(key));
    } catch (err) {
      console.log(`▸ SKIP ${key}: ${err instanceof Error ? err.message : err}`);
      await shutdown().catch(() => {});
    }
  }
} finally {
  await shutdown().catch(() => {});
}

const line = (s: ReturnType<typeof summarize>) =>
  `${s.pass ? "PASS" : "FAIL"}  ${s.key.padEnd(22)} client=${s.client}/${s.n} city=${s.city}/${s.n} country=${s.country}/${s.n} mod=${s.modality}/${s.n} qty=${s.qty}/${s.qtyWant} halluc=${s.halluc}  p50=${s.p50}ms p95=${s.p95}ms  q=${s.quality}`;

console.log("\n=== SOLOS ===");
for (const s of solos) console.log(line(s));

console.log("\n=== COMBOS (A, fill nulls from B; latency = A + B-on-miss) ===");
const combos: ReturnType<typeof summarize>[] = [];
for (let i = 0; i < solos.length; i++) {
  for (let j = 0; j < solos.length; j++) {
    if (i === j) continue;
    combos.push(combo(solos[i], solos[j], `${solos[i].key}+${solos[j].key}`));
  }
}
combos.sort((a, b) => b.quality - a.quality || a.p50 - b.p50);
for (const s of combos.slice(0, 12)) console.log(line(s));

const ranked = [...solos].sort((a, b) => b.quality - a.quality || a.p50 - b.p50);
const bestSolo = ranked[0];
const bestCombo = combos[0];
console.log("\n=== PICK ===");
if (bestSolo) console.log(`best solo:  ${line(bestSolo)}`);
if (bestCombo) console.log(`best combo: ${line(bestCombo)}`);
process.exit(0);
