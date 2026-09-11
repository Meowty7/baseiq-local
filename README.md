# BaseIQ Local

Prototipo Philips (Track 01) + Reto Tether: QVAC Psy (Track 02) + Desafío General — Decentralized AI Hackathon (Dojo / ISD Summit).

Un colaborador de campo escribe lo que vio en un hospital. La app traduce y extrae el inventario con IA **en el dispositivo**, el usuario revisa y confirma, y los datos se agregan por cliente y geografía. Sin internet, sin nube.

## Problema

Ingenieros de servicio y vendedores visitan hospitales a diario y ven el parque instalado real (resonadores, tomógrafos, ecógrafos, marcas, antigüedad). Ese conocimiento muere en notas personales: capturarlo a mano toma tiempo, las descripciones son inconsistentes y nadie agrega nada. Philips no tiene visibilidad del panorama tecnológico de sus clientes.

## Solución

Captura en lenguaje natural (ES) → **TranslatePsy** ES→EN on-device (Bergamot NMT, fallback léxico) → extracción estructurada local → pregunta por el dato faltante y re-extracción → revisión con evidencia → base instalada por cliente + resumen global (renovación ≥ 7 años, duplicados, conflictos, frescura).

Cada observación guarda quién observó, fecha, fuente, estado, texto original y evidencia.

## Arquitectura

```
Expo / React Native (teléfono o desktop)
  → @qvac/sdk
      llamacpp-completion  → QWEN3_600M_INST_Q4 (~382 MB, GPU / CPU fallback)
      nmtcpp-translation   → BERGAMOT_ES_EN / TranslatePsy (~31 MB, CPU)
  → expo-sqlite
```

- `App.tsx` + `src/components/` — captura, base por cliente, resumen.
- `src/lib/qvac.ts` — carga del LLM (GPU primero, CPU si falla) y del traductor NMT (CPU, paralelo).
- `src/lib/extraction.ts` — traducción híbrida + prompt + `json_schema` + reintento.
- `src/lib/db.ts` / `store.ts` — SQLite local.
- `shared/observation.ts` — contrato, léxico ES→EN de fallback y reglas anti-alucinación.
- Inferencia **nunca** sale del equipo. Stack obligatorio: QVAC (`@qvac/sdk`).

Modelo de extracción por defecto: **Qwen3 0.6B Q4**. Override: `QVAC_MODEL=llama` (u otro del mapa en `qvac.ts`).

Traductor Psy: **BERGAMOT_ES_EN** (TranslatePsy, Bergamot/NMT, ES→EN, intgemm, CPU). Si el traductor no está listo o falla, se usa el léxico `toEnglishObservation`. `groundDraft()` valida contra el texto español original, así que el método de traducción no relaja el blindaje.

## GPU

El arranque pide GPU (`gpu_layers: 99`) para el LLM. Si la carga falla, cae a CPU y se queda ahí. TranslatePsy/Bergamot es CPU-only y convive con el LLM.

En Android no se hace `unload` del worker (QVAC-19304: tumba el proceso). Los modelos viven toda la sesión.

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

**Qwen3 0.6B GPU (gate oficial, léxico ES→EN):** PASS — `valid=12/12 client=12/12 city=7–8/12 country=6–9/12 modality=12/12 quantity=15/16 halluc=0`.

Se compararon también Llama 1B Q4_0 (mejor ciudad, más lento), MedPsy 1.7B (FAIL por p95), Qwen 1.7B, SmolLM, Salamandra y Qwen3.5 VL. Combo Llama+Qwen no mejora el solo. Qwen 0.6B es el default por velocidad y porque pasa el gate.

La matriz compara cada modelo de extracción con **regex-EN** y **TranslatePsy-EN** (batch previo de los 12 fixtures) y escribe un registro de rendimiento estructurado (carga, prompts ES/EN, inferMs, tokens/TTFT/TPS del NMT cuando el addon los emite):

```bash
bun test                              # unitarias
QVAC_MODEL=qwen bun scripts/qvac-smoke.ts
QVAC_MODEL=qwen bun scripts/evaluate-model.ts
QVAC_MODELS=qwen bun scripts/compare-models.ts   # data/compare-models.report.json
```

