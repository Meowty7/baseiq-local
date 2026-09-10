import { getDb, saveObservation, listObservations, closeDb } from "./db";
import { extractObservation } from "./extraction";
import { ensureModel, isReady, isBusy, getLastInferMs, shutdown, MODEL_NAME } from "./qvac";
import { OBSERVATION_STATUSES } from "../shared/observation";

const PORT = Number(process.env.PORT ?? 3001);
const DIST = "./dist";

const db = getDb();

ensureModel((pct) => {
  if (Math.round(pct) % 20 === 0) console.log(`▸ model ${pct.toFixed(0)}%`);
}).then(() => console.log("▸ QVAC ready"))
  .catch((err) => console.error("✖ model preload failed:", err));

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/status") {
      return json({ ready: isReady(), busy: isBusy(), model: MODEL_NAME, lastInferMs: getLastInferMs() });
    }

    if (url.pathname === "/api/extractions" && req.method === "POST") {
      if (!req.headers.get("content-type")?.includes("application/json")) {
        return json({ error: "expected application/json" }, 415);
      }
      const body = await req.json().catch(() => null) as { text?: unknown } | null;
      if (!body || typeof body.text !== "string" || body.text.trim().length < 10) {
        return json({ error: "text must be a string of at least 10 characters" }, 400);
      }
      if (body.text.length > 2000) return json({ error: "text too long (max 2000)" }, 400);
      try {
        const { draft, question, inferMs } = await extractObservation(body.text.trim());
        return json({ draft, question, inferMs, sourceText: body.text.trim() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "infer_failed";
        const code = msg === "model_busy" ? 409 : 500;
        return json({ error: msg }, code);
      }
    }

    if (url.pathname === "/api/observations" && req.method === "POST") {
      const body = await req.json().catch(() => null) as {
        client?: unknown; city?: unknown; country?: unknown; status?: unknown;
        sourceText?: unknown; equipment?: unknown[];
      } | null;
      if (!body || typeof body.client !== "string" || !body.client.trim()) {
        return json({ error: "client is required" }, 400);
      }
      if (!OBSERVATION_STATUSES.includes(body.status as never)) {
        return json({ error: `status must be one of ${OBSERVATION_STATUSES.join(", ")}` }, 400);
      }
      if (typeof body.sourceText !== "string" || !Array.isArray(body.equipment)) {
        return json({ error: "sourceText and equipment are required" }, 400);
      }
      const id = saveObservation(db, {
        client: body.client.trim(),
        city: typeof body.city === "string" ? body.city : null,
        country: typeof body.country === "string" ? body.country : null,
        status: body.status as (typeof OBSERVATION_STATUSES)[number],
        sourceText: body.sourceText,
      }, body.equipment as never);
      return json({ id }, 201);
    }

    if (url.pathname === "/api/observations" && req.method === "GET") {
      return json(listObservations(db));
    }

    if (url.pathname === "/api/overview" && req.method === "GET") {
      const obs = listObservations(db);
      const byModality: Record<string, number> = {};
      const byCountry: Record<string, number> = {};
      let unknown = 0;
      const seen = new Map<string, number>();
      const duplicates: string[] = [];
      const renewals: { client: string; modality: string | null; brand: string | null; model: string | null; ageYears: number | null }[] = [];
      for (const o of obs) {
        if (o.country) byCountry[o.country] = (byCountry[o.country] ?? 0) + 1;
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
      return json({ observations: obs.length, byModality, byCountry, fieldsUnknown: unknown, duplicates, renewals });
    }

    const file = Bun.file(DIST + (url.pathname === "/" ? "/index.html" : url.pathname));
    if (await file.exists()) return new Response(file);
    const index = Bun.file(DIST + "/index.html");
    if (await index.exists()) return new Response(index);
    return json({ error: "not_found" }, 404);
  },
});

console.log(`▸ BaseIQ Local en http://127.0.0.1:${server.port}`);

process.on("SIGINT", async () => {
  await shutdown();
  closeDb();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await shutdown();
  closeDb();
  process.exit(0);
});
