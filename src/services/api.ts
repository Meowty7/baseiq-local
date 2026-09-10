import type { ObservationDraft, ObservationRecord, ObservationStatus } from "../../shared/observation";

export interface ExtractionResult {
  draft: ObservationDraft;
  question: string | null;
  inferMs: number;
  sourceText: string;
}

export interface StatusResult {
  ready: boolean;
  busy: boolean;
  model: string;
  lastInferMs: number | null;
}

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

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `http_${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  status: () => req<StatusResult>("/api/status"),
  extract: (text: string) =>
    req<ExtractionResult>("/api/extractions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  save: (input: {
    client: string; city: string | null; country: string | null;
    status: ObservationStatus; sourceText: string;
    equipment: ObservationDraft["equipment"];
    submittedBy: string | null; observedAt: string | null; sourceType: string | null; comments: string | null;
  }) =>
    req<{ id: number }>("/api/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  list: () => req<ObservationRecord[]>("/api/observations"),
  overview: () => req<OverviewResult>("/api/overview"),
};
