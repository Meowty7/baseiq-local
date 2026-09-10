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

// ponytail: prioridad lineal por impacto en inventario; si crece a decenas de campos, usar pesos configurables.
const MISSING_PRIORITY = ["client", "modality", "quantity", "city", "country", "brand", "model", "ageYears"];

export function rankMissing(draft: ObservationDraft): string[] {
  return [...draft.missing].sort(
    (a, b) => MISSING_PRIORITY.indexOf(a.split(".")[0]) - MISSING_PRIORITY.indexOf(b.split(".")[0]),
  );
}

export function nextQuestion(draft: ObservationDraft): string | null {
  const top = rankMissing(draft)[0];
  if (!top) return null;
  const field = top.split(".")[0];
  const labels: Record<string, string> = {
    client: "¿En qué hospital o clínica se hizo la observación?",
    modality: "¿Qué tipo de equipo viste (resonador, tomógrafo, ecógrafo)?",
    quantity: "¿Cuántos equipos de ese tipo hay?",
    city: "¿En qué ciudad está el cliente?",
    country: "¿En qué país está el cliente?",
    brand: "¿De qué marca es el equipo?",
    model: "¿Cuál es el modelo del equipo?",
    ageYears: "¿Qué antigüedad aproximada tiene el equipo (años)?",
  };
  return labels[field] ?? `¿Puedes precisar ${field}?`;
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
  for (const [re, en] of ES_TO_EN) out = out.replace(re, en);
  out = out.replace(/ de (?=\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|about|more)/gi, " of ");
  return out.replace(/[ \t]+/g, " ").trim();
}

const MODALITY_KEYWORDS: [RegExp, Modality][] = [
  [/resonador(es)?|\bmri\b|\bmagnetic\s+resonance\b/i, "resonador"],
  [/tom[oó]grafo(s)?|\bct(?:\s*scanner)?\b|\bcomputed\s+tomograph/i, "tomografo"],
  [/ec[oó]grafo(s)?|\bultrasound\b|\bsonograph/i, "ecografo"],
  [/rayos?\s*x|\bx[-\s]?ray/i, "rayos-x"],
  [/mam[oó]grafo(s)?|\bmammograph|\bmammogram/i, "mamografo"],
];

const MODALITY_ALIASES: Record<string, Modality> = {
  resonador: "resonador", resonadores: "resonador", mri: "resonador", "magnetic-resonance": "resonador",
  tomografo: "tomografo", tomografos: "tomografo", ct: "tomografo", "ct-scanner": "tomografo", ctscanner: "tomografo",
  "computed-tomography": "tomografo",
  ecografo: "ecografo", ecografos: "ecografo", ultrasound: "ecografo", sonograph: "ecografo",
  "rayos-x": "rayos-x", rayosx: "rayos-x", "x-ray": "rayos-x", xray: "rayos-x",
  mamografo: "mamografo", mamografos: "mamografo", mammograph: "mamografo", mammogram: "mamografo",
  otra: "otra", other: "otra",
};

const NUMBER_TOKEN = String.raw`(\d+|una?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)`;
const WORD_TO_NUM: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20,
};

function parseNum(token: string): number | null {
  const t = token.toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return WORD_TO_NUM[t] ?? null;
}

const FACILITY_RE =
  /^(hospital|cl[ií]nica|clinic|centro m[eé]dico|policl[ií]nica|polyclinic|sanatorio|centro)\s+(.+)$/i;
const ARTICLES = new Set(["de", "del", "la", "el", "los", "las", "of", "the"]);

