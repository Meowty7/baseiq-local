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
      const modality = typeof o.modality === "string" ? o.modality.toLowerCase() : null;
      return {
        modality: (MODALITIES as readonly string[]).includes(modality ?? "") ? (modality as Modality) : null,
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

const NUMBER_WORDS: [RegExp, number][] = [
  [/un(o|a)?\s/i, 1],
  [/dos\s/i, 2],
  [/tres\s/i, 3],
  [/cuatro\s/i, 4],
  [/cinco\s/i, 5],
  [/seis\s/i, 6],
];

// ponytail: los modelos Q4 pequeños alucinan marcas y confunden modalidad.
// Estas reglas blindan el borrador: solo vale lo que aparece literal en el texto,
// y la modalidad/cantidad se rescatan por palabras clave en español.
export function groundDraft(draft: ObservationDraft, sourceText: string): ObservationDraft {
  const low = sourceText.toLowerCase();
  const foundModalities = MODALITY_KEYWORDS.filter(([re]) => re.test(low)).map(([, m]) => m);
  const uniqueModalities = [...new Set(foundModalities)];
  // Un cliente real es un nombre corto; una oración completa es el modelo divagando.
  const client = draft.client && draft.client.length > 60 ? null : draft.client;
  return {
    ...draft,
    client,
    equipment: draft.equipment.map((e) => {
      const grounded = { ...e };
      for (const field of ["brand", "model"] as const) {
        const value = grounded[field];
        if (value && (!low.includes(value.toLowerCase()) || value.length > 40 || value.split(/\s+/).length > 4)) {
          grounded[field] = null;
        }
      }
      if (grounded.evidence && !low.includes(grounded.evidence.toLowerCase().slice(0, 20))) {
        grounded.evidence = null;
      }
      if (!grounded.modality && uniqueModalities.length >= 1) {
        const anchor = grounded.evidence ? grounded.evidence.toLowerCase() : "";
        const inEvidence = MODALITY_KEYWORDS.find(([re]) => re.test(anchor))?.[1];
        grounded.modality = inEvidence ?? uniqueModalities[0];
      }
      // La evidencia manda: si menciona otra modalidad conocida, corrige la etiqueta.
      if (grounded.modality && grounded.evidence) {
        const anchor = grounded.evidence.toLowerCase();
        const inEvidence = MODALITY_KEYWORDS.find(([re]) => re.test(anchor))?.[1];
        if (inEvidence && inEvidence !== grounded.modality) grounded.modality = inEvidence;
      }
      if (grounded.quantity === null) {
        const anchor = `${grounded.evidence ?? ""} ${sourceText}`.toLowerCase();
        const word = NUMBER_WORDS.find(([re]) => re.test(anchor))?.[1];
        const digit = anchor.match(/(\d+)\s*(resonador|tom[oó]grafo|ec[oó]grafo|equipo)/)?.[1];
        grounded.quantity = digit ? Number(digit) : (word ?? null);
      }
      if (grounded.ageYears === null) {
        const anchor = `${grounded.evidence ?? ""} ${sourceText}`.toLowerCase();
        const years = anchor.match(/(\d{1,2})\s*a[ñn]os/)?.[1];
        if (years) grounded.ageYears = Number(years);
      }
      return grounded;
    }),
  };
}
