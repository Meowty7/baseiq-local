# BaseIQ Local

Prototipo Philips + Desafío General — Decentralized AI Hackathon (Dojo / ISD Summit).

Un colaborador de campo escribe lo que vio en un hospital. La app extrae el inventario con IA **en el dispositivo**, el usuario revisa y confirma, y los datos se agregan por cliente y geografía. Sin internet, sin nube.

## Problema

Ingenieros de servicio y vendedores visitan hospitales a diario y ven el parque instalado real (resonadores, tomógrafos, ecógrafos, marcas, antigüedad). Ese conocimiento muere en notas personales: capturarlo a mano toma tiempo, las descripciones son inconsistentes y nadie agrega nada. Philips no tiene visibilidad del panorama tecnológico de sus clientes.

## Solución

Captura en lenguaje natural → extracción estructurada local → revisión con evidencia → base instalada viva por cliente + resumen global con alertas de renovación (≥ 7 años) y detección de duplicados.

## Arquitectura (todo en el laptop)

```
Vue 3 (tablet/desktop) → Bun.serve :3001 → @qvac/sdk → QWEN3_600M_INST_Q4 → SQLite
```

- `src/` — UI Vue + TypeScript (captura, revisión, base por cliente, resumen).
- `server/` — API local: `qvac.ts` (ciclo de vida del modelo), `extraction.ts` (prompt + schema + reintento), `db.ts` (SQLite + transacciones), `index.ts` (HTTP + estáticos).
- `shared/observation.ts` — contrato único + reglas deterministas anti-alucinación.
- La inferencia **nunca** sale del equipo. No hay API keys ni endpoints externos.

## Reglas anti-alucinación

Los modelos Q4 pequeños inventan marcas y confunden modalidad. El blindaje:

1. `responseFormat: json_schema` (gramática estricta) + `/no_think`.
2. `groundDraft()`: marca/modelo solo si aparecen **literales** en el texto, cortos (≤ 40 caracteres, ≤ 4 palabras); modalidad verificada contra la evidencia; cantidad y edad rescatadas por patrones en español (`dos…`, `8 años`); cliente-oración → `null`.
3. Reintento automático ante JSON inválido.
4. Revisión humana obligatoria antes de `Confirmado`; el texto original siempre se conserva.

## Evaluación (12 observaciones sintéticas, `bun run evaluate`)

| Métrica | Resultado |
|---|---|
| JSON válido | 11/12 (reintento cubre el resto en producción) |
| Cliente correcto | 9/12 |
| Modalidad correcta | 9/12 |
| Alucinaciones que llegan a guardar | **0** |
| Latencia inferencia | p50 ~1.2 s, p95 ~5.3 s (laptop Ryzen 7 PRO 7840HS, CPU) |

Hardware: Ryzen 7 PRO 7840HS, 29 GiB RAM, RTX A1000 6 GiB (inferencia en CPU por confiabilidad). Modelo: `QWEN3_600M_INST_Q4` (~382 MB, registro P2P de QVAC). Se evaluó `LLAMA_3_2_1B_INST_Q4_0` y se descartó: más lento sin mejor precisión en este esquema.

## Uso

```bash
bun install
bun test                  # 8 pruebas unitarias
QVAC_CONFIG_PATH=./qvac.config.json bun run scripts/qvac-smoke.ts   # gate QVAC
bun run build && bun run start   # producción: http://127.0.0.1:3001
```

Desarrollo: `bun run dev` (Vite, proxy `/api` → :3001) + `bun run dev:server`.

Primera ejecución descarga el modelo a `.qvac/` (fuera de Git). Después funciona con Wi‑Fi desconectado.

## Limitaciones conocidas

- Cantidades ambiguas en frases con varios equipos pueden requerir corrección en revisión (un clic).
- Voz/Whisper y foto de placa: fuera de alcance para este corte; la arquitectura los admite como siguientes pasos.
- Sin sincronización entre dispositivos (SQLite local por diseño).

## Declaración de base preexistente

Ninguna. Todo el código de este repositorio se escribió durante el hackathon (9–10 sep 2026) salvo dependencias declaradas en `package.json` (`vue`, `@qvac/sdk`, `vite`, `typescript`). Datos 100% sintéticos.
