import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, saveObservation, listObservations } from "../server/db";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

describe("observations", () => {
  test("guarda observación con equipos en transacción", () => {
    const id = saveObservation(db,
      { client: "Hospital DemoCare", city: "Panamá", country: "Panamá", status: "Reportado", sourceText: "dos resonadores" },
      [{ modality: "resonador", quantity: 2, brand: null, model: null, ageYears: 8, evidence: "dos resonadores" }]);
    expect(id).toBeGreaterThan(0);
    const all = listObservations(db);
    expect(all).toHaveLength(1);
    expect(all[0].equipment).toHaveLength(1);
    expect(all[0].equipment[0].quantity).toBe(2);
  });

  test("reutiliza cliente existente sin duplicar", () => {
    const input = { client: "H", city: null, country: null, status: "Reportado" as const, sourceText: "t" };
    saveObservation(db, input, []);
    saveObservation(db, input, []);
    const clients = db.query("SELECT COUNT(*) AS n FROM clients;").get() as { n: number };
    expect(clients.n).toBe(1);
    expect(listObservations(db)).toHaveLength(2);
  });
});
