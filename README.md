# BaseIQ Local

Prototipo Philips (Track 01) + Reto Tether: QVAC Psy (Track 02) + Desafío General — Decentralized AI Hackathon (Dojo / ISD Summit).

Un colaborador de campo elige su idioma, escribe lo que vio en un hospital, y la app traduce y extrae el inventario con IA **en el dispositivo**. El usuario revisa y confirma, y los datos se agregan por cliente y geografía. Sin internet, sin nube.

**Demo:** https://qvac.belta.dev/demo/

## Idiomas

18 idiomas, a elegir al iniciar: **ES, PT, EN, FR, DE, IT, NL, PL, RO, CS, SV, DA, RU, TR, AR, ZH, JA, KO**.

- La UI, las preguntas de seguimiento del agente y la captura de la nota van en el idioma L del usuario.
- El prompt de extracción se queda en **inglés** (Qwen rinde mejor en EN).
- **TranslatePsy** (Bergamot NMT, on-device) cubre ambos sentidos: nota **L→EN** antes de extraer, y UI + 8 plantillas de pregunta **EN→L** la primera vez que se elige un idioma que no es ES/EN (caché en disco). ES y EN van escritos a mano.
- EN es identidad (sin modelo). Cada par ~30 MiB (CJK ~42 MiB); se descarga **bajo demanda** solo el par del idioma elegido.

## Problema

Ingenieros de servicio y vendedores visitan hospitales a diario y ven el parque instalado real (resonadores, tomógrafos, ecógrafos, marcas, antigüedad). Ese conocimiento muere en notas personales: capturarlo a mano toma tiempo, las descripciones son inconsistentes y nadie agrega nada. Philips no tiene visibilidad del panorama tecnológico de sus clientes.

## Solución

Captura en lenguaje natural (L) → **TranslatePsy** L→EN on-device (Bergamot NMT; ES tiene fallback léxico) → extracción estructurada local (prompt EN) → pregunta por el dato faltante **en L** y re-extracción → revisión con evidencia → base instalada por cliente + resumen global (renovación ≥ 7 años, duplicados, conflictos, frescura).

Cada observación guarda quién observó, fecha, fuente, estado, texto original y evidencia.

## Arquitectura

```
Expo / React Native (teléfono o desktop)
  → @qvac/sdk
      llamacpp-completion  → QWEN3_600M_INST_Q4 (~382 MB, GPU / CPU fallback)
      nmtcpp-translation   → BERGAMOT_{L}_EN + BERGAMOT_EN_{L} / TranslatePsy (~30–42 MB, CPU, bajo demanda)
  → expo-sqlite
  → src/i18n               → diccionario ES/EN + overlay NMT para los otros 16
```

- `App.tsx` + `src/components/` — captura, base por cliente, resumen, selector de idioma.
- `src/i18n/` — 18 idiomas, `t()`, preguntas, `localizeUi()` con caché.
- `src/lib/qvac.ts` — carga del LLM (GPU primero, CPU si falla) y del traductor NMT por par `(from,to)`.
- `src/lib/extraction.ts` — traducción híbrida + prompt EN + `json_schema` + reintento. ES se groundea contra el original; el resto contra la traducción EN.
- `src/lib/db.ts` / `store.ts` — SQLite local + `lang` persistido.
- `shared/observation.ts` — contrato, léxico ES→EN de fallback y reglas anti-alucinación.
- Inferencia **nunca** sale del equipo. Stack obligatorio: QVAC (`@qvac/sdk`). Durante la extracción, Captura muestra en vivo **TTFT**, recuento de tokens y **tok/s**.

Modelo de extracción por defecto: **Qwen3 0.6B Q4**. Override: `QVAC_MODEL=llama` (u otro del mapa en `qvac.ts`).

