import { getQuestion } from "../src/i18n/questions";

export const OBSERVATION_STATUSES = ["Confirmado", "Reportado", "Estimado", "Desconocido"] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

export const MODALITIES = ["resonador", "tomografo", "ecografo", "rayos-x", "mamografo", "otra"] as const;
export type Modality = (typeof MODALITIES)[number];

export interface EquipmentDraft {
  modality: Modality | null;
  quantity: number | null;
  brand: string | null;
  model: string | null;
  ageYears: number | null;
  evidence: string | null;
}

export interface ObservationDraft {
  client: string | null;
  city: string | null;
  country: string | null;
  equipment: EquipmentDraft[];
  missing: string[];
}

export interface ObservationRecord extends ObservationDraft {
  id: number;
  status: ObservationStatus;
  sourceText: string;
  createdAt: string;
  submittedBy: string | null;
  observedAt: string | null;
  sourceType: string | null;
  comments: string | null;
  confirmedAt: string | null;
}

export const SOURCE_TYPES = ["visita", "llamada", "reporte"] as const;

export type Freshness = "reciente" | "por verificar" | "desactualizada";
// ponytail: 90/180 días fijos; si Philips pide política configurable, mover a constante de entorno.
export function freshness(observedAt: string | null, confirmedAt: string | null, nowMs = Date.now()): Freshness {
  const ref = confirmedAt ?? observedAt;
  if (!ref) return "por verificar";
  const days = (nowMs - Date.parse(ref)) / 86400000;
  if (!Number.isFinite(days) || days < 0) return "por verificar";
  if (days <= 90) return "reciente";
  if (days <= 180) return "por verificar";
  return "desactualizada";
}

export interface Client360Row {
  client: string;
  city: string | null;
  country: string | null;
  modality: Modality;
  quantity: number;
  ageRange: string | null;
  confidence: ObservationStatus;
  freshness: Freshness;
  lastSeen: string;
  observations: number;
}

// ponytail: agregación ingenua O(n) en memoria; a miles de clientes, agrupar en SQL.
export function aggregate360(observations: ObservationRecord[]): Client360Row[] {
  const groups = new Map<string, ObservationRecord[]>();
  for (const o of observations) {
    for (const e of o.equipment) {
      if (!e.modality) continue;
      const key = `${o.client ?? "Sin cliente"}||${e.modality}`;
      const list = groups.get(key) ?? [];
      list.push(o);
      groups.set(key, list);
    }
  }
  const rows: Client360Row[] = [];
  for (const [key, list] of groups) {
    const [client, modality] = key.split("||") as [string, Modality];
    const items = list.flatMap((o) => o.equipment.filter((e) => e.modality === modality));
    const quantities = items.map((e) => e.quantity).filter((q): q is number => q !== null);
    const ages = items.map((e) => e.ageYears).filter((a): a is number => a !== null);
    const statuses = list.map((o) => o.status);
    const rank = (s: ObservationStatus) => OBSERVATION_STATUSES.indexOf(s);
    const confidence = statuses.sort((a, b) => rank(a) - rank(b))[0] ?? "Desconocido";
    const last = list.map((o) => o.observedAt ?? o.createdAt).sort().reverse()[0];
    const qty = quantities.reduce((a, b) => a + b, 0);
    const ageRange = ages.length === 0 ? null
      : ages.length === 1 ? `${ages[0]}`
      : `${Math.min(...ages)}–${Math.max(...ages)}`;
    rows.push({
      client, city: list[0]?.city ?? null, country: list[0]?.country ?? null,
      modality, quantity: qty || items.length,
      ageRange, confidence, freshness: freshness(last, list.find((o) => o.confirmedAt)?.confirmedAt ?? null),
      lastSeen: last.slice(0, 10), observations: list.length,
    });
  }
  return rows.sort((a, b) => a.client.localeCompare(b.client) || a.modality.localeCompare(b.modality));
}

export function appendFollowUp(transcript: string, answer: string): string {
  return `${transcript}\nRespuesta: ${answer.trim()}`;
}

export interface Conflict {
  client: string;
  modality: string;
  detail: string;
  dates: string[];
  statuses: ObservationStatus[];
}

// ponytail: comparación ingenua O(n) por grupo; a miles de observaciones, agrupar en SQL.
export function detectConflicts(observations: ObservationRecord[]): Conflict[] {
  const groups = new Map<string, ObservationRecord[]>();
  for (const o of observations) {
    for (const e of o.equipment) {
      if (!e.modality) continue;
      const key = `${o.client ?? ""}||${e.modality}`;
      const list = groups.get(key) ?? [];
      list.push(o);
      groups.set(key, list);
    }
  }
  const conflicts: Conflict[] = [];
  for (const [key, list] of groups) {
    const uniq = [...new Map(list.map((o) => [o.id, o])).values()];
    if (uniq.length < 2) continue;
    const [client, modality] = key.split("||");
    const items = uniq.flatMap((o) => o.equipment.filter((e) => e.modality === modality));
    const quantities = [...new Set(items.map((e) => e.quantity).filter((q): q is number => q !== null))];
    const brands = [...new Set(items.map((e) => (e.brand ?? "").toLowerCase()).filter(Boolean))];
    const models = [...new Set(items.map((e) => (e.model ?? "").toLowerCase()).filter(Boolean))];
    const details: string[] = [];
    if (quantities.length > 1) details.push(`cantidades distintas: ${quantities.join(" vs ")}`);
    if (brands.length > 1) details.push(`marcas distintas: ${brands.join(" vs ")}`);
    if (models.length > 1) details.push(`modelos distintos: ${models.join(" vs ")}`);
    if (details.length > 0) {
      conflicts.push({
        client,
        modality,
        detail: details.join("; "),
        dates: uniq.map((o) => (o.observedAt ?? o.createdAt).slice(0, 10)),
        statuses: uniq.map((o) => o.status),
      });
    }
  }
  return conflicts;
}

