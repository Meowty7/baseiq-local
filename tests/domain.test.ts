import { describe, expect, test } from "bun:test";
import { normalizeDraft, rankMissing, nextQuestion, groundDraft, toEnglishObservation, aggregate360 } from "../shared/observation";

describe("normalizeDraft", () => {
  test("acepta extracción completa y valida rangos", () => {
    const d = normalizeDraft({
      client: "Hospital DemoCare", city: "Panamá", country: "Panamá",
      equipment: [{ modality: "Resonador", quantity: 2, brand: "Scanwell", model: "Aurora", ageYears: 8, evidence: "dos resonadores" }],
      missing: [],
    });
    expect(d.client).toBe("Hospital DemoCare");
    expect(d.equipment[0].modality).toBe("resonador");
    expect(d.equipment[0].ageYears).toBe(8);
  });

  test("toEnglishObservation traduce el dominio y deja nombres propios", () => {
    const en = toEnglishObservation(
      "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo.",
    );
    expect(en).toContain("Hospital DemoCare Pacific");
    expect(en).toContain("Panamá");
    expect(en).toMatch(/MRI/);
    expect(en).toMatch(/CT/);
    expect(en).not.toMatch(/resonador|tom[oó]grafo/i);
    expect(en).toMatch(/^I am at /);
  });

  test("mapea alias ingleses de modalidad al token del schema", () => {
    const cases: [string, string][] = [
      ["CT", "tomografo"],
      ["CT scanner", "tomografo"],
      ["MRI", "resonador"],
      ["ultrasound", "ecografo"],
      ["X-ray", "rayos-x"],
      ["mammograph", "mamografo"],
      ["other", "otra"],
    ];
    for (const [raw, id] of cases) {
      const d = normalizeDraft({
        client: null, city: null, country: null,
        equipment: [{ modality: raw, quantity: 1, brand: null, model: null, ageYears: null, evidence: null }],
        missing: [],
      });
      expect(d.equipment[0].modality).toBe(id);
    }
  });

  test("convierte ausencias e inválidos a null", () => {
    const d = normalizeDraft({
      client: null, city: 42, country: null,
      equipment: [{ modality: "nave espacial", quantity: -1, brand: null, model: null, ageYears: 999, evidence: null }],
      missing: ["client", "brand"],
    });
    expect(d.city).toBeNull();
    expect(d.equipment[0].modality).toBeNull();
    expect(d.equipment[0].quantity).toBeNull();
    expect(d.equipment[0].ageYears).toBeNull();
  });
});

describe("missing priority", () => {
  test("cliente y modalidad van primero", () => {
    const d = normalizeDraft({ client: null, city: null, country: null, equipment: [], missing: ["city", "client", "ageYears"] });
    expect(rankMissing(d)[0]).toBe("client");
  });

  test("pregunta el faltante de mayor valor o null si completo", () => {
    const incomplete = normalizeDraft({ client: null, city: null, country: null, equipment: [], missing: ["brand"] });
    expect(nextQuestion(incomplete)).toContain("marca");
    const complete = normalizeDraft({ client: "H", city: null, country: null, equipment: [], missing: [] });
    expect(nextQuestion(complete)).toBeNull();
  });
});

describe("groundDraft", () => {
  const TEXT = "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo.";
  test("anula marca/modelo que no aparecen en el texto", () => {
    const d = groundDraft(normalizeDraft({
      client: "Hospital DemoCare Pacific", city: null, country: "Panamá",
      equipment: [{ modality: "resonador", quantity: 2, brand: "Eliptica", model: "E080", ageYears: null, evidence: "Vi dos resonadores" }],
      missing: [],
    }), TEXT);
    expect(d.equipment[0].brand).toBeNull();
    expect(d.equipment[0].model).toBeNull();
    expect(d.equipment[0].modality).toBe("resonador");
  });
  test("conserva marca mencionada literalmente y rescata modalidad/cantidad", () => {
    const t = "Clínica Brisa del Norte, Bogotá. Tres ecógrafos Novascan de unos cinco años.";
    const d = groundDraft(normalizeDraft({
      client: "Clínica Brisa del Norte", city: "Bogotá", country: null,
      equipment: [{ modality: null, quantity: null, brand: "Novascan", model: null, ageYears: null, evidence: "Tres ecógrafos Novascan" }],
      missing: [],
    }), t);
    expect(d.equipment[0].brand).toBe("Novascan");
    expect(d.equipment[0].modality).toBe("ecografo");
    expect(d.equipment[0].quantity).toBe(3);
  });
});