Traductor Psy: pares **Bergamot** `BERGAMOT_{L}_EN` / `BERGAMOT_EN_{L}` (TranslatePsy, intgemm, CPU). Si el NMT no está listo o falla y L=ES, se usa el léxico `toEnglishObservation`. `groundDraft()` no se relaja.

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
2. `groundDraft()`: marca/modelo solo si aparecen literales en el texto; modalidad y cantidades rescatadas por patrones; cliente-oración → `null`.
3. Reintento ante JSON inválido.
4. Revisión humana antes de `Confirmado`; el texto original se conserva.

## Evaluación

12 observaciones sintéticas (`fixtures/observations.es.json`), pipeline real. Fixtures PT de demo: `fixtures/observations.pt.json`.

**Qwen3 0.6B GPU (gate oficial, léxico ES→EN):** PASS — `valid=12/12 client=12/12 city=7–8/12 country=6–9/12 modality=12/12 quantity=15/16 halluc=0`.

Se compararon también Llama 1B Q4_0 (mejor ciudad, más lento), MedPsy 1.7B (FAIL por p95), Qwen 1.7B, SmolLM, Salamandra y Qwen3.5 VL. Combo Llama+Qwen no mejora el solo. Qwen 0.6B es el default por velocidad y porque pasa el gate.

```bash
bun test                              # unitarias
QVAC_MODEL=qwen bun scripts/qvac-smoke.ts
QVAC_MODEL=qwen bun scripts/evaluate-model.ts
QVAC_MODELS=qwen bun scripts/compare-models.ts
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

La primera vez baja el GGUF y el bundle Bergamot del idioma elegido a la caché de QVAC (fuera de Git). Después funciona offline.

`android/` e `ios/` se generan con prebuild y no van a Git.

## Track 02 — QVAC Psy

TranslatePsy localiza **toda la app** en 18 idiomas y traduce cada nota L→EN antes de extraer. No es un swap estético de LLM: es un NMT dedicado (~30 MiB, CPU) pensado para teléfonos. Sin él, la UI no se localiza en los 16 idiomas más allá de ES/EN.

| Pieza | Identidad honesta |
|---|---|
| Extracción | `QWEN3_600M_INST_Q4` (Qwen3 0.6B Instruct, Q4, llamacpp, prompt EN) |
| Traducción | `BERGAMOT_{L}_EN` / `BERGAMOT_EN_{L}` (TranslatePsy / Bergamot NMT, intgemm, CPU, on-demand) |
| Hardware declarado | teléfono NX729J (Adreno GPU + CPU) o laptop Ryzen 7 PRO 7840HS |
| SDK | `@qvac/sdk` ^0.19.0 — toda inferencia y traducción |
| Plugin NMT | `@qvac/sdk/nmtcpp-translation/plugin` |
| Addon | `@qvac/translation-nmtcpp` (Bergamot/Marian, dependencia transitiva del SDK) |

No hay APIs remotas de IA. La nube no participa en traducción, localización ni extracción. El léxico `toEnglishObservation` es fallback local (sin red) si L=ES y el NMT no cargó.

## Limitaciones

- Cantidades ambiguas en frases con varios equipos a veces piden un clic en revisión.
- Voz y foto de placa: fuera de este corte.
- Sin sync entre dispositivos (SQLite local).
- La primera localización EN→L tarda unos segundos (carga del par + batch ~100 strings); después hay caché en disco.
- 18 idiomas × ~30 MiB ≈ 500 MiB si se bajaran todos; la app solo descarga el par del idioma activo.
- Árabe: se traducen las cadenas, no se fuerza layout RTL.

## Privacidad

Brief de Philips: [`docs/philips-brief.md`](docs/philips-brief.md) y [`docs/philips-brief-es.md`](docs/philips-brief-es.md). Hospitales y marcas son ficticios (DemoCare, Novascan, Medtron, Scanwell…). Datos 100% sintéticos.

## Declaración de base preexistente

Ninguna. El código se escribió durante el hackathon (9–11 sep 2026) salvo dependencias de `package.json` (`expo`, `react-native`, `@qvac/sdk`, `typescript`).
