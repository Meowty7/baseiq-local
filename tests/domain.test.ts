import { describe, expect, test } from "bun:test";
import { normalizeDraft, rankMissing, nextQuestion, nextQuestionField, groundDraft, toEnglishObservation, aggregate360 } from "../shared/observation";

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

  test("modalidad y cantidad ganan a ciudad/país", () => {
    const d = normalizeDraft({ client: "H", city: null, country: null, equipment: [], missing: ["city", "country", "modality"] });
    expect(nextQuestionField(d)?.field).toBe("modality");
  });

  test("ciudad y país se agrupan en una sola pregunta de ubicación", () => {
    const d = normalizeDraft({ client: "H", city: null, country: null, equipment: [], missing: ["city", "country"] });
    expect(rankMissing(d)).toEqual(["location"]);
    expect(nextQuestion(d)).toMatch(/ciudad.*país|city.*country/i);
  });

  test("una marca faltante pesa más que una antigüedad faltante", () => {
    const d = normalizeDraft({
      client: "H", city: "C", country: "P",
      equipment: [
        { modality: "resonador", quantity: 1, brand: null, model: "X", ageYears: 3, evidence: null },
        { modality: "tomografo", quantity: 1, brand: null, model: "Y", ageYears: null, evidence: null },
      ],
      missing: ["brand.0", "brand.1", "ageYears.1"],
    });
    expect(nextQuestionField(d)?.field).toBe("brand");
  });

  test("marca faltante en varios equipos se pregunta uno por uno, en orden, no agrupada", () => {
    const d = normalizeDraft({
      client: "H", city: "C", country: "P",
      equipment: [
        { modality: "resonador", quantity: 1, brand: null, model: null, ageYears: null, evidence: null },
        { modality: "tomografo", quantity: 1, brand: null, model: null, ageYears: null, evidence: null },
      ],
      missing: ["brand.0", "brand.1"],
    });
    // Both rows keep their own candidate — asked in equipment order, not collapsed into one generic question.
    expect(rankMissing(d)).toEqual(["brand.0", "brand.1"]);
    expect(nextQuestionField(d)).toEqual({ field: "brand", equipmentIndex: 0 });
    expect(nextQuestion(d)).toContain("1");
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

  test("el borrador revisado conserva 200 resonadores; re-blindar el texto los puede borrar", () => {
    const raw = {
      client: "Hospital DemoCare", city: null, country: "Panamá",
      equipment: [{ modality: "resonador", quantity: 200, brand: null, model: null, ageYears: null, evidence: null }],
      missing: [],
    };
    const kept = normalizeDraft(raw);
    expect(kept.equipment[0].quantity).toBe(200);
    const wiped = groundDraft(kept, "Estoy en Hospital DemoCare. Revisar inventario.", "I am at Hospital DemoCare.");
    expect(wiped.equipment.some((e) => e.modality === "resonador" && e.quantity === 200)).toBe(false);
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

  test("anula cliente alucinado del prompt que no está en el texto", () => {
    const src = "Estoy en la Cl[inica hospital de san fernando en panama. Tienen 5 tomografos.";
    const d = groundDraft(normalizeDraft({
      client: "Hospital X", city: "Panamá", country: "Panamá", equipment: [], missing: [],
    }), src);
    expect(d.client).toBe("Clinica Hospital de San Fernando");
  });

  test("maneja notas complejas sin robar cantidades ni edad entre modalidades", () => {
    const src = "Estoy en la Cl[inica hospital de san fernando en panama, tienen 5 tomografos, 2 tomografos y 1 tomografo, 5 mamografos nuevos, uno de los tomografos me comentaron despues que esta obsoleto, tinene varios equipos de rayos X";
    const d = groundDraft(normalizeDraft({
      client: null, city: "Panama", country: "Panama", equipment: [], missing: [],
    }), src);
    expect(d.client).toBe("Clinica Hospital de San Fernando");
    const ct = d.equipment.find((e) => e.modality === "tomografo");
    const mam = d.equipment.find((e) => e.modality === "mamografo");
    const rx = d.equipment.find((e) => e.modality === "rayos-x");
    expect(ct?.quantity).toBe(5);
    expect(ct?.ageYears).toBeNull();
    expect(mam?.quantity).toBe(5);
    expect(mam?.ageYears).toBe(0);
    expect(rx?.quantity).toBeNull();
  });
});

const emptyDraft = { client: null, city: null, country: null, equipment: [], missing: [] };
const hostileDraft = {
  client: "Saint Jude", city: "Atlantis", country: "Narnia",
  equipment: [{ modality: "CT", quantity: 1, brand: "Eliptica", model: "E080", ageYears: 3, evidence: "I saw CT" }],
  missing: [],
};

describe("geo grounding", () => {
  test("anula ciudad/país que no son literales del texto", () => {
    const d = groundDraft(normalizeDraft({
      ...emptyDraft, city: "Madrid", country: "España",
    }), "Vi dos resonadores.");
    expect(d.city).toBeNull();
    expect(d.country).toBeNull();
  });

  test("rescata pares por gramática en lugares que no están en ningún listado", () => {
    const jp = groundDraft(normalizeDraft(hostileDraft),
      "Hospital Kawa Norte, Kyoto, Japón. Un tomógrafo.");
    expect(jp.city).toBe("Kyoto");
    expect(jp.country).toBe("Japón");
    expect(jp.client).toBe("Hospital Kawa Norte");
    const fr = groundDraft(normalizeDraft(emptyDraft),
      "Estoy en Clínica Luz Roja, en Lyon, Francia. Vi un resonador.");
    expect(fr.city).toBe("Lyon");
    expect(fr.country).toBe("Francia");
  });

  test("coma+en es país; en sin coma es ciudad; de Ciudad, País es ambos", () => {
    const ke = groundDraft(normalizeDraft(emptyDraft),
      "Estoy en Hospital Pino Alto, en Nairobi. Vi un resonador.");
    expect(ke.city).toBeNull();
    expect(ke.country).toBe("Nairobi");
    const no = groundDraft(normalizeDraft(emptyDraft),
      "Hospital Fjord Vest en Bergen. Un ecógrafo.");
    expect(no.city).toBe("Bergen");
    expect(no.country).toBeNull();
    const de = groundDraft(normalizeDraft(emptyDraft),
      "En la policlínica de Arequipa, Perú, hay dos mamógrafos.");
    expect(de.client).toBeNull();
    expect(de.city).toBe("Arequipa");
    expect(de.country).toBe("Perú");
  });

  test("si el modelo copia un prefijo, completa el tramo que está en el texto", () => {
    const d = groundDraft(normalizeDraft({
      ...emptyDraft, city: "Santiago", country: "Chile",
    }), "Visité la Clínica Roble Alto en Santiago de Chile: dos tomógrafos.");
    expect(d.city).toBe("Santiago de Chile");
    expect(d.country).toBe("Chile");
  });
});

describe("follow-up y cantidades largas", () => {
  test("ancla marca y edad de Respuesta al transcript", () => {
    const src = "Hospital Delta Este, Córdoba. Un ecógrafo, no sé la marca.\nRespuesta: Es Novascan, de tres años.";
    const d = groundDraft(normalizeDraft({
      client: "Hospital Delta Este", city: "Córdoba", country: null,
      equipment: [{ modality: "ecografo", quantity: 1, brand: "Novascan", model: null, ageYears: null, evidence: "Un ecógrafo" }],
      missing: [],
    }), src);
    expect(d.equipment[0].brand).toBe("Novascan");
    expect(d.equipment[0].ageYears).toBe(3);
  });

  test("rescata once como cantidad 11", () => {
    const d = groundDraft(normalizeDraft(emptyDraft), "Hospital Duna Roja, Temuco. Tienen once tomógrafos y un mamógrafo.");
    expect(d.equipment.find((e) => e.modality === "tomografo")?.quantity).toBe(11);
  });

  test("compone centenas y decenas en español, no un caso suelto", () => {
    const src = "Hospital DemoCare Pacific, en Panamá. Vi doscientos resonadores y un tomógrafo. Uno de los resonadores parece de unos ocho años.";
    const d = groundDraft(normalizeDraft(emptyDraft), src);
    expect(d.equipment.find((e) => e.modality === "resonador")?.quantity).toBe(200);
    expect(d.equipment.find((e) => e.modality === "tomografo")?.quantity).toBe(1);
    expect(d.equipment.find((e) => e.modality === "resonador")?.ageYears).toBe(8);
    const composed = groundDraft(normalizeDraft(emptyDraft), "Clínica Norte. Hay treinta y cinco mamógrafos.");
    expect(composed.equipment.find((e) => e.modality === "mamografo")?.quantity).toBe(35);
    expect(groundDraft(normalizeDraft(emptyDraft), "Hospital Sur. Vi doscientos treinta y cinco ecógrafos.")
      .equipment.find((e) => e.modality === "ecografo")?.quantity).toBe(235);
    expect(toEnglishObservation("Vi doscientos resonadores.")).toMatch(/200/);
    expect(toEnglishObservation("Vi doscientos resonadores.")).not.toMatch(/two cientos|doscientos/i);
    expect(toEnglishObservation("Hay treinta y cinco mamógrafos.")).toMatch(/35/);
  });
});

describe("borrador hostil", () => {
  test("no deja pasar cliente/geo/marca inventados", () => {
    const d = groundDraft(normalizeDraft(hostileDraft),
      "Estoy en Hospital Cerro Norte, Quito. Vi un tomógrafo y dos ecógrafos, no sé las marcas.");
    expect(d.client).toBe("Hospital Cerro Norte");
    expect(d.city).toBeNull();
    expect(d.country).toBeNull();
    expect(d.equipment.every((e) => e.brand === null)).toBe(true);
    expect(new Set(d.equipment.map((e) => e.modality))).toEqual(new Set(["tomografo", "ecografo"]));
  });
});

describe("review fixes", () => {
  test("de marca, país no pisa la ciudad del modelo", () => {
    const d = groundDraft(normalizeDraft({
      ...emptyDraft, city: "Cali",
      equipment: [{ modality: "tomografo", quantity: 1, brand: null, model: null, ageYears: null, evidence: null }],
    }), "Hospital Paso Ancho, Cali. Un tomógrafo de Siemens, Alemania.");
    expect(d.city).toBe("Cali");
    expect(d.country).toBeNull();
  });

  test("de dentro del nombre del hospital no pisa Lima", () => {
    const d = groundDraft(normalizeDraft({
      ...emptyDraft, city: "Lima",
    }), "Hospital Nuestra Señora de Fátima, Lima. Un tomógrafo.");
    expect(d.city).toBe("Lima");
    expect(d.client).toBe("Hospital Nuestra Señora de Fátima");
  });

  test("en posterior no roba una ciudad ya dicha; Mar del Plata queda entero", () => {
    const steal = groundDraft(normalizeDraft({ ...emptyDraft, city: "Barranquilla" }),
      "Clínica Puerto Claro, Barranquilla. En Bogotá vi tres tomógrafos.");
    expect(steal.city).toBe("Barranquilla");
    const mar = groundDraft(normalizeDraft(emptyDraft),
      "Hospital Costa Brava en Mar del Plata. Un resonador.");
    expect(mar.city).toBe("Mar del Plata");
  });

  test("Respuesta con año o sala no vira cantidad; son once sí", () => {
    const year = groundDraft(normalizeDraft(emptyDraft),
      "Hospital Alfa, Lima, Perú. Tienen varios tomógrafos.\nRespuesta: Son del 2018.");
    expect(year.equipment.find((e) => e.modality === "tomografo")?.quantity).toBeNull();
    const sala = groundDraft(normalizeDraft(emptyDraft),
      "Clínica Puerto Claro, Barranquilla. Hay varios ecógrafos.\nRespuesta: Están en la sala 12.");
    expect(sala.equipment.find((e) => e.modality === "ecografo")?.quantity).toBeNull();
    const once = groundDraft(normalizeDraft(emptyDraft),
      "Hospital Duna. Un tomógrafo.\nRespuesta: En realidad son once.");
    expect(once.equipment.find((e) => e.modality === "tomografo")?.quantity).toBe(11);
  });

  test("Respuesta aporta marca aunque el modelo no la haya puesto", () => {
    const d = groundDraft(normalizeDraft({
      ...emptyDraft,
      equipment: [{ modality: "ecografo", quantity: 1, brand: null, model: null, ageYears: null, evidence: "Un ecógrafo" }],
    }), "Hospital Delta Este, Córdoba. Un ecógrafo, no sé la marca.\nRespuesta: Es Novascan, de tres años.");
    expect(d.equipment[0].brand).toBe("Novascan");
    expect(d.equipment[0].ageYears).toBe(3);
  });

  test("acceptGeo rechaza marca, hospital y fragmento del nombre", () => {
    const brand = groundDraft(normalizeDraft({ ...emptyDraft, city: "Novascan" }),
      "Hospital Paso Ancho, Medellín, Colombia. Un resonador Novascan.");
    expect(brand.city).toBe("Medellín");
    expect(brand.country).toBe("Colombia");
    const fac = groundDraft(normalizeDraft({ ...emptyDraft, city: "Hospital" }),
      "Estoy en Hospital Pino Alto, en Nairobi. Vi un resonador.");
    expect(fac.city).toBeNull();
    expect(fac.country).toBe("Nairobi");
    const chip = groundDraft(normalizeDraft({ ...emptyDraft, city: "Cerro" }),
      "Estoy en Hospital Cerro Norte, Quito. Vi un tomógrafo.");
    expect(chip.city).toBeNull();
  });

  test("veinticinco no es cinco; Duna no es un", () => {
    const v = groundDraft(normalizeDraft(emptyDraft),
      "Hospital Duna Roja, Temuco. Tienen veinticinco tomógrafos.");
    expect(v.equipment.find((e) => e.modality === "tomografo")?.quantity).not.toBe(5);
    const d = groundDraft(normalizeDraft(emptyDraft),
      "Hospital Alfa. En Duna Alta tienen varios tomógrafos.");
    expect(d.equipment.find((e) => e.modality === "tomografo")?.quantity).toBeNull();
  });

  test("apósito no geo se salta; últimos dos slots son ciudad/país", () => {
    const d = groundDraft(normalizeDraft(emptyDraft),
      "Hospital Santa Fe, Cardiología, Bogotá, Colombia. Un tomógrafo.");
    expect(d.city).toBe("Bogotá");
    expect(d.country).toBe("Colombia");
  });

  test("Hospital de Paitilla no es clínica-de-ciudad; mamografía cuenta", () => {
    const src = "Estoy en el Hospital de Paitilla en Ciudad de Panamá. Vi que tenian 5 mamografía, 3 de 5 años de antigüedad, 2 nuevos. 2 tomografos en el piso 1 y otros 4 tomografos en el piso 2";
    const d = groundDraft(normalizeDraft(emptyDraft), src);
    expect(d.client).toBe("Hospital de Paitilla");
    expect(d.city).toBe("Ciudad de Panamá");
    expect(d.equipment.find((e) => e.modality === "mamografo")?.quantity).toBe(5);
    expect(d.equipment.find((e) => e.modality === "tomografo")?.quantity).toBe(2);
    const poli = groundDraft(normalizeDraft(emptyDraft), "En la policlínica de David, Panamá, hay tres ecógrafos.");
    expect(poli.client).toBeNull();
  });

  test("grounding EN post-NMT: Hospital al final, two/eight years, no Hospital Panama", () => {
    const en = "I am at DemoCare Pacific Hospital in Panama. I saw two MRI devices and a CT scanner. One of the MRI devices looks about eight years old.";
    const de = "Ich bin im DemoCare Pacific Hospital in Panama. Ich habe zwei MRT-Geräte und einen CT-Scanner gesehen. Eines der MRT-Geräte sieht etwa acht Jahre alt aus.";
    const d = groundDraft(normalizeDraft({
      client: "Hospital Panama", city: null, country: "Panama",
      equipment: [
        { modality: "MRI", quantity: null, brand: null, model: null, ageYears: null, evidence: "MRI" },
        { modality: "CT", quantity: null, brand: null, model: null, ageYears: null, evidence: "CT" },
      ],
      missing: [],
    }), `${de}\n${en}`, en);
    expect(d.client).toMatch(/DemoCare Pacific Hospital/i);
    expect(d.client).not.toMatch(/hospital panama/i);
    const mri = d.equipment.find((e) => e.modality === "resonador");
    const ct = d.equipment.find((e) => e.modality === "tomografo");
    expect(mri?.quantity).toBe(2);
    expect(mri?.ageYears).toBe(8);
    expect(ct?.quantity).toBe(1);
    expect(ct?.ageYears).toBeNull();
  });

  test("sin equipos no deja un CT del few-shot", () => {
    const d = groundDraft(normalizeDraft(hostileDraft),
      "Estuve en Hospital Nube Gris, Cartagena, Colombia. No vi equipos de imagen, solo la sala de espera.");
    expect(d.equipment).toEqual([]);
    expect(d.city).toBe("Cartagena");
    expect(d.country).toBe("Colombia");
  });
});
