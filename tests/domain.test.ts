import { describe, expect, test } from "bun:test";
import { normalizeDraft, rankMissing, nextQuestion, groundDraft } from "../shared/observation";

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

describe("rescueClient", () => {
  test("rescata nombre con prefijo y rechaza solo-ciudad", async () => {
    const { groundDraft, normalizeDraft } = await import("../shared/observation");
    const empty = { client: null, city: null, country: null, equipment: [], missing: [] };
    const hit = groundDraft(normalizeDraft(empty), "Clínica Páramo Verde, Bogotá. Un mamógrafo nuevo.");
    expect(hit.client).toBe("Clínica Páramo Verde");
    const miss = groundDraft(normalizeDraft(empty), "En la policlínica de David, Panamá, hay tres ecógrafos.");
    expect(miss.client).toBeNull();
  });
});