export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    client: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    country: { type: ["string", "null"] },
    equipment: {
      type: "array",
      items: {
        type: "object",
        properties: {
          modality: { type: ["string", "null"] },
          quantity: { type: ["integer", "null"] },
          brand: { type: ["string", "null"] },
          model: { type: ["string", "null"] },
          ageYears: { type: ["integer", "null"] },
          evidence: { type: ["string", "null"] },
        },
        required: ["modality", "quantity", "brand", "model", "ageYears", "evidence"],
        additionalProperties: false,
      },
    },
    missing: { type: "array", items: { type: "string" } },
  },
  required: ["client", "city", "country", "equipment", "missing"],
  additionalProperties: false,
} as const;

export function normalizeDraft(raw: unknown): ObservationDraft {
  const r = raw as Record<string, unknown>;
  const eq = Array.isArray(r.equipment) ? r.equipment : [];
  return {
    client: typeof r.client === "string" ? r.client : null,
    city: typeof r.city === "string" ? r.city : null,
    country: typeof r.country === "string" ? r.country : null,
    equipment: eq.map((e) => {
      const o = e as Record<string, unknown>;
      return {
        modality: normalizeModality(o.modality),
        quantity:
          Number.isInteger(o.quantity) && (o.quantity as number) > 0 ? (o.quantity as number) : null,
        brand: typeof o.brand === "string" ? o.brand : null,
        model: typeof o.model === "string" ? o.model : null,
        ageYears:
          Number.isInteger(o.ageYears) && (o.ageYears as number) >= 0 && (o.ageYears as number) <= 60
            ? (o.ageYears as number)
            : null,
        evidence: typeof o.evidence === "string" ? o.evidence : null,
      };
    }),
    missing: Array.isArray(r.missing) ? r.missing.filter((m): m is string => typeof m === "string") : [],
  };
}

// Base value per field: how much a single missing instance of it is worth
// asking about. client blocks saving outright, so it always wins. modality/
// quantity define what was actually seen, so they outrank where/who. City
// and country are grouped as one "location" ask instead of two separate
// turns since a visitor who knows one often knows both. Enrichment fields
// (brand/model/ageYears) are worth the least per occurrence. When several
// equipment rows are missing the same enrichment field, each row keeps its
// own candidate (score ties broken by equipment index) instead of collapsing
// into one generic question — so with 3 units missing brand, the user gets
// asked "brand of unit 1?", then "brand of unit 2?", etc., one at a time, to
// find out for each row specifically whether they actually know it.
const FIELD_BASE_VALUE: Record<string, number> = {
  client: 100,
  modality: 40,
  quantity: 35,
  location: 20,
  brand: 8,
  model: 6,
  ageYears: 5,
};

interface MissingCandidate {
  field: string;
  score: number;
  equipmentIndex: number | null;
}

