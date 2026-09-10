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

const MODALITY_KEYWORDS: [RegExp, Modality][] = [
  [/resonador(es)?/i, "resonador"],
  [/tom[oó]grafo(s)?/i, "tomografo"],
  [/ec[oó]grafo(s)?/i, "ecografo"],
  [/rayos?\s*x/i, "rayos-x"],
  [/mam[oó]grafo(s)?/i, "mamografo"],
];

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

const FACILITY_PREFIXES = ["hospital", "clinica", "clinic", "centro", "policlinica", "sanatorio"];

function stripAccents(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeModality(value: unknown): Modality | null {
  if (typeof value !== "string") return null;
  const clean = stripAccents(value.toLowerCase().trim()).replace(/[\s_]+/g, "-");
  const mods = MODALITIES as readonly string[];
  if (mods.includes(clean)) return clean as Modality;
  for (const ending of ["es", "s"]) {
    if (clean.endsWith(ending)) {
      const singular = clean.slice(0, -ending.length);
      if (mods.includes(singular)) return singular as Modality;
    }
  }
  return null;
}

function sentencesFor(modality: Modality | null, sourceText: string): string {
  if (!modality) return "";
  const kw = MODALITY_KEYWORDS.find(([, m]) => m === modality)?.[0];
  if (!kw) return "";
  return sourceText
    .split(/[.!?]+/)
    .filter((s) => new RegExp(kw.source, "i").test(s))
    .join(" ");
}

function rescueClient(sourceText: string): string | null {
  const m = sourceText.match(
    /(hospital|cl[ií]nica|centro m[eé]dico|centro|policl[ií]nica|sanatorio)\s+([^,.;]+?)(?:,|\.| en | hay |$)/i,
  );
  if (!m?.[1] || !m?.[2]) return null;
  const words = m[2].trim().split(/\s+/);
  if (words.length === 0 || words[0] !== words[0][0]?.toUpperCase() + words[0].slice(1)) return null;
  const isArticle = (w: string) => ["de", "del", "la", "el", "los", "las"].includes(w.toLowerCase());
  const content = words.filter((w) => !isArticle(w));
  // "policlínica de David" (solo ciudad) no es un nombre; exige nombre propio real.
  if (isArticle(words[0]) && content.length < 2) return null;
  const name = `${m[1][0]?.toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2].trim()}`.trim();
  return name.length > 60 ? null : name;
}

function rescueQuantity(modality: Modality | null, anchor: string): number | null {
  const low = anchor.toLowerCase();
  if (modality) {
    const kw = MODALITY_KEYWORDS.find(([, m]) => m === modality)?.[0].source;
    if (kw) {
      const m = low.match(new RegExp(`${NUMBER_TOKEN}\\s*(?:de\\s+)?${kw}`, "i"));
      const n = m?.[1] ? parseNum(m[1]) : null;
      if (n && n > 0) return n;
    }
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
export function groundDraft(draft: ObservationDraft, sourceText: string): ObservationDraft {
  const low = sourceText.toLowerCase();
  const foundModalities = MODALITY_KEYWORDS.filter(([re]) => re.test(low)).map(([, m]) => m);
  const uniqueModalities = [...new Set(foundModalities)];
  // Un cliente real es un nombre corto con prefijo de instalación; lo demás es el modelo divagando.
  const rawClient = draft.client && draft.client.length <= 60 ? draft.client : null;
  const prefixed =
    rawClient && FACILITY_PREFIXES.some((p) => stripAccents(rawClient).startsWith(p)) ? rawClient : null;
  const client = prefixed ?? rescueClient(sourceText);
  const seen = new Set<string>();
  const keyOf = (e: EquipmentDraft) =>
    [e.modality, e.quantity, e.brand, e.model, e.ageYears, e.evidence].join("|");
  const isEmpty = (e: EquipmentDraft) =>
    !e.modality && e.quantity === null && !e.brand && !e.model && e.ageYears === null && !e.evidence;
  const unattributable = (e: EquipmentDraft) => !e.modality && !e.evidence;
  const items = draft.equipment.map((e) => {
      const grounded = { ...e };
      for (const field of ["brand", "model"] as const) {
        const value = grounded[field];
        if (
          value &&
          (!low.includes(value.toLowerCase()) ||
            value.length > 40 ||
            value.split(/\s+/).length > 4 ||
            MODALITY_KEYWORDS.some(([re]) => re.test(value)))
        ) {
          grounded[field] = null;
        }
      }
      if (grounded.evidence && !low.includes(grounded.evidence.toLowerCase().slice(0, 20))) {
        grounded.evidence = null;
      }
      if (!grounded.modality && grounded.evidence) {
        const anchor = grounded.evidence.toLowerCase();
        grounded.modality = MODALITY_KEYWORDS.find(([re]) => re.test(anchor))?.[1] ?? null;
      }
      // Sin evidencia solo se atribuye si el texto menciona una única modalidad.
      if (!grounded.modality && !grounded.evidence && uniqueModalities.length === 1) {
        grounded.modality = uniqueModalities[0];
      }
      // La evidencia manda: si menciona otra modalidad conocida, corrige la etiqueta.
      if (grounded.modality && grounded.evidence) {
        const anchor = grounded.evidence.toLowerCase();
        const inEvidence = MODALITY_KEYWORDS.find(([re]) => re.test(anchor))?.[1];
        if (inEvidence && inEvidence !== grounded.modality) grounded.modality = inEvidence;
      }
      // Cantidad y edad se recalculan siempre del texto: el modelo las inventa con frecuencia.
      // La edad exige atribución: evidencia o frases que mencionen esa modalidad.
      const anchor = `${grounded.evidence ?? ""} ${sourceText}`;
      grounded.quantity = rescueQuantity(grounded.modality, anchor);
      grounded.ageYears = rescueAge(
        `${grounded.evidence ?? ""} ${sentencesFor(grounded.modality, sourceText)}`,
      );
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
      items.push({
        modality: m,
        quantity: rescueQuantity(m, sourceText),
        brand: null,
        model: null,
        ageYears: null,
        evidence: null,
      });
    }
  }
  return { ...draft, client, equipment: items };
}
