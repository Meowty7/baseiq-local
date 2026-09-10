# BaseIQ Local

Prototipo Philips + Desafío General — Decentralized AI Hackathon (Dojo / ISD Summit).

Un colaborador de campo escribe lo que vio en un hospital. La app extrae el inventario con IA **en el dispositivo**, el usuario revisa y confirma, y los datos se agregan por cliente y geografía. Sin internet, sin nube.

## Problema

Ingenieros de servicio y vendedores visitan hospitales a diario y ven el parque instalado real (resonadores, tomógrafos, ecógrafos, marcas, antigüedad). Ese conocimiento muere en notas personales: capturarlo a mano toma tiempo, las descripciones son inconsistentes y nadie agrega nada. Philips no tiene visibilidad del panorama tecnológico de sus clientes.

## Solución

Captura en lenguaje natural → extracción estructurada local → pregunta por el dato faltante y re-extracción → revisión con evidencia → base instalada por cliente + resumen global (renovación ≥ 7 años, duplicados, conflictos, frescura).

Cada observación guarda quién observó, fecha, fuente, estado, texto original y evidencia.

## Arquitectura

```
Expo / React Native (teléfono o desktop)
  → @qvac/sdk (llamacpp-completion)
  → QWEN3_600M_INST_Q4 (~382 MB)
  → expo-sqlite
```

- `App.tsx` + `src/components/` — captura, base por cliente, resumen.
- `src/lib/qvac.ts` — carga del modelo (GPU primero, CPU si falla).
- `src/lib/extraction.ts` — prompt + `json_schema` + reintento.
- `src/lib/db.ts` / `store.ts` — SQLite local.
- `shared/observation.ts` — contrato y reglas anti-alucinación.
- Inferencia **nunca** sale del equipo. Stack obligatorio: QVAC (`@qvac/sdk`).

Modelo por defecto: **Qwen3 0.6B Q4**. Override: `QVAC_MODEL=llama` (u otro del mapa en `qvac.ts`).

## GPU

El arranque pide GPU (`gpu_layers: 99`). Si la carga falla, cae a CPU y se queda ahí.

En Android no se hace `unload` del worker (QVAC-19304: tumba el proceso). El modelo vive toda la sesión.

En un NX729J (Adreno) la app cargó `device=gpu` con Qwen 0.6B. En laptop (Ryzen 7 PRO 7840HS + iGPU AMD), mismo modelo:

| Dispositivo | mean | p50 | p95 |
|---|---|---|---|
| GPU | 672 ms | 640 ms | 1221 ms |
| CPU | 1221 ms | 1194 ms | 2074 ms |

Forzar en Bun: `QVAC_DEVICE=cpu` o `QVAC_DEVICE=gpu`. En Expo no hay `process.env`; en bench se usa `files/qvac.device`.

QVAC en móvil **no corre en emulador**. Hace falta un teléfono físico.

## Reglas anti-alucinación

1. `responseFormat: json_schema` + `/no_think`.
2. `groundDraft()`: marca/modelo solo si aparecen literales en el texto; modalidad y cantidades rescatadas por patrones en español; cliente-oración → `null`.
3. Reintento ante JSON inválido.
4. Revisión humana antes de `Confirmado`; el texto original se conserva.

## Evaluación

12 observaciones sintéticas (`fixtures/observations.es.json`), pipeline real.

**Qwen3 0.6B GPU (gate oficial):** PASS — `valid=12/12 client=12/12 city=7–8/12 country=6–9/12 modality=12/12 quantity=15/16 halluc=0`.

Se compararon también Llama 1B Q4_0 (mejor ciudad, más lento), MedPsy 1.7B (FAIL por p95), Qwen 1.7B, SmolLM, Salamandra y Qwen3.5 VL. Combo Llama+Qwen no mejora el solo. Qwen 0.6B es el default por velocidad y porque pasa el gate.

```bash
bun test                              # 20 unitarias
QVAC_MODEL=qwen bun scripts/qvac-smoke.ts
QVAC_MODEL=qwen bun scripts/evaluate-model.ts
```

## Uso

```bash
bun install
bun test
bunx expo prebuild --platform android   # necesita `node` en PATH (p. ej. nvm)
bun run android                         # device físico
```

La primera vez baja el GGUF a la caché de QVAC (fuera de Git). Después funciona offline.

`android/` e `ios/` se generan con prebuild y no van a Git.

## Limitaciones

- Cantidades ambiguas en frases con varios equipos a veces piden un clic en revisión.
- Voz y foto de placa: fuera de este corte.
- Sin sync entre dispositivos (SQLite local).

## Privacidad

Brief de Philips: [`docs/philips-brief.md`](docs/philips-brief.md) y [`docs/philips-brief-es.md`](docs/philips-brief-es.md). Hospitales y marcas son ficticios (DemoCare, Novascan, Medtron, Scanwell…). Datos 100% sintéticos.

## Declaración de base preexistente

Ninguna. El código se escribió durante el hackathon (9–10 sep 2026) salvo dependencias de `package.json` (`expo`, `react-native`, `@qvac/sdk`, `typescript`).
