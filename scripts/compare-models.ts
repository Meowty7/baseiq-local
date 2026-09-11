import { shutdown, ensureModel, ensureTranslator, switchModel, MODEL_NAME, TRANSLATOR_NAME, translateEsEnBatch, getLastTranslateStats, type TranslateStats } from "../src/lib/qvac";
import { extractObservation, type TranslateVia } from "../src/lib/extraction";
import type { ObservationDraft } from "../shared/observation";
import fixtures from "../fixtures/observations.es.json";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type Fx = { text: string; expect: { client: string | null; city: string | null; country: string | null; modalities: string[]; quantities: Record<string, number> } };
const FIXTURES = fixtures as unknown as Fx[];
const KEYS = (process.env.QVAC_MODELS ?? "smol,qwen,qwen35,llama,toolcall,qwen17,salamandra").split(",").map((s: string) => s.trim()).filter(Boolean);
const REPORT_PATH = resolve(process.env.COMPARE_OUT ?? "data/compare-models.report.json");

const norm = (s: string | null) => (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

type Case = { ok: boolean; draft: ObservationDraft | null; ms: number; client: boolean; city: boolean; country: boolean; modality: boolean; qty: number; qtyWant: number; halluc: number; english?: string };

function score(fx: Fx, draft: ObservationDraft | null, ms: number, ok: boolean, english?: string): Case {
  const empty: ObservationDraft = { client: null, city: null, country: null, equipment: [], missing: [] };
  const d = draft ?? empty;
  const client = fx.expect.client === null ? d.client === null : norm(d.client).startsWith(norm(fx.expect.client));
  const city = fx.expect.city === null ? d.city === null : norm(d.city).startsWith(norm(fx.expect.city));
  const country = fx.expect.country === null ? d.country === null : norm(d.country).startsWith(norm(fx.expect.country));
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
  return { ok, draft, ms, client, city, country, modality, qty, qtyWant, halluc, english };
}

type Summary = {
  key: string;
  name: string;
  via: TranslateVia;
  valid: number;
  n: number;
  client: number;
  city: number;
  country: number;
  modality: number;
  qty: number;
  qtyWant: number;
  halluc: number;
  p50: number;
  p95: number;
  pass: boolean;
  quality: number;
  loadMs: number;
  cases: Case[];
};

function summarize(key: string, name: string, via: TranslateVia, cases: Case[], loadMs: number): Summary {
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
  return { key, name, via, valid, n, client, city, country, modality, qty, qtyWant, halluc, p50, p95, pass, quality, loadMs, cases };
}

async function runLoaded(key: string, via: TranslateVia, nmtEnglish: string[] | null, loadMs: number): Promise<Summary> {
  console.log(`\n▸ ${key}/${via} (${MODEL_NAME})`);
  try {
    await extractObservation(FIXTURES[0].text, via === "regex" ? { force: "regex" } : { english: nmtEnglish?.[0], force: "nmt" });
  } catch { /* warmup */ }
  const cases: Case[] = [];
  for (let i = 0; i < FIXTURES.length; i++) {
    const fx = FIXTURES[i];
    const t0 = Date.now();
    try {
      const opts = via === "regex" ? { force: "regex" as const } : { english: nmtEnglish?.[i], force: "nmt" as const };
      const { draft, inferMs, english } = await extractObservation(fx.text, opts);
      const row = score(fx, draft, inferMs, true, english);
      cases.push(row);
      const miss = ["client", "city", "country", "modality"].filter((k) => !row[k as "client"]);
      if (miss.length) console.log(`  MISS ${miss.join(",")} :: ${fx.text.slice(0, 50)}`);
    } catch (err) {
      cases.push(score(fx, null, Date.now() - t0, false));
      console.log(`  FAIL ${fx.text.slice(0, 50)} :: ${err instanceof Error ? err.message : err}`);
    }
  }
  return summarize(`${key}/${via}`, MODEL_NAME, via, cases, loadMs);
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

function combo(a: Summary, b: Summary, label: string): Summary {
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
  return summarize(label, `${a.key}+${b.key} fill-null`, a.via, cases, a.loadMs + b.loadMs);
}

type TranslatorReport = {
  name: string;
  engine: string;
  from: string;
  to: string;
  loadMs: number | null;
  batchMs: number | null;
  stats: TranslateStats | null;
  prompts: { es: string; en: string }[];
};

const translatorReport: TranslatorReport = {
  name: TRANSLATOR_NAME,
  engine: "Bergamot",
  from: "es",
  to: "en",
  loadMs: null,
  batchMs: null,
  stats: null,
  prompts: [],
};

let nmtEnglish: string[] | null = null;
const transT0 = Date.now();
const translatorId = await ensureTranslator();
translatorReport.loadMs = Date.now() - transT0;
if (translatorId) {
  const batch = await translateEsEnBatch(FIXTURES.map((fx) => fx.text));
  if (batch) {
    nmtEnglish = batch.translations;
    translatorReport.batchMs = batch.ms;
    translatorReport.stats = batch.stats ?? getLastTranslateStats();
    translatorReport.prompts = FIXTURES.map((fx, i) => ({ es: fx.text, en: batch.translations[i] }));
    console.log(`▸ TranslatePsy ${TRANSLATOR_NAME} load=${translatorReport.loadMs}ms batch=${batch.ms}ms n=${batch.translations.length}`);
    for (const p of translatorReport.prompts) {
      console.log(`  ES: ${p.es.slice(0, 72)}`);
      console.log(`  EN: ${p.en.slice(0, 72)}`);
    }
  } else {
    console.log("▸ TranslatePsy batch failed — matrix will skip NMT-EN");
  }
} else {
  console.log("▸ TranslatePsy unavailable — matrix will skip NMT-EN");
}

const vias: TranslateVia[] = nmtEnglish ? ["regex", "nmt"] : ["regex"];
const solos: Summary[] = [];
try {
  for (const key of KEYS) {
    try {
      const loadT0 = Date.now();
      await switchModel(key);
      console.log(`\n▸ load ${key} (${MODEL_NAME})`);
      await ensureModel();
      const loadMs = Date.now() - loadT0;
      for (const via of vias) {
        solos.push(await runLoaded(key, via, nmtEnglish, loadMs));
      }
    } catch (err) {
      console.log(`▸ SKIP ${key}: ${err instanceof Error ? err.message : err}`);
      await shutdown().catch(() => {});
      if (nmtEnglish) await ensureTranslator();
    }
  }
} finally {
  await shutdown().catch(() => {});
}

const line = (s: Summary) =>
  `${s.pass ? "PASS" : "FAIL"}  ${s.key.padEnd(22)} client=${s.client}/${s.n} city=${s.city}/${s.n} country=${s.country}/${s.n} mod=${s.modality}/${s.n} qty=${s.qty}/${s.qtyWant} halluc=${s.halluc}  p50=${s.p50}ms p95=${s.p95}ms  q=${s.quality}`;

console.log("\n=== SOLOS ===");
for (const s of solos) console.log(line(s));

function combosFor(group: Summary[]): Summary[] {
  const out: Summary[] = [];
  for (let i = 0; i < group.length; i++) {
    for (let j = 0; j < group.length; j++) {
      if (i === j) continue;
      out.push(combo(group[i], group[j], `${group[i].key}+${group[j].key}`));
    }
  }
  out.sort((a, b) => b.quality - a.quality || a.p50 - b.p50);
  return out;
}

const allCombos: Summary[] = [];
for (const via of vias) {
  const group = solos.filter((s) => s.via === via);
  const combos = combosFor(group);
  allCombos.push(...combos);
  console.log(`\n=== COMBOS ${via} (A, fill nulls from B; latency = A + B-on-miss) ===`);
  for (const s of combos.slice(0, 12)) console.log(line(s));
}

console.log("\n=== PICK ===");
for (const via of vias) {
  const group = solos.filter((s) => s.via === via);
  const ranked = [...group].sort((a, b) => b.quality - a.quality || a.p50 - b.p50);
  const bestSolo = ranked[0];
  const bestCombo = allCombos.filter((s) => s.via === via)[0];
  if (bestSolo) console.log(`best solo ${via}:  ${line(bestSolo)}`);
  if (bestCombo) console.log(`best combo ${via}: ${line(bestCombo)}`);
}

const report = {
  translator: translatorReport,
  models: solos.map((s) => ({
    key: s.key,
    name: s.name,
    via: s.via,
    loadMs: s.loadMs,
    valid: s.valid,
    n: s.n,
    client: s.client,
    city: s.city,
    country: s.country,
    modality: s.modality,
    qty: s.qty,
    qtyWant: s.qtyWant,
    halluc: s.halluc,
    p50: s.p50,
    p95: s.p95,
    quality: s.quality,
    pass: s.pass,
    cases: s.cases.map((c, i) => ({
      prompt: FIXTURES[i].text,
      english: c.english ?? translatorReport.prompts[i]?.en ?? null,
      inferMs: c.ms,
      ok: c.ok,
      client: c.client,
      city: c.city,
      country: c.country,
      modality: c.modality,
      qty: c.qty,
      halluc: c.halluc,
    })),
  })),
};

console.log("\n=== PERF JSON ===");
console.log(JSON.stringify(report, null, 2));
await mkdir(dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
console.log(`▸ wrote ${REPORT_PATH}`);
process.exit(0);
