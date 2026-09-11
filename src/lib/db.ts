import * as FileSystem from "expo-file-system";
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import type { ObservationRecord, ObservationStatus } from "../../shared/observation";

let db: SQLiteDatabase | null = null;

export function getDb(): SQLiteDatabase {
  if (!db) {
    const dir = `${FileSystem.documentDirectory}data`;
    // ponytail: sync mkdir; expo-file-system doesn't have sync mkdir, but SQLite ensures the path.
    db = openDatabaseSync("baseiq.sqlite");
    db.execSync("PRAGMA journal_mode = WAL;");
    db.execSync("PRAGMA foreign_keys = ON;");
    migrate(db);
  }
  return db;
}

export function migrate(d: SQLiteDatabase): void {
  d.execSync(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    city TEXT, country TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  d.execSync(`CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    city TEXT, country TEXT, status TEXT NOT NULL DEFAULT 'Reportado',
    source_text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  for (const col of ["submitted_by TEXT", "observed_at TEXT", "source_type TEXT", "comments TEXT", "confirmed_at TEXT"]) {
    const name = col.split(" ")[0];
    const exists = d.getFirstSync(`SELECT 1 FROM pragma_table_info('observations') WHERE name = ?;`, name);
    if (!exists) d.execSync(`ALTER TABLE observations ADD COLUMN ${col};`);
  }
  d.execSync(`CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
    modality TEXT, quantity INTEGER, brand TEXT, model TEXT,
    age_years INTEGER, evidence TEXT
  );`);
  d.execSync(`CREATE INDEX IF NOT EXISTS idx_obs_client ON observations(client_id);`);
  d.execSync(`CREATE INDEX IF NOT EXISTS idx_eq_obs ON equipment(observation_id);`);
}

export function closeDb(): void {
  db?.closeSync();
  db = null;
}

export function clearAll(d: SQLiteDatabase): void {
  d.execSync("DELETE FROM equipment;");
  d.execSync("DELETE FROM observations;");
  d.execSync("DELETE FROM clients;");
}

export function saveObservation(
  d: SQLiteDatabase,
  input: { client: string; city: string | null; country: string | null; status: ObservationStatus; sourceText: string; submittedBy: string | null; observedAt: string | null; sourceType: string | null; comments: string | null; confirmedAt: string | null },
  equipment: { modality: string | null; quantity: number | null; brand: string | null; model: string | null; ageYears: number | null; evidence: string | null }[],
): number {
  return d.withTransactionSync(() => {
    d.runSync("INSERT INTO clients (name, city, country) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING;",
      [input.client, input.city, input.country]);
    const client = d.getFirstSync("SELECT id FROM clients WHERE name = ?;", input.client) as { id: number };
    const res = d.runSync(
      "INSERT INTO observations (client_id, city, country, status, source_text, submitted_by, observed_at, source_type, comments, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
      [client.id, input.city, input.country, input.status, input.sourceText, input.submittedBy, input.observedAt, input.sourceType, input.comments, input.confirmedAt]);
    const obsId = Number(res.lastInsertRowId);
    for (const e of equipment) {
      d.runSync(
        "INSERT INTO equipment (observation_id, modality, quantity, brand, model, age_years, evidence) VALUES (?, ?, ?, ?, ?, ?, ?);",
        [obsId, e.modality, e.quantity, e.brand, e.model, e.ageYears, e.evidence]);
    }
    return obsId;
  });
}

export function updateObservationClient(
  d: SQLiteDatabase, id: number, clientName: string, city: string | null, country: string | null,
): void {
  d.withTransactionSync(() => {
    d.runSync("INSERT INTO clients (name, city, country) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING;",
      [clientName, city, country]);
    const client = d.getFirstSync("SELECT id FROM clients WHERE name = ?;", clientName) as { id: number };
    d.runSync("UPDATE observations SET client_id = ? WHERE id = ?;", [client.id, id]);
  });
}

const OBSERVATION_COLUMNS: Record<string, string> = {
  city: "city", country: "country", status: "status", submittedBy: "submitted_by",
  observedAt: "observed_at", sourceType: "source_type", comments: "comments", confirmedAt: "confirmed_at",
};

export function updateObservation(
  d: SQLiteDatabase, id: number,
  fields: Partial<{ city: string | null; country: string | null; status: ObservationStatus; submittedBy: string | null; observedAt: string | null; sourceType: string | null; comments: string | null; confirmedAt: string | null }>,
): void {
  const entries = Object.entries(fields).filter(([k]) => k in OBSERVATION_COLUMNS);
  if (entries.length === 0) return;
  const sets = entries.map(([k]) => `${OBSERVATION_COLUMNS[k]} = ?`).join(", ");
  const values = entries.map(([, v]) => v as string | number | null);
  d.runSync(`UPDATE observations SET ${sets} WHERE id = ?;`, [...values, id]);
}

export function updateEquipment(
  d: SQLiteDatabase, observationId: number,
  equipment: { modality: string | null; quantity: number | null; brand: string | null; model: string | null; ageYears: number | null; evidence: string | null }[],
): void {
  d.withTransactionSync(() => {
    d.runSync("DELETE FROM equipment WHERE observation_id = ?;", [observationId]);
    for (const e of equipment) {
      d.runSync(
        "INSERT INTO equipment (observation_id, modality, quantity, brand, model, age_years, evidence) VALUES (?, ?, ?, ?, ?, ?, ?);",
        [observationId, e.modality, e.quantity, e.brand, e.model, e.ageYears, e.evidence]);
    }
  });
}

export function deleteObservation(d: SQLiteDatabase, id: number): void {
  d.runSync("DELETE FROM observations WHERE id = ?;", [id]);
}

export function listObservations(d: SQLiteDatabase): ObservationRecord[] {
  const rows = d.getAllSync(`SELECT o.id, c.name AS client, o.city, o.country, o.status, o.source_text, o.created_at,
    o.submitted_by, o.observed_at, o.source_type, o.comments, o.confirmed_at
    FROM observations o JOIN clients c ON c.id = o.client_id ORDER BY o.id DESC;`) as Record<string, unknown>[];
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
    equipment: d.getAllSync("SELECT modality, quantity, brand, model, age_years AS ageYears, evidence FROM equipment WHERE observation_id = ?;",
      r.id) as ObservationRecord["equipment"],
    missing: [],
  }));
}