describe("grounding avanzado", () => {
  test("crea fila por modalidad mencionada sin equipo asignado", () => {
    const d = groundDraft(normalizeDraft({
      client: "Hospital DemoCare Pacific", city: null, country: "Panamá",
      equipment: [{ modality: "resonador", quantity: 2, brand: null, model: null, ageYears: null, evidence: "Vi dos resonadores" }],
      missing: [],
    }), "Estoy en Hospital DemoCare Pacific. Vi dos resonadores y un tomógrafo.");
    expect(new Set(d.equipment.map((e) => e.modality))).toEqual(new Set(["resonador", "tomografo"]));
  });
  test("resuelve rango de edad, año de instalación y equipo nuevo", () => {
    const r = groundDraft(normalizeDraft({
      client: null, city: null, country: null,
      equipment: [{ modality: null, quantity: null, brand: null, model: null, ageYears: null, evidence: null }],
      missing: [],
    }), "Dos resonadores de 8 a 10 años.");
    expect(r.equipment[0].ageYears).toBe(9);
    const y = groundDraft(normalizeDraft({
      client: null, city: null, country: null,
      equipment: [{ modality: null, quantity: null, brand: null, model: null, ageYears: null, evidence: null }],
      missing: [],
    }), "Un mamógrafo Imagix de 2019.");
    expect(y.equipment[0].ageYears).toBe(new Date().getFullYear() - 2019);
    const n = groundDraft(normalizeDraft({
      client: null, city: null, country: null,
      equipment: [{ modality: null, quantity: null, brand: null, model: null, ageYears: null, evidence: null }],
      missing: [],
    }), "Un ecógrafo nuevo.");
    expect(n.equipment[0].ageYears).toBe(0);
  });
  test("atribuye marca y edad a la modalidad correcta, no a otra", () => {
    const t = "Hospital Valle Serena en Madrid. Un tomógrafo Medtron de tres años y dos equipos de rayos X sin marca visible.";
    const d = groundDraft(normalizeDraft({
      client: "Hospital Valle Serena", city: "Madrid", country: null,
      equipment: [
        { modality: "tomografo", quantity: 1, brand: "Medtron", model: null, ageYears: 3, evidence: "Un tomógrafo Medtron" },
        { modality: "rayos-x", quantity: 1, brand: "Medtron", model: null, ageYears: 3, evidence: "dos equipos de rayos X" },
      ],
      missing: [],
    }), t);
    const tomo = d.equipment.find((e) => e.modality === "tomografo");
    const rayos = d.equipment.find((e) => e.modality === "rayos-x");
    expect(tomo?.brand).toBe("Medtron");
    expect(tomo?.ageYears).toBe(3);
    expect(tomo?.quantity).toBe(1);
    expect(rayos?.brand).toBeNull();
    expect(rayos?.ageYears).toBeNull();
    expect(rayos?.quantity).toBe(2);
  });

  test("cliente sin prefijo de instalación se anula", () => {
    const d = groundDraft(normalizeDraft({
      client: "En la policlínica de David hay tres ecógrafos", city: "David", country: null,
      equipment: [], missing: [],
    }), "En la policlínica de David, Panamá, hay tres ecógrafos.");
    expect(d.client).toBeNull();
  });
});

