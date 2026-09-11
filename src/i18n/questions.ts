export const QUESTION_FIELDS = [
  "client",
  "modality",
  "quantity",
  "location",
  "city",
  "country",
  "brand",
  "model",
  "ageYears",
  "brand.n",
  "model.n",
  "ageYears.n",
] as const;

export type QuestionField = (typeof QUESTION_FIELDS)[number];

export const QUESTIONS: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    client: "¿En qué hospital o clínica se hizo la observación?",
    modality: "¿Qué tipo de equipo viste (resonador, tomógrafo, ecógrafo)?",
    quantity: "¿Cuántos equipos de ese tipo hay?",
    location: "¿En qué ciudad y país está el cliente?",
    city: "¿En qué ciudad está el cliente?",
    country: "¿En qué país está el cliente?",
    brand: "¿De qué marca es el equipo?",
    model: "¿Cuál es el modelo del equipo?",
    ageYears: "¿Qué antigüedad aproximada tiene el equipo (años)?",
    "brand.n": "¿De qué marca es el equipo {n}?",
    "model.n": "¿Cuál es el modelo del equipo {n}?",
    "ageYears.n": "¿Qué antigüedad aproximada tiene el equipo {n} (años)?",
  },
  en: {
    client: "Which hospital or clinic was this observation made at?",
    modality: "What type of equipment did you see (MRI, CT, ultrasound)?",
    quantity: "How many units of that type are there?",
    location: "Which city and country is the client in?",
    city: "Which city is the client in?",
    country: "Which country is the client in?",
    brand: "What brand is the equipment?",
    model: "What is the equipment model?",
    ageYears: "Approximately how old is the equipment (in years)?",
    "brand.n": "What brand is equipment {n}?",
    "model.n": "What is the model of equipment {n}?",
    "ageYears.n": "Approximately how old is equipment {n} (in years)?",
  },
};

const questionOverlay: Record<string, Record<string, string>> = {};

export function setQuestionOverlay(lang: string, map: Record<string, string> | null): void {
  if (!map) delete questionOverlay[lang];
  else questionOverlay[lang] = map;
}

export function getQuestionOverlay(lang: string): Record<string, string> | undefined {
  return questionOverlay[lang];
}

export function getQuestion(field: string, lang = "es", equipmentNumber?: number): string {
  const key = equipmentNumber != null && `${field}.n` in QUESTIONS.es ? `${field}.n` : field;
  const fallback = lang === "es"
    ? `¿Puedes precisar ${field}?`
    : `Can you specify ${field}?`;
  const template = questionOverlay[lang]?.[key]
    ?? QUESTIONS[lang as "es" | "en"]?.[key]
    ?? QUESTIONS.en[key]
    ?? QUESTIONS.es[key]
    ?? fallback;
  return equipmentNumber != null ? template.replace("{n}", String(equipmentNumber)) : template;
}
