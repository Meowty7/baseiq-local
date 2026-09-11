# BaseIQ Local

Prototipo Philips (Track 01) + Reto Tether: QVAC Psy (Track 02) + Desafío General — Decentralized AI Hackathon (Dojo / ISD Summit).

Un colaborador de campo elige su idioma, escribe o dicta lo que vio en un hospital, y la app traduce y extrae el inventario con IA **en el dispositivo**. El usuario revisa y confirma; los datos se agregan por cliente y geografía. Sin internet, sin nube.

**Demo:** https://qvac.belta.dev/demo/

## Idiomas

18 idiomas al iniciar: **ES, PT, EN, FR, DE, IT, NL, PL, RO, CS, SV, DA, RU, TR, AR, ZH, JA, KO**.

UI, preguntas de seguimiento y captura van en el idioma L. El prompt de extracción es **inglés**. **TranslatePsy** (Bergamot NMT, on-device) hace L→EN en la nota y EN→L en la UI la primera vez que se elige un idioma que no es ES/EN. ES y EN van en el diccionario. Cada par ~30 MiB (CJK ~42 MiB), bajo demanda.

## Flujo

Nota (L) o voz → TranslatePsy L→EN → extracción local (prompt EN, `json_schema`) → pregunta por el faltante en L → revisión con evidencia → SQLite por cliente + resumen (renovación ≥ 7 años, duplicados, conflictos, frescura).

Cada observación guarda autor, fecha, fuente, estado, texto original y evidencia.

## Arquitectura

```
Expo / React Native
  → @qvac/sdk
      llamacpp-completion     → QWEN3_600M_INST_Q4 (GPU, CPU si falla)
      nmtcpp-translation      → BERGAMOT_{L}_EN / BERGAMOT_EN_{L}
      whispercpp-transcription → dictado ES
  → expo-sqlite
  → src/i18n
```

- `App.tsx`, `src/components/` — captura, base, insights, idioma.
- `src/lib/qvac.ts` — LLM, NMT, Whisper.
- `src/lib/extraction.ts` — traducción + schema + `groundDraft()`.
- `src/lib/db.ts`, `store.ts` — SQLite local.
- `shared/observation.ts` — contrato y reglas anti-alucinación.

Modelo por defecto: Qwen3 0.6B Q4 (`QVAC_MODEL` para override). Inferencia solo en el dispositivo; Captura muestra TTFT, tokens y tok/s.

## GPU

El LLM arranca en GPU (`gpu_layers: 99`) y cae a CPU si falla. NMT va en CPU. En Android el worker no se descarga (QVAC-19304).

| Dispositivo | mean | p50 | p95 |
|---|---|---|---|
| GPU (Ryzen 7 PRO 7840HS iGPU) | 672 ms | 640 ms | 1221 ms |
| CPU | 1221 ms | 1194 ms | 2074 ms |

QVAC no corre en emulador.

## Anti-alucinación

`json_schema` + `/no_think`. `groundDraft()` anula marca/modelo no literales. Reintento si el JSON es inválido. Confirmación humana; se conserva el original.

## Evaluación

12 observaciones en `fixtures/observations.es.json`.

**Qwen3 0.6B GPU:** PASS — `valid=12/12 client=12/12 modality=12/12 quantity=15/16 halluc=0`.

```bash
bun test
QVAC_MODEL=qwen bun scripts/evaluate-model.ts
```

## Uso

```bash
bun install
bun test
bunx expo prebuild --platform android
bun run android
```

Teléfono físico. Tras cambiar `qvac.config.json`, `bun run android` regenera el worker. Escritorio: `qvac/worker.entry.mjs`.

## Track 02 — QVAC Psy

| Pieza | Qué es |
|---|---|
| Extracción | `QWEN3_600M_INST_Q4` |
| Traducción | `BERGAMOT_{L}_EN` / `BERGAMOT_EN_{L}` (TranslatePsy, CPU) |
| SDK | `@qvac/sdk` ^0.19.0 |

Sin APIs remotas de IA. Si L=ES y el NMT no cargó, el léxico `toEnglishObservation` es fallback local.

## Limitaciones

- Frases con varios equipos a veces piden un clic en revisión.
- Sin sync entre dispositivos.
- La primera localización EN→L tarda (carga del par); después hay caché.
- Árabe: se traducen las cadenas, no se fuerza RTL.

## Privacidad

Brief: [`docs/philips-brief.md`](docs/philips-brief.md), [`docs/philips-brief-es.md`](docs/philips-brief-es.md). Hospitales y marcas ficticios. Datos sintéticos.

## Base preexistente

Ninguna. Código del hackathon (9–11 sep 2026) salvo dependencias de `package.json`.
