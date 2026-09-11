import { expect, mock, test } from "bun:test";

let imageHandler: (system: string, user: string, imagePath: string, schema: object) => Promise<{ text: string; inferMs: number }>;

const calls: { system: string; user: string; imagePath: string; schema: object }[] = [];

mock.module("../src/lib/qvac", () => ({
  inferJson: async () => ({ text: "{}", inferMs: 0 }),
  translateNote: async () => "",
  inferJsonWithImage: async (system: string, user: string, imagePath: string, schema: object) => {
    calls.push({ system, user, imagePath, schema });
    return imageHandler(system, user, imagePath, schema);
  },
}));

const extraction = await import("../src/lib/extraction");

test("extractObservationFromImage pasa el path de la imagen como attachment y blinda contra la evidencia", async () => {
  calls.length = 0;
  imageHandler = async () => ({
    text: JSON.stringify({
      client: "Hospital DemoCare Pacific",
      city: null,
      country: "Panama",
      equipment: [
        { modality: "MRI", quantity: 2, brand: "Siemens", model: null, ageYears: 8, evidence: "Siemens MRI 2 units" },
        { modality: "CT", quantity: 1, brand: null, model: null, ageYears: null, evidence: "CT scanner" },
      ],
      missing: [],
    }),
    inferMs: 120,
  });
  const { draft, question, inferMs } = await extraction.extractObservationFromImage("/tmp/fake-nameplate.jpg", "es");
  expect(calls.length).toBe(1);
  expect(calls[0].imagePath).toBe("/tmp/fake-nameplate.jpg");
  expect(inferMs).toBe(120);
  expect(draft.client).toBe("Hospital DemoCare Pacific");
  const mri = draft.equipment.find((e) => e.modality === "resonador");
  const ct = draft.equipment.find((e) => e.modality === "tomografo");
  expect(mri?.quantity).toBe(2);
  expect(mri?.brand).toBe("Siemens");
  expect(mri?.ageYears).toBe(8);
  expect(ct?.quantity).toBe(1);
  expect(ct?.brand).toBeNull();
  expect(question).toBeTypeOf("string");
});

test("extractObservationFromImage anula marca que no aparece en la evidencia del VLM", async () => {
  calls.length = 0;
  imageHandler = async () => ({
    text: JSON.stringify({
      client: null, city: null, country: null,
      equipment: [{ modality: "CT", quantity: 1, brand: "Philips", model: null, ageYears: null, evidence: "CT scanner" }],
      missing: [],
    }),
    inferMs: 50,
  });
  const { draft } = await extraction.extractObservationFromImage("/tmp/fake2.jpg", "es");
  const ct = draft.equipment.find((e) => e.modality === "tomografo");
  expect(ct?.brand).toBeNull();
});