function scoreMissing(draft: ObservationDraft): MissingCandidate[] {
  const candidates: MissingCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of draft.missing) {
    const [field, idxStr] = raw.split(".");
    const equipmentIndex = idxStr != null ? Number(idxStr) : null;
    if (field === "city" || field === "country") {
      if (seen.has("location")) continue;
      seen.add("location");
      const bothMissing = draft.missing.includes("city") && draft.missing.includes("country");
      candidates.push({ field: "location", score: FIELD_BASE_VALUE.location * (bothMissing ? 1.5 : 1), equipmentIndex: null });
      continue;
    }
    const base = FIELD_BASE_VALUE[field];
    if (base == null) continue;
    const key = equipmentIndex == null ? field : `${field}.${equipmentIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ field, score: base, equipmentIndex });
  }
  // Higher score first; among ties (e.g. brand.0 vs brand.1), lower equipment
  // index first, so multi-equipment gaps get asked about in order.
  return candidates.sort((a, b) => b.score - a.score || (a.equipmentIndex ?? -1) - (b.equipmentIndex ?? -1));
}

export function rankMissing(draft: ObservationDraft): string[] {
  return scoreMissing(draft).map((c) => (c.equipmentIndex == null ? c.field : `${c.field}.${c.equipmentIndex}`));
}

export function nextQuestion(draft: ObservationDraft, lang?: string): string | null {
  const top = scoreMissing(draft)[0];
  if (!top) return null;
  // Only spell out which equipment the question is about once there's more
  // than one row to disambiguate between — with a single equipment, "brand
  // of equipment 1?" would just be noise.
  const equipmentNumber = top.equipmentIndex != null && draft.equipment.length > 1 ? top.equipmentIndex + 1 : undefined;
  return getQuestion(top.field, lang ?? "es", equipmentNumber);
}

/** Same ranking as nextQuestion, but also returns the raw field id (e.g. "brand", "location") and which equipment row it's about, so callers can read back the value the user just supplied for it. */
export function nextQuestionField(draft: ObservationDraft): { field: string; equipmentIndex: number | null } | null {
  const top = scoreMissing(draft)[0];
  return top ? { field: top.field, equipmentIndex: top.equipmentIndex } : null;
}

function missingKey(c: { field: string; equipmentIndex: number | null }): string {
  return c.equipmentIndex == null ? c.field : `${c.field}.${c.equipmentIndex}`;
}

/**
 * Same ranking as nextQuestionField, but skips any candidate whose key
 * (e.g. "brand.0", "location") is in `skip` — for the review-after-save
 * flow, where the user can skip one field at a time without it reappearing.
 */
export function nextQuestionFieldExcluding(
  draft: ObservationDraft,
  skip: ReadonlySet<string>,
): { field: string; equipmentIndex: number | null } | null {
  const top = scoreMissing(draft).find((c) => !skip.has(missingKey(c)));
  return top ? { field: top.field, equipmentIndex: top.equipmentIndex } : null;
}

export function nextQuestionExcluding(draft: ObservationDraft, skip: ReadonlySet<string>, lang?: string): string | null {
  const top = nextQuestionFieldExcluding(draft, skip);
  if (!top) return null;
  const equipmentNumber = top.equipmentIndex != null && draft.equipment.length > 1 ? top.equipmentIndex + 1 : undefined;
  return getQuestion(top.field, lang ?? "es", equipmentNumber);
}

export const MODALITY_GLOSSARY: { id: Modality; es: string; en: string }[] = [
  { id: "resonador", es: "resonador", en: "MRI" },
  { id: "tomografo", es: "tomógrafo", en: "CT" },
  { id: "ecografo", es: "ecógrafo", en: "ultrasound" },
  { id: "rayos-x", es: "rayos x", en: "X-ray" },
  { id: "mamografo", es: "mamógrafo", en: "mammograph" },
  { id: "otra", es: "otra", en: "other" },
];

// ponytail: léxico de campo, no traductor. Nombres propios (hospital, ciudad, marca) se dejan.
const ES_TO_EN: [RegExp, string][] = [
  [/sin marca visible/gi, "no visible brand"],
  [/sin m[aá]s detalles/gi, "no further details"],
  [/del mismo fabricante/gi, "from the same manufacturer"],
  [/hay que renovarlos/gi, "they need replacement"],
  [/no s[eé] la marca/gi, "unknown brand"],
  [/sin identificar/gi, "unidentified"],
  [/m[aá]s o menos/gi, "approximately"],
  [/uno de los/gi, "one of the"],
  [/equipos de rayos\s*x/gi, "X-ray units"],
  [/estoy en/gi, "I am at"],
  [/visit[eé] la/gi, "I visited"],
  [/visit[eé] el/gi, "I visited"],
  [/parece de/gi, "seems"],
  [/de unos/gi, "about"],
  [/de unas/gi, "about"],
  [/m[aá]s de/gi, "more than"],
  [/en el/gi, "at the"],
  [/en la/gi, "at the"],
  [/hay un/gi, "there is a"],
  [/hay una/gi, "there is a"],
  [/\bhay\b/gi, "there are"],
  [/rayos\s*x/gi, "X-ray"],
  [/resonadores/gi, "MRI scanners"],
  [/resonador/gi, "MRI"],
  [/tom[oó]grafos/gi, "CT scanners"],
  [/tom[oó]grafo/gi, "CT scanner"],
  [/ec[oó]grafos/gi, "ultrasound units"],
  [/ec[oó]grafo/gi, "ultrasound"],
  [/mam[oó]grafos/gi, "mammographs"],
  [/mam[oó]grafo/gi, "mammograph"],
  [/\ba[nñ]os\b/gi, "years"],
  [/\bnuev[oa]s?\b/gi, "new"],
  [/\bviej[oa]s?\b/gi, "old"],
  [/port[aá]til(?:es)?/gi, "portable"],
  [/\bambos\b/gi, "both"],
  [/\bmodelo\b/gi, "model"],
  [/\bequipos\b/gi, "units"],
  [/\bparece\b/gi, "seems"],
  [/\bvisit[eé]\b/gi, "I visited"],
  [/\bvi\b/gi, "I saw"],
  [/\bunos\b|\bunas\b/gi, "about"],
  [/\bdoce\b/gi, "twelve"],
  [/\bonce\b/gi, "eleven"],
  [/\bdiez\b/gi, "ten"],
  [/\bnueve\b/gi, "nine"],
  [/\bocho\b/gi, "eight"],
  [/\bsiete\b/gi, "seven"],
  [/\bseis\b/gi, "six"],
  [/\bcinco\b/gi, "five"],
  [/\bcuatro\b/gi, "four"],
  [/\btres\b/gi, "three"],
  [/\bdos\b/gi, "two"],
  [/\buno\b/gi, "one"],
  [/\botra\b|\botro\b/gi, "another"],
  [/\buna\b/gi, "a"],
  [/\bun\b/gi, "a"],
  [/\ben\b/gi, "in"],
  [/\by\b/gi, "and"],
];

export function toEnglishObservation(text: string): string {
  let out = text.replace(/[\[\]{}]/g, "");
  out = out.replace(new RegExp(NUMBER_WORD, "gi"), (m) => {
    const n = parseNum(m);
    return n !== null ? String(n) : m;
  });
  for (const [re, en] of ES_TO_EN) out = out.replace(re, en);
  out = out.replace(/ de (?=\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|about|more)/gi, " of ");
  return out.replace(/[ \t]+/g, " ").trim();
}

const MODALITY_KEYWORDS: [RegExp, Modality][] = [
  [/resonador(es)?|\bmri\b|\bmrt\b|\bmagnetic\s+resonance\b/i, "resonador"],
  [/tom[oó]grafo(s)?|\bct(?:\s*scanner)?\b|\bcomputed\s+tomograph/i, "tomografo"],
  [/ec[oó]grafo(s)?|\bultrasound\b|\bsonograph/i, "ecografo"],
  [/rayos?\s*x|\bx[-\s]?ray/i, "rayos-x"],
  [/mam[oó]grafo(s)?|mamograf[ií]as?|\bmammograph|\bmammogram/i, "mamografo"],
];

const MODALITY_ALIASES: Record<string, Modality> = {
  resonador: "resonador", resonadores: "resonador", mri: "resonador", mrt: "resonador", "magnetic-resonance": "resonador",
  tomografo: "tomografo", tomografos: "tomografo", ct: "tomografo", "ct-scanner": "tomografo", ctscanner: "tomografo",
  "computed-tomography": "tomografo",
  ecografo: "ecografo", ecografos: "ecografo", ultrasound: "ecografo", sonograph: "ecografo",
  "rayos-x": "rayos-x", rayosx: "rayos-x", "x-ray": "rayos-x", xray: "rayos-x",
  mamografo: "mamografo", mamografos: "mamografo", mamografia: "mamografo", mamografias: "mamografo",
  mammograph: "mamografo", mammogram: "mamografo",
  otra: "otra", other: "otra",
};

const UNITS: Record<string, number> = {
  un: 1, uno: 1, una: 1, one: 1,
  dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5,
  seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9,
};
const TEENS: Record<string, number> = {
  diez: 10, ten: 10, once: 11, eleven: 11, doce: 12, twelve: 12, trece: 13, thirteen: 13,
  catorce: 14, fourteen: 14, quince: 15, fifteen: 15,
  dieciseis: 16, sixteen: 16, diecisiete: 17, seventeen: 17, dieciocho: 18, eighteen: 18,
  diecinueve: 19, nineteen: 19,
};
const TENS: Record<string, number> = {
  veinte: 20, twenty: 20, treinta: 30, thirty: 30, cuarenta: 40, forty: 40,
  cincuenta: 50, fifty: 50, sesenta: 60, sixty: 60, setenta: 70, seventy: 70,
  ochenta: 80, eighty: 80, noventa: 90, ninety: 90,
};
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100,
  doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500,
  seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};
const VEINTI: Record<string, number> = Object.fromEntries(
  (["un", "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"] as const).map((u) => [`veinti${u}`, 20 + UNITS[u]]),
);
const ATOMS: Record<string, number> = { ...HUNDREDS, ...VEINTI, ...TEENS, ...TENS, ...UNITS };

const ATOM_ALT = [...Object.keys(ATOMS), "cientos", "cientas", "mil"].sort((a, b) => b.length - a.length).join("|");
const NUMBER_CHUNK = String.raw`(?:\d+|(?:${ATOM_ALT}))`;
const NUMBER_TOKEN = String.raw`(${NUMBER_CHUNK}(?:\s+(?:y\s+)?${NUMBER_CHUNK})*)`;

function parseNum(token: string): number | null {
  const t = stripAccents(token).replace(/-/g, " ").replace(/\s+/g, " ").trim();
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(/\s+y\s+|\s+/).filter((p) => p && p !== "y");
  if (parts.length === 0) return null;
  let n = 0;
  for (const w of parts) {
    if (w === "mil") { n = (n || 1) * 1000; continue; }
    if ((w === "cientos" || w === "cientas") && n > 0 && n < 10) { n *= 100; continue; }
    const atom = ATOMS[w];
    if (atom === undefined) return null;
    n += atom;
  }
  return n > 0 ? n : null;
}

const FACILITY_KIND = String.raw`hospital|cl[ií]nica|clinic|centro m[eé]dico|policl[ií]nica|polyclinic|sanatorio|centro|klinik`;
const FACILITY_RE = new RegExp(`^(${FACILITY_KIND})\\s+(.+)$`, "i");
const FACILITY_RE_SUFFIX = /^(.*?)\s+(hospital|cl[ií]nica|clinic|klinik)$/i;
const ARTICLES = new Set(["de", "del", "la", "el", "los", "las", "of", "the"]);
const LOCATIVES = new Set(["in", "en", "at", "im", "am", "auf", "a"]);

function stripAccents(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseFacilityName(name: string): { kind: string; rest: string } | null {
  const prefix = name.match(FACILITY_RE);
  if (prefix?.[1] && prefix?.[2]) return { kind: prefix[1], rest: prefix[2].trim() };
  const suffix = name.match(FACILITY_RE_SUFFIX);
  if (suffix?.[1] && suffix?.[2]) return { kind: suffix[2], rest: suffix[1].trim() };
  return null;
}

function acceptClient(raw: string | null, sourceText?: string): string | null {
  if (!raw) return null;
  const name = raw.split(",")[0].trim();
  if (name.length === 0 || name.length > 60) return null;
  const parsed = parseFacilityName(name);
  if (!parsed) return null;
  const words = parsed.rest.split(/\s+/);
  const isArticle = (w: string) => ARTICLES.has(stripAccents(w));
  const content = words.filter((w) => !isArticle(w));
  if (content.length === 0) return null;
  if (LOCATIVES.has(stripAccents(content[0]))) return null;
  // "policlínica de David" = ciudad. "Hospital de Paitilla" / "del Istmo" = nombre.
  const link = stripAccents(words[0]);
  const kind = stripAccents(parsed.kind);
  if ((link === "de" || link === "of") && words.length === 2 && !isArticle(words[1])) {
    if (kind.startsWith("policl") || kind === "polyclinic") return null;
  }
  if (content[0][0] !== content[0][0].toUpperCase()) return null;
  if (sourceText) {
    if (literalIn(sourceText, name)) return name;
    const cleanSource = ` ${stripAccents(sourceText).replace(/[^a-z0-9]/g, " ")} `;
    const core = content.map((w) => stripAccents(w));
    if (core.length < 2 || core.some((w) => !cleanSource.includes(` ${w} `))) return null;
  }
  return name;
}

function normalizeModality(value: unknown): Modality | null {
  if (typeof value !== "string") return null;
  const clean = stripAccents(value.toLowerCase().trim()).replace(/[\s_]+/g, "-");
  if (MODALITY_ALIASES[clean]) return MODALITY_ALIASES[clean];
  for (const ending of ["es", "s"]) {
    if (clean.endsWith(ending)) {
      const singular = clean.slice(0, -ending.length);
      if (MODALITY_ALIASES[singular]) return MODALITY_ALIASES[singular];
    }
  }
  return null;
}

function sentencesFor(modality: Modality | null, sourceText: string): string {
  if (!modality) return "";
  const kw = MODALITY_KEYWORDS.find(([, m]) => m === modality)?.[0];
  if (!kw) return "";
  const chunks = sourceText.includes(".") ? sourceText.split(/[.!?]+/) : sourceText.split(/[,;]+/);
  return chunks
    .filter((s) => new RegExp(kw.source, "i").test(s))
    .join(" ");
}

function nearestModality(text: string, term: string): Modality | null {
  const low = text.toLowerCase();
  const idx = low.indexOf(term.toLowerCase());
  if (idx === -1) return null;
  return nearestModalityAt(low, idx);
}

function nearestModalityAt(low: string, pos: number): Modality | null {
  let best: { mod: Modality; dist: number } | null = null;
  for (const [re, mod] of MODALITY_KEYWORDS) {
    for (const m of low.matchAll(new RegExp(re.source, "gi"))) {
      const dist = Math.abs((m.index ?? 0) - pos);
      if (!best || dist < best.dist) best = { mod, dist };
    }
  }
  return best?.mod ?? null;
}

function rescueClient(sourceText: string): string | null {
  const clean = sourceText.replace(/[\[\]{}()]/g, "");
  const loc = String.raw`en|in|im|at`;
  const prefix = clean.match(
    new RegExp(`(${FACILITY_KIND})\\s+(?!(?:${loc})\\b)([^,.;]+?)(?:,|\\. | (?:${loc}) | hay |$)`, "i"),
  );
  if (prefix?.[1] && prefix?.[2]) {
    const rawName = `${prefix[1]} ${prefix[2].trim()}`
      .split(/\s+/)
      .map((w) => (ARTICLES.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
    const ok = acceptClient(rawName, sourceText);
    if (ok) return ok;
  }
  const suffix = clean.match(
    new RegExp(String.raw`\b((?:[A-ZÁÉÍÓÚÜÑ][\p{L}\d'-]+\s+){1,6})(hospital|clinic|klinik)\b(?=\s+(?:${loc})\b|,|\.|$)`, "iu"),
  );
  if (suffix?.[1] && suffix?.[2]) {
    return acceptClient(`${suffix[1].trim()} ${suffix[2]}`, sourceText);
  }
  return null;
}

// Frontera ASCII, no \b: si no, "treinta y cinco mamógrafos" casa solo "cinco".
const NUMBER_WORD = String.raw`(?<![a-z0-9])${NUMBER_TOKEN}(?![a-z0-9])`;

const QTY_LEAD = String.raw`(?:${NUMBER_WORD}|(?<![a-z0-9])(?:a|an)(?![a-z0-9]))`;

function qtyFromMatch(m: RegExpMatchArray | null): number | null {
  if (!m) return null;
  if (m[1]) return parseNum(m[1]);
  return /^(?:a|an)\b/i.test(m[0].trim()) ? 1 : null;
}

function rescueQuantity(modality: Modality | null, anchor: string): number | null {
  const low = anchor.toLowerCase();
  if (modality) {
    const kw = MODALITY_KEYWORDS.find(([, m]) => m === modality)?.[0].source;
    if (kw) {
      const filler = String.raw`(?:equipos?|sistemas?|unidades?|devices?|scanners?|units?|machines?)\s+(?:de\s+|of\s+)?`;
      const n = qtyFromMatch(low.match(new RegExp(`${QTY_LEAD}\\s*(?:${filler})?(?:de\\s+|of\\s+)?(?:${kw})`, "i")));
      if (n && n > 0) return n;
    }
  }
  if (modality) {
    const hasOtherMod = MODALITY_KEYWORDS.some(([re, m]) => m !== modality && re.test(low));
    if (hasOtherMod) return null;
  }
  const generic = qtyFromMatch(low.match(new RegExp(`${QTY_LEAD}(?!\\s*(?:salas?|piso|pabell[oó]n|anexo|a[nñ]os|years?))`, "i")));
  if (!generic || generic <= 0 || generic >= 1900) return null;
  return generic;
}

function rescueFollowQuantity(modality: Modality | null, follow: string): number | null {
  if (!follow.trim()) return null;
  const byKw = rescueQuantity(modality, follow);
  if (byKw !== null && MODALITY_KEYWORDS.some(([re]) => re.test(follow))) return byKw;
  const m = follow.toLowerCase().match(new RegExp(String.raw`(?:en realidad\s+)?(?:son|hay|tienen|tenían)\s+${NUMBER_WORD}(?!\s+a[nñ]os)`, "i"));
  const n = m?.[1] ? parseNum(m[1]) : null;
  return n && n > 0 && n < 1900 ? n : null;
}

function rescueAge(anchor: string, nowYear = new Date().getFullYear()): number | null {
  const low = anchor.toLowerCase();
  const rangeNorm = low.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const ageToken = String.raw`(\d{1,2}|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)`;
  const yearWord = String.raw`(?:anos?|years?|jahre?n?)`;
  const range = rangeNorm.match(new RegExp(`${ageToken}\\s*(?:–|—|-|a|to)\\s*(\\d{1,2})\\s*${yearWord}`));
  if (range?.[1] && range?.[2]) {
    const a = parseNum(range[1]);
    if (a !== null) return Math.round((a + Number(range[2])) / 2);
  }
  const single = rangeNorm.match(
    new RegExp(`(?:de\\s+)?(?:unos|unas|mas de|alrededor de|about|around)\\s*${ageToken}\\s*${yearWord}(?:\\s+old)?|${ageToken}\\s*${yearWord}(?:\\s+old)?`),
  );
  if (single) {
    const token = single[1] ?? single[2];
    if (token) {
      const n = /^\d+$/.test(token) ? Number(token) : parseNum(token);
      if (n !== null && n >= 0 && n <= 60) return n;
    }
  }
  const install = low.match(/\b((?:19|20)\d{2})\b/)?.[1];
  if (install) {
    const age = nowYear - Number(install);
    if (age >= 0 && age <= 60) return age;
  }
  if (/\bnuev[oa]s?\b|\bnew\b/.test(low)) return 0;
  return null;
}

const FACILITY_HEAD = /^(hospital|cl[ií]nica|clinic|sanatorio|centro|policl|klinik)/i;
const PLACE_STOP = /^(hay|vi|tiene|tienen|tenían|un|una|dos|tres|con|y|saw|and)$/i;
const FACILITY_SPAN = new RegExp(
  String.raw`(?:(?:${FACILITY_KIND})\s+(?!(?:en|in|im|at)\b)[^,.;]+?|(?:[A-ZÁÉÍÓÚÜÑ][\p{L}\d'-]+\s+){1,5}(?:hospital|clinic|klinik))(?=\s+(?:en|in|im|at)\s+|,|\.|:|$)`,
  "iu",
);
const PLACE_TAIL = String.raw`[A-ZÁÉÍÓÚÜÑ][\p{L}'.]*(?:\s+(?:del|de|la|el|los|las|of|the|[A-ZÁÉÍÓÚÜÑ][\p{L}'.]*)){0,4}`;

function fold(s: string): string {
  return stripAccents(s).replace(/[^a-z0-9]+/g, " ").trim();
}

function literalIn(source: string, phrase: string): boolean {
  const needle = fold(phrase);
  return needle.length >= 2 && ` ${fold(source)} `.includes(` ${needle} `);
}

function titlePlace(s: string): string {
  return s.trim().split(/\s+/).map((w, i) => {
    const low = stripAccents(w);
    if (i > 0 && ARTICLES.has(low)) return low;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

function isPlacePhrase(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 40 || t.split(/\s+/).length > 5) return false;
  if (PLACE_STOP.test(t.split(/\s+/)[0]) || FACILITY_HEAD.test(t)) return false;
  if (MODALITY_KEYWORDS.some(([re]) => re.test(t))) return false;
  return /^[A-ZÁÉÍÓÚÜÑ]/.test(t);
}

function inFacilityOnly(source: string, phrase: string): boolean {
  const fac = source.match(FACILITY_SPAN)?.[0];
  if (!fac || !literalIn(fac, phrase)) return false;
  return !literalIn(source.slice(source.indexOf(fac) + fac.length), phrase);
}

function geoPrefix(source: string): string {
  let cut = source.length;
  for (const [re] of MODALITY_KEYWORDS) {
    const m = source.match(re);
    if (m?.index !== undefined && m.index < cut) cut = m.index;
  }
  return source.slice(0, cut);
}

function expandPlace(phrase: string, source: string): string {
  const hay = source.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const needle = phrase.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  let from = 0;
  let i = -1;
  while (from <= hay.length) {
    const j = hay.indexOf(needle, from);
    if (j === -1) break;
    const prev = j === 0 ? " " : hay[j - 1];
    const next = hay[j + needle.length] ?? " ";
    if (!/[a-z0-9]/i.test(prev) && !/[a-z0-9]/i.test(next)) { i = j; break; }
    from = j + 1;
  }
  if (i === -1) return phrase.trim();
  const fromSource = source.slice(i, i + phrase.length);
  const extra = source.slice(i + phrase.length).match(
    new RegExp(String.raw`^(?:\s+(?:del|de|la|el|los|las|of|the)\s+[A-ZÁÉÍÓÚÜÑ][\p{L}'.]*|\s+[A-ZÁÉÍÓÚÜÑ][\p{L}'.]*)+`, "u"),
  );
  if (!extra) return fromSource;
  const last = extra[0].trim().split(/\s+/).pop() ?? "";
  if (PLACE_STOP.test(last) || FACILITY_HEAD.test(last)) return fromSource;
  return `${fromSource}${extra[0]}`.trim();
}

function acceptGeo(raw: string | null, source: string): string | null {
  if (!raw) return null;
  const phrase = raw.split(",")[0].trim();
  if (!phrase || phrase.length > 40 || phrase.split(/\s+/).length > 5) return null;
  if (!literalIn(source, phrase) || !literalIn(geoPrefix(source), phrase) || inFacilityOnly(source, phrase)) return null;
  const expanded = expandPlace(phrase, source);
  return isPlacePhrase(expanded) ? expanded : null;
}

function placeAfter(prefix: string): string | null {
  const t = prefix.trim().replace(/^(?:en|in|im|at)\s+/i, "").trim();
  return isPlacePhrase(t) ? titlePlace(t) : null;
}

function geoAfterFacility(source: string): { after: string; places: string[] } {
  const m = source.match(FACILITY_SPAN);
  if (!m || m.index === undefined) return { after: "", places: [] };
  const after = source.slice(m.index + m[0].length);
  const clause = after.split(/[.!?]/)[0] ?? "";
  const places = clause.split(",").map((s) => placeAfter(s)).filter((p): p is string => p !== null);
  return { after, places };
}

// ponytail: gramática de la nota, no gazetteer. Un token suelto tras coma (Cali vs Panamá) lo deja el modelo.
function rescueGeoSlots(source: string): { city: string | null; country: string | null } {
  const { after, places } = geoAfterFacility(source);
  if (places.length >= 2) return { city: places[places.length - 2], country: places[places.length - 1] };
  if (places.length === 1 && /^\s*,\s*(?:en|in|im|at)\s+/i.test(after)) return { city: null, country: places[0] };
  if (places.length === 1 && /^\s*(?:en|in|im|at)\s+/i.test(after)) return { city: places[0], country: null };
  const de = source.match(new RegExp(
    String.raw`(?:policl[ií]nica|cl[ií]nica)\s+de\s+(${PLACE_TAIL})\s*,\s*([A-ZÁÉÍÓÚÜÑ][^,.;]*)`,
    "iu",
  ));
  if (de?.[1] && de?.[2]) {
    const country = placeAfter(de[2]);
    if (country) return { city: titlePlace(de[1]), country };
  }
  const facEn = source.match(new RegExp(
    String.raw`(?:hospital|cl[ií]nica|clinic|sanatorio|centro m[eé]dico|policl[ií]nica|centro)\s+(?!(?:en|in|im|at)\b)[^,.;]*?\s+(?:en|in|im|at)\s+(${PLACE_TAIL})`,
    "iu",
  ));
  const name = (facEn?.[1] ?? "").replace(/[,.:;].*$/, "").trim();
  if (name && !FACILITY_HEAD.test(name) && isPlacePhrase(name)) return { city: titlePlace(name), country: null };
  return { city: null, country: null };
}

function followUpText(sourceText: string): string {
  return sourceText.split(/\n?Respuesta:/i).slice(1).join(" ");
}

function sourceBody(sourceText: string): string {
  return sourceText.split(/\n?Respuesta:/i)[0] ?? sourceText;
}

function groundGeo(draft: ObservationDraft, sourceText: string): { city: string | null; country: string | null } {
  const modelCity = acceptGeo(draft.city, sourceText);
  const modelCountry = acceptGeo(draft.country, sourceText);
  const slots = rescueGeoSlots(sourceText);
  let city = modelCity ?? slots.city;
  let country = modelCountry ?? slots.country;
  if (city && country && stripAccents(city) === stripAccents(country) && !modelCity) city = null;
  return { city, country };
}

function ageMentionPos(sourceText: string, ageYears: number): number | null {
  const low2 = sourceText.toLowerCase();
  const norm = low2.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const wordAlt = Object.entries(ATOMS).filter(([, n]) => n === ageYears).map(([w]) => w).join("|");
  const ageM = norm.match(new RegExp(`(?:${ageYears}|${wordAlt})\\s+(?:anos?|years?|jahre?n?)`));
  const year = new Date().getFullYear() - ageYears;
  const yearM = low2.match(new RegExp(`\\b${year}\\b`));
  const newM = ageYears === 0 ? low2.match(/\bnuev[oa]s?\b/) : null;
  const pos = ageM?.index ?? yearM?.index ?? newM?.index;
  return pos === undefined || pos === null ? null : pos;
}

function ageForModality(age: number | null, modality: Modality | null, sourceText: string): number | null {
  if (age === null || !modality) return age;
  const pos = ageMentionPos(sourceText, age);
  if (pos === null) return age;
  const near = nearestModalityAt(sourceText.toLowerCase(), pos);
  return near && near !== modality ? null : age;
}

// ponytail: los modelos Q4 pequeños alucinan marcas y confunden modalidad.
// Estas reglas blindan el borrador: solo vale lo que aparece literal en el texto,
// y la modalidad/cantidad se rescatan por palabras clave en español.
export function groundDraft(draft: ObservationDraft, sourceText: string, englishText?: string): ObservationDraft {
  const low = sourceText.toLowerCase();
  const evidenceSrc = (englishText ?? sourceText).toLowerCase();
  const follow = followUpText(sourceText);
  const foundModalities = MODALITY_KEYWORDS.filter(([re]) => re.test(low)).map(([, m]) => m);
  const uniqueModalities = [...new Set(foundModalities)];
  const client = acceptClient(draft.client, `${sourceText} ${englishText ?? ""}`) ?? rescueClient(sourceText);
  const seen = new Set<string>();
  const keyOf = (e: EquipmentDraft) =>
    [e.modality, e.quantity, e.brand, e.model, e.ageYears, e.evidence].join("|");
  const isEmpty = (e: EquipmentDraft) =>
    !e.modality && e.quantity === null && !e.brand && !e.model && e.ageYears === null && !e.evidence;
  const unattributable = (e: EquipmentDraft) => !e.modality && !e.evidence;
  const items = draft.equipment.map((e) => {
      const grounded = { ...e };
      // Determinar modalidad primero: evidencia → única modalidad → corrección por evidencia.
      if (grounded.evidence) {
        const clip = grounded.evidence.toLowerCase().slice(0, 20);
        if (!low.includes(clip) && !evidenceSrc.includes(clip)) grounded.evidence = null;
      }
      if (!grounded.modality && grounded.evidence) {
        const anchor = grounded.evidence.toLowerCase();
        grounded.modality = MODALITY_KEYWORDS.find(([re]) => re.test(anchor))?.[1] ?? null;
      }
      if (!grounded.modality && !grounded.evidence && uniqueModalities.length === 1) {
        grounded.modality = uniqueModalities[0];
      }
      if (grounded.modality && grounded.evidence) {
        const anchor = grounded.evidence.toLowerCase();
        const inEvidence = MODALITY_KEYWORDS.find(([re]) => re.test(anchor))?.[1];
        if (inEvidence && inEvidence !== grounded.modality) grounded.modality = inEvidence;
      }
      // Marca/modelo: solo se aceptan si aparecen en el texto Y su modalidad más cercana coincide.
      for (const field of ["brand", "model"] as const) {
        const value = grounded[field];
        if (!value) continue;
        const appears = low.includes(value.toLowerCase());
        const tooLong = value.length > 40 || value.split(/\s+/).length > 4;
        const isModality = MODALITY_KEYWORDS.some(([re]) => re.test(value));
        const near = grounded.modality ? nearestModality(sourceText, value) : null;
        const wrongModality = near !== null && near !== grounded.modality;
        if (!appears || tooLong || isModality || wrongModality) grounded[field] = null;
      }
      if (!grounded.brand && follow) {
        const token = follow.match(/\b([A-ZÁÉÍÓÚÜÑ][\p{L}\d-]{2,})\b/u)?.[1];
        if (token && low.includes(token.toLowerCase()) && !FACILITY_HEAD.test(token) && !MODALITY_KEYWORDS.some(([re]) => re.test(token))) {
          const near = nearestModality(sourceText, token);
          if (!near || near === grounded.modality) grounded.brand = token;
        }
      }
      const body = sourceBody(sourceText);
      const modalitySentence = grounded.modality ? sentencesFor(grounded.modality, body) : "";
      const qtyAnchor = `${grounded.evidence ?? ""} ${modalitySentence || body}`;
      grounded.quantity = rescueFollowQuantity(grounded.modality, follow) ?? rescueQuantity(grounded.modality, qtyAnchor);
      grounded.ageYears = ageForModality(
        rescueAge(`${modalitySentence || body} ${follow}`),
        grounded.modality,
        sourceText,
      );
      return grounded;
    })
    .filter((e) => {
      if (isEmpty(e) || unattributable(e)) return false;
      if (e.modality && !uniqueModalities.includes(e.modality)) return false;
      const k = keyOf(e);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  // Una modalidad mencionada sin equipo asignado merece su propia fila para revisión.
  // Sin evidencia atribuible, la edad queda en null: no se hereda la de otro equipo.
  for (const m of uniqueModalities) {
    if (!items.some((e) => e.modality === m)) {
      const mSentence = sentencesFor(m, sourceBody(sourceText));
      const qtyAnchor = mSentence || sourceBody(sourceText);
      items.push({
        modality: m,
        quantity: rescueFollowQuantity(m, follow) ?? rescueQuantity(m, qtyAnchor),
        brand: null,
        model: null,
        ageYears: ageForModality(rescueAge(`${qtyAnchor} ${follow}`), m, sourceText),
        evidence: null,
      });
    }
  }
  const { city, country } = groundGeo(draft, sourceText);
  return { ...draft, client, city, country, equipment: items };
}