function stripAccents(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function acceptClient(raw: string | null, sourceText?: string): string | null {
  if (!raw) return null;
  const name = raw.split(",")[0].trim();
  if (name.length === 0 || name.length > 60) return null;
  const m = name.match(FACILITY_RE);
  if (!m?.[2]) return null;
  const words = m[2].trim().split(/\s+/);
  const isArticle = (w: string) => ARTICLES.has(stripAccents(w));
  const content = words.filter((w) => !isArticle(w));
  if (content.length === 0) return null;
  // "de David" / "of David" = ciudad. "del Istmo" / "de la Esperanza" = nombre.
  const link = stripAccents(words[0]);
  if ((link === "de" || link === "of") && words.length === 2 && !isArticle(words[1])) return null;
  if (content[0][0] !== content[0][0].toUpperCase()) return null;
  if (sourceText) {
    const cleanSource = ` ${stripAccents(sourceText).replace(/[^a-z0-9]/g, " ")} `;
    const core = content.map((w) => stripAccents(w));
    if (core.length > 0 && !core.some((w) => cleanSource.includes(` ${w} `))) return null;
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
  const m = clean.match(
    /(hospital|cl[ií]nica|clinic|centro m[eé]dico|policl[ií]nica|sanatorio|centro)\s+([^,.;]+?)(?:,|\.| en | hay |$)/i,
  );
  if (!m?.[1] || !m?.[2]) return null;
  const rawName = `${m[1]} ${m[2].trim()}`
    .split(/\s+/)
    .map((w) => (ARTICLES.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
  return acceptClient(rawName, sourceText);
}

function rescueQuantity(modality: Modality | null, anchor: string): number | null {
  const low = anchor.toLowerCase();
  if (modality) {
    const kw = MODALITY_KEYWORDS.find(([, m]) => m === modality)?.[0].source;
    if (kw) {
      const filler = String.raw`(?:equipos?|sistemas?|unidades?)\s+(?:de\s+)?`;
      const m = low.match(new RegExp(`${NUMBER_TOKEN}\\s*(?:${filler})?(?:de\\s+)?${kw}`, "i"));
      const n = m?.[1] ? parseNum(m[1]) : null;
      if (n && n > 0) return n;
    }
  }
  if (modality) {
    const hasOtherMod = MODALITY_KEYWORDS.some(([, m]) => m !== modality && new RegExp(m, "i").test(low));
    if (hasOtherMod) return null;
  }
  const generic = low.match(new RegExp(NUMBER_TOKEN, "i"))?.[1];
  const n = generic ? parseNum(generic) : null;
  return n && n > 0 ? n : null;
}

function rescueAge(anchor: string, nowYear = new Date().getFullYear()): number | null {
  const low = anchor.toLowerCase();
  const rangeNorm = low.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const ageToken = String.raw`(\d{1,2}|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte)`;
  const range = rangeNorm.match(new RegExp(`${ageToken}\\s*(?:–|—|-|a)\\s*(\\d{1,2})\\s*anos`));
  if (range?.[1] && range?.[2]) {
    const a = parseNum(range[1]);
    if (a !== null) return Math.round((a + Number(range[2])) / 2);
  }
  const single = rangeNorm.match(
    new RegExp(`(?:de\\s+)?(?:unos|unas|mas de|alrededor de)\\s*${ageToken}\\s*anos|${ageToken}\\s*anos`),
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
  if (/\bnuev[oa]s?\b/.test(low)) return 0;
  return null;
}

// ponytail: los modelos Q4 pequeños alucinan marcas y confunden modalidad.
// Estas reglas blindan el borrador: solo vale lo que aparece literal en el texto,
// y la modalidad/cantidad se rescatan por palabras clave en español.
export function groundDraft(draft: ObservationDraft, sourceText: string, englishText?: string): ObservationDraft {
  const low = sourceText.toLowerCase();
  const evidenceSrc = (englishText ?? sourceText).toLowerCase();
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
      if (grounded.evidence && !evidenceSrc.includes(grounded.evidence.toLowerCase().slice(0, 20))) {
        grounded.evidence = null;
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
      // Cantidad y edad ancladas a la frase de la modalidad, no al texto completo.
      const modalitySentence = grounded.modality ? sentencesFor(grounded.modality, sourceText) : "";
      const anchor = `${grounded.evidence ?? ""} ${modalitySentence || sourceText}`;
      grounded.quantity = rescueQuantity(grounded.modality, anchor);
      grounded.ageYears = rescueAge(anchor);
      // Proximity de edad: si la mención está más cerca de OTRA modalidad, anular.
      if (grounded.ageYears !== null && grounded.modality) {
        const low2 = sourceText.toLowerCase();
        const norm = low2.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const s = String(grounded.ageYears);
        const wordForm = Object.entries(WORD_TO_NUM).find(([, n]) => n === grounded.ageYears)?.[0];
        const ageM = norm.match(new RegExp(`(?:${s}|${wordForm ?? ""})\\s+anos?`));
        const year = new Date().getFullYear() - grounded.ageYears;
        const yearM = low2.match(new RegExp(`\\b${year}\\b`));
        const newM = grounded.ageYears === 0 ? low2.match(/\bnuev[oa]s?\b/) : null;
        const pos = ageM?.index ?? yearM?.index ?? newM?.index;
        if (pos !== undefined && pos !== null) {
          const near = nearestModalityAt(low2, pos);
          if (near && near !== grounded.modality) grounded.ageYears = null;
        }
      }
      return grounded;
    })
    .filter((e) => {
      if (isEmpty(e) || unattributable(e)) return false;
      const k = keyOf(e);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  // Una modalidad mencionada sin equipo asignado merece su propia fila para revisión.
  // Sin evidencia atribuible, la edad queda en null: no se hereda la de otro equipo.
  for (const m of uniqueModalities) {
    if (!items.some((e) => e.modality === m)) {
      const mSentence = sentencesFor(m, sourceText);
      const mAnchor = mSentence || sourceText;
      let age = rescueAge(mAnchor);
      if (age === 0) {
        const pos = sourceText.toLowerCase().indexOf("nuevo");
        if (pos !== -1 && nearestModalityAt(sourceText.toLowerCase(), pos) !== m) age = null;
      }
      items.push({
        modality: m,
        quantity: rescueQuantity(m, mAnchor),
        brand: null,
        model: null,
        ageYears: age,
        evidence: null,
      });
    }
  }
  return { ...draft, client, equipment: items };
}