## Uso

```bash
bun install
bun test
bunx expo prebuild --platform android   # necesita `node` en PATH (p. ej. nvm)
bun run android                         # device físico
```

Tras cambiar `qvac.config.json` (plugins), regenerar el worker. Escritorio usa [`qvac/worker.entry.mjs`](qvac/worker.entry.mjs) (ya registra NMT). El bundle móvil [`qvac/worker.bundle.js`](qvac/worker.bundle.js) lo regenera el plugin de Expo en `prebuild` / `bun run android`:

```bash
bunx --bun -e "import { bundleSdk } from '@qvac/sdk/commands'; await bundleSdk({ projectRoot: process.cwd(), configPath: './qvac.config.json' })"
```

### Requisitos Android (no van a Git)

- **SDK de Android**: define `ANDROID_HOME` o crea `android/local.properties` con `sdk.dir=/ruta/al/Sdk` (gitignored). Expo lo autogenera si `ANDROID_HOME` está seteado.
- **JDK 17+ para Gradle**: Gradle corre sobre el `java` del sistema. Si ese `java` es un JRE sin compilador (p. ej. `java-*-openjdk-headless` en Fedora), los módulos sin `jvmToolchain` como `react-native-bare-kit` fallan con `does not provide the required capabilities: [JAVA_COMPILER]`. Apunta Gradle a un JDK real en `~/.gradle/gradle.properties`:
  ```
  org.gradle.java.home=/ruta/al/jdk-21
  ```
  Ambos archivos son por máquina y no se commitean; cada dev los apunta al suyo (en Windows, la misma clave a su JDK).

La primera vez baja el GGUF y el bundle Bergamot ES→EN a la caché de QVAC (fuera de Git). Después funciona offline.

`android/` e `ios/` se generan con prebuild y no van a Git.

## Track 02 — QVAC Psy

TranslatePsy (`BERGAMOT_ES_EN`) es el modelo Psy **central** del flujo: cada observación en español se traduce on-device antes de la extracción. No es un swap estético de LLM; es un NMT dedicado (~31 MB, CPU) pensado para teléfonos.

| Pieza | Identidad honesta |
|---|---|
| Extracción | `QWEN3_600M_INST_Q4` (Qwen3 0.6B Instruct, Q4, llamacpp) |
| Traducción | `BERGAMOT_ES_EN` (TranslatePsy / Bergamot NMT, ES→EN, intgemm, CPU) |
| Hardware declarado | teléfono NX729J (Adreno GPU + CPU) o laptop Ryzen 7 PRO 7840HS |
| SDK | `@qvac/sdk` ^0.19.0 — toda inferencia y traducción |
| Plugin NMT | `@qvac/sdk/nmtcpp-translation/plugin` |
| Addon | `@qvac/translation-nmtcpp` (Bergamot/Marian, dependencia transitiva del SDK) |

No hay APIs remotas de IA. La nube no participa en traducción ni extracción. El léxico `toEnglishObservation` es fallback local (sin red) si el NMT no cargó.

El registro de rendimiento de Track 02 lo emite `scripts/compare-models.ts` → `data/compare-models.report.json` (carga del modelo, prompts, recuento de tokens, TTFT y throughput cuando el addon los reporta).

## Limitaciones

- Cantidades ambiguas en frases con varios equipos a veces piden un clic en revisión.
- Voz y foto de placa: fuera de este corte.
- Sin sync entre dispositivos (SQLite local).
- TranslatePsy añade latencia de NMT en CPU (~100–500 ms por nota, a medir en la matriz); el fallback regex cubre el cold start.

## Privacidad

Brief de Philips: [`docs/philips-brief.md`](docs/philips-brief.md) y [`docs/philips-brief-es.md`](docs/philips-brief-es.md). Hospitales y marcas son ficticios (DemoCare, Novascan, Medtron, Scanwell…). Datos 100% sintéticos.

## Declaración de base preexistente

Ninguna. El código se escribió durante el hackathon (9–11 sep 2026) salvo dependencias de `package.json` (`expo`, `react-native`, `@qvac/sdk`, `typescript`).