describe("trazabilidad", () => {
  test("appendFollowUp concatena respuesta al transcript", async () => {
    const { appendFollowUp, freshness } = await import("../shared/observation");
    expect(appendFollowUp("Vi dos resonadores.", "Son Novascan")).toBe("Vi dos resonadores.\nRespuesta: Son Novascan");
    expect(freshness(new Date().toISOString(), null)).toBe("reciente");
    expect(freshness("2020-01-01", null)).toBe("desactualizada");
    expect(freshness(null, null)).toBe("por verificar");
  });
});

describe("conflictos", () => {
  test("cantidades o marcas incompatibles generan conflicto con fechas", async () => {
    const { detectConflicts } = await import("../shared/observation");
    const base = { city: null, country: null, equipment: [], missing: [], sourceText: "t", createdAt: "2026-09-10T00:00:00.000Z", submittedBy: null, observedAt: "2026-09-10", sourceType: "visita", comments: null, confirmedAt: null } as const;
    const obs = [
      { ...base, id: 1, client: "H", status: "Reportado", equipment: [{ modality: "resonador", quantity: 2, brand: null, model: null, ageYears: null, evidence: null }] },
      { ...base, id: 2, client: "H", status: "Confirmado", equipment: [{ modality: "resonador", quantity: 5, brand: null, model: null, ageYears: null, evidence: null }] },
    ] as never;
    const [c] = detectConflicts(obs);
    expect(c.detail).toContain("cantidades distintas");
    expect(c.statuses).toEqual(["Reportado", "Confirmado"]);
  });
});

describe("aggregate360", () => {
  test("agrega por cliente×modalidad sin doble conteo", () => {
    const base = { city: null, country: "Panamá", missing: [], sourceText: "t", createdAt: "2026-09-10T00:00:00.000Z", submittedBy: null, observedAt: "2026-09-10", sourceType: "visita", comments: null, confirmedAt: null } as const;
    const obs = [
      { ...base, id: 1, client: "Hospital A", status: "Reportado", equipment: [{ modality: "resonador", quantity: 2, brand: null, model: null, ageYears: 8, evidence: null }] },
      { ...base, id: 2, client: "Hospital A", status: "Confirmado", equipment: [{ modality: "resonador", quantity: 3, brand: null, model: null, ageYears: 10, evidence: null }] },
    ] as never;
    const rows = aggregate360(obs);
    expect(rows.length).toBe(1);
    expect(rows[0].client).toBe("Hospital A");
    expect(rows[0].modality).toBe("resonador");
    expect(rows[0].quantity).toBe(5);
    expect(rows[0].ageRange).toBe("8–10");
    expect(rows[0].confidence).toBe("Confirmado");
    expect(rows[0].observations).toBe(2);
  });
});

describe("rescueClient", () => {
  test("rescata nombre con prefijo y rechaza solo-ciudad", () => {
    const empty = { client: null, city: null, country: null, equipment: [], missing: [] };
    const hit = groundDraft(normalizeDraft(empty), "Clínica Páramo Verde, Bogotá. Un mamógrafo nuevo.");
    expect(hit.client).toBe("Clínica Páramo Verde");
    const faro = groundDraft(normalizeDraft(empty), "Hospital del Faro Austral, Buenos Aires. Un resonador.");
    expect(faro.client).toBe("Hospital del Faro Austral");
    const istmo = groundDraft(normalizeDraft(empty), "Centro Médico del Istmo, Ciudad de México. Dos tomógrafos.");
    expect(istmo.client).toBe("Centro Médico del Istmo");
    const miss = groundDraft(normalizeDraft(empty), "En la policlínica de David, Panamá, hay tres ecógrafos.");
    expect(miss.client).toBeNull();
  });

  test("anula solo-ciudad aunque el modelo copie el prefijo", () => {
    const src = "En la policlínica de David, Panamá, hay tres ecógrafos.";
    for (const fake of ["Policlínica de David", "Policlínica de David, Panamá", "Polyclinic of David"]) {
      const d = groundDraft(normalizeDraft({
        client: fake, city: "David", country: "Panamá", equipment: [], missing: [],
      }), src);
      expect(d.client).toBeNull();
    }
  });
});
