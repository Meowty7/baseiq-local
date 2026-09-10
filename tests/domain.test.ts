import { describe, expect, test } from "bun:test";
import { normalizeDraft, rankMissing, nextQuestion, groundDraft } from "../shared/observation";

describe("normalizeDraft", () => {
  test("acepta extracción completa y valida rangos", () => {
    const d = normalizeDraft({
      client: "Hospital DemoCare", city: "Panamá", country: "Panamá",
      equipment: [{ modality: "Resonador", quantity: 2, brand: "Philips", model: "Ingenia", ageYears: 8, evidence: "dos resonadores" }],
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
    const t = "Clínica Santa Fe, Bogotá. Tres ecógrafos GE de unos cinco años.";
    const d = groundDraft(normalizeDraft({
      client: "Clínica Santa Fe", city: "Bogotá", country: null,
      equipment: [{ modality: null, quantity: null, brand: "GE", model: null, ageYears: null, evidence: "Tres ecógrafos GE" }],
      missing: [],
    }), t);
    expect(d.equipment[0].brand).toBe("GE");
    expect(d.equipment[0].modality).toBe("ecografo");
    expect(d.equipment[0].quantity).toBe(3);
  });
});
