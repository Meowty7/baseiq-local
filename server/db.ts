import { mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import type { ObservationRecord, ObservationStatus } from "../shared/observation";

let db: Database | null = null;

export function getDb(path = "./data/baseiq.sqlite"): Database {
  if (!db) {
    mkdirSync("./data", { recursive: true });
    db = new Database(path, { create: true });
    db.run("PRAGMA journal_mode = WAL;");
    db.run("PRAGMA foreign_keys = ON;");
    migrate(db);
  }
  return db;
}

export function migrate(d: Database): void {
  d.run(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    city TEXT, country TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  d.run(`CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    city TEXT, country TEXT, status TEXT NOT NULL DEFAULT 'Reportado',
    source_text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  for (const col of ["submitted_by TEXT", "observed_at TEXT", "source_type TEXT", "comments TEXT", "confirmed_at TEXT"]) {
    const name = col.split(" ")[0];
    const exists = d.query(`SELECT 1 FROM pragma_table_info('observations') WHERE name = ?;`).get(name);
    if (!exists) d.run(`ALTER TABLE observations ADD COLUMN ${col};`);
  }
  d.run(`CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
    modality TEXT, quantity INTEGER, brand TEXT, model TEXT,
    age_years INTEGER, evidence TEXT
  );`);
  d.run(`CREATE INDEX IF NOT EXISTS idx_obs_client ON observations(client_id);`);
  d.run(`CREATE INDEX IF NOT EXISTS idx_eq_obs ON equipment(observation_id);`);
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export function saveObservation(
  d: Database,
  input: { client: string; city: string | null; country: string | null; status: ObservationStatus; sourceText: string; submittedBy: string | null; observedAt: string | null; sourceType: string | null; comments: string | null; confirmedAt: string | null },
  equipment: { modality: string | null; quantity: number | null; brand: string | null; model: string | null; ageYears: number | null; evidence: string | null }[],
): number {
  const tx = d.transaction(() => {
    d.run("INSERT INTO clients (name, city, country) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING;",
      [input.client, input.city, input.country]);
    const client = d.query("SELECT id FROM clients WHERE name = ?;").get(input.client) as { id: number };
    const obs = d.run(
      "INSERT INTO observations (client_id, city, country, status, source_text, submitted_by, observed_at, source_type, comments, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      [client.id, input.city, input.country, input.status, input.sourceText, input.submittedBy, input.observedAt, input.sourceType, input.comments, input.confirmedAt]);
    const obsId = Number(obs.lastInsertRowid);
    for (const e of equipment) {
      d.run(
        "INSERT INTO equipment (observation_id, modality, quantity, brand, model, age_years, evidence) VALUES (?, ?, ?, ?, ?, ?, ?);",
        [obsId, e.modality, e.quantity, e.brand, e.model, e.ageYears, e.evidence]);
    }
    return obsId;
  });
  return tx() as number;
}

export function listObservations(d: Database): ObservationRecord[] {
  const rows = d.query(`SELECT o.id, c.name AS client, o.city, o.country, o.status, o.source_text, o.created_at,
    o.submitted_by, o.observed_at, o.source_type, o.comments, o.confirmed_at
    FROM observations o JOIN clients c ON c.id = o.client_id ORDER BY o.id DESC;`).all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    client: r.client as string,
    city: (r.city as string) ?? null,
    country: (r.country as string) ?? null,
    status: r.status as ObservationRecord["status"],
    sourceText: r.source_text as string,
    createdAt: r.created_at as string,
    submittedBy: (r.submitted_by as string) ?? null,
    observedAt: (r.observed_at as string) ?? null,
    sourceType: (r.source_type as string) ?? null,
    comments: (r.comments as string) ?? null,
    confirmedAt: (r.confirmed_at as string) ?? null,
    equipment: d.query("SELECT modality, quantity, brand, model, age_years AS ageYears, evidence FROM equipment WHERE observation_id = ?;")
      .all(r.id) as ObservationRecord["equipment"],
    missing: [],
  }));
}
