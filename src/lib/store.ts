import { useCallback, useEffect, useState } from "react";
import * as FileSystem from "expo-file-system";
import { getDb, listObservations, saveObservation } from "./db";
import { ensureModel, isReady, isBusy, getLastInferMs, getDevice, setDeviceOverride, MODEL_NAME } from "./qvac";
import { extractObservation } from "./extraction";
import {
  OBSERVATION_STATUSES, SOURCE_TYPES, freshness, detectConflicts, normalizeDraft,
  type ObservationDraft, type ObservationRecord, type ObservationStatus,
} from "../../shared/observation";
import fixtures from "../../fixtures/observations.es.json";

export interface OverviewResult {
  observations: number;
  byModality: Record<string, number>;
  byCountry: Record<string, number>;
  fieldsUnknown: number;
  duplicates: string[];
  stale: string[];
  conflicts: { client: string; modality: string; detail: string; dates: string[]; statuses: string[] }[];
  renewals: { client: string; modality: string | null; brand: string | null; model: string | null; ageYears: number | null }[];
}

export interface StatusResult {
  ready: boolean;
  busy: boolean;
  model: string;
  device: "gpu" | "cpu" | null;
  lastInferMs: number | null;
}

export interface ExtractionResult {
  draft: ObservationDraft;
  question: string | null;
  inferMs: number;
  sourceText: string;
}

export { OBSERVATION_STATUSES, SOURCE_TYPES };

export function computeOverview(obs: ObservationRecord[]): OverviewResult {
  const byModality: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  let unknown = 0;
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  const stale: string[] = [];
  const renewals: OverviewResult["renewals"] = [];
  for (const o of obs) {
    if (o.country) byCountry[o.country] = (byCountry[o.country] ?? 0) + 1;
    const f = freshness(o.observedAt, o.confirmedAt);
    if (f !== "reciente") stale.push(`${o.client} (${f}, ${o.status})`);
    for (const e of o.equipment) {
      if (e.modality) byModality[e.modality] = (byModality[e.modality] ?? 0) + (e.quantity ?? 1);
      if (!e.brand || !e.model || e.ageYears === null) unknown++;
      const key = `${o.client}||${e.modality ?? ""}||${e.brand ?? ""}||${e.model ?? ""}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (seen.get(key) === 2) duplicates.push(`${o.client}: ${e.quantity ?? "?"}× ${e.modality ?? "equipo"}${e.brand ? ` ${e.brand}` : ""}${e.model ? ` ${e.model}` : ""} reportado dos veces`);
      if (e.ageYears !== null && e.ageYears >= 7 && (o.status === "Confirmado" || o.status === "Estimado")) {
        renewals.push({ client: o.client ?? "Sin cliente", modality: e.modality, brand: e.brand, model: e.model, ageYears: e.ageYears });
      }
    }
  }
  return { observations: obs.length, byModality, byCountry, fieldsUnknown: unknown, duplicates, stale, renewals, conflicts: detectConflicts(obs) };
}

export function useStore() {
  const [status, setStatus] = useState<StatusResult>({ ready: false, busy: false, model: MODEL_NAME, device: null, lastInferMs: null });
  const [observations, setObservations] = useState<ObservationRecord[]>([]);
  const [overview, setOverview] = useState<OverviewResult | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const refresh = useCallback(() => {
    const db = getDb();
    const list = listObservations(db);
    setObservations(list);
    setOverview(computeOverview(list));
    setStatus((s) => ({ ...s, ready: isReady(), busy: isBusy(), lastInferMs: getLastInferMs(), device: getDevice() }));
  }, []);

  const seedIfEmpty = useCallback(() => {
    const db = getDb();
    if (listObservations(db).length > 0) return;
    // Seed desde expect, sin inferencia: 12 llamadas al modelo al arrancar
    // calentaban y trababan la GPU del Poco (8–10s → timeout / hang).
    for (const fx of fixtures as unknown as { text: string; expect: { client: string | null; city: string | null; country: string | null; modalities: string[]; quantities?: Record<string, number> } }[]) {
      const client = fx.expect.client;
      if (!client) continue;
      saveObservation(db, {
        client, city: fx.expect.city, country: fx.expect.country,
        status: "Reportado", sourceText: fx.text,
        submittedBy: "seed", observedAt: "2026-09-01", sourceType: "visita", comments: null, confirmedAt: null,
      }, fx.expect.modalities.map((m) => ({
        modality: m, quantity: fx.expect.quantities?.[m] ?? 1,
        brand: null, model: null, ageYears: null, evidence: null,
      })));
    }
    refresh();
  }, [refresh]);

  useEffect(() => {
    (async () => {
      try {
        const flag = `${FileSystem.documentDirectory}qvac.device`;
        const raw = (await FileSystem.readAsStringAsync(flag).catch(() => "")).trim().toLowerCase();
        if (raw === "cpu" || raw === "gpu") setDeviceOverride(raw);
        seedIfEmpty();
        await ensureModel((pct) => setProgress(pct));
        setProgress(null);
        refresh();
      } catch (err) {
        console.error("model preload failed:", err);
      }
    })();
  }, [refresh, seedIfEmpty]);

  const extract = useCallback(async (text: string): Promise<ExtractionResult> => {
    const { draft, question, inferMs } = await extractObservation(text.trim());
    return { draft, question, inferMs, sourceText: text.trim() };
  }, []);

  const save = useCallback((input: {
    client: string; city: string | null; country: string | null;
    status: ObservationStatus; sourceText: string;
    equipment: ObservationDraft["equipment"];
    submittedBy: string | null; observedAt: string | null; sourceType: string | null; comments: string | null;
  }): number => {
    const db = getDb();
    // Lo revisado en el chat se guarda tal cual. Re-blindar aquí pisaba cantidad/modalidad
    // (p. ej. 200 resonadores) y dejaba la observación sin equipos en el 360.
    const draft = normalizeDraft({
      client: input.client.trim(),
      city: input.city, country: input.country,
      equipment: input.equipment, missing: [],
    });
    const id = saveObservation(db, {
      client: draft.client ?? input.client.trim(),
      city: draft.city, country: draft.country,
      status: input.status, sourceText: input.sourceText,
      submittedBy: input.submittedBy, observedAt: input.observedAt,
      sourceType: input.sourceType, comments: input.comments,
      confirmedAt: input.status === "Confirmado" ? new Date().toISOString() : null,
    }, draft.equipment);
    refresh();
    return id;
  }, [refresh]);

  return { status, observations, overview, progress, refresh, extract, save };
}
