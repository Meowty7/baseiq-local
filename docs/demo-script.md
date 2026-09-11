# Guion de demo (máx. 5 min)

Grabar con Wi‑Fi **desconectado** (icono visible) a 768–1024 px de ancho.

1. **Problema (30 s).** Técnico en hospital sin red, datos sensibles del cliente. Nada puede ir a la nube. Mostrar `http://127.0.0.1:3001` + pastilla "IA local lista".
2. **Datos precargados (20 s).** Al arrancar, el sistema siembra 12 observaciones sintéticas. Mostrar la tabla Customer 360 ya poblada: cliente × modalidad × cantidad × edad × confianza × frescura. Desplegar el árbol geográfico: País → Ciudad → Cliente.
3. **Observación nueva (45 s).** Pegar: "Hospital Valle Serena en Madrid. Un tomógrafo Medtron de tres años y dos equipos de rayos X sin marca visible." Clic en "Extraer con IA local".
4. **Extracción (60 s).** Mientras corre: HUD en vivo con **TTFT**, **tokens** y **tok/s** (throughput). Borrador con evidencia citada, marca atribuida al tomógrafo (no a rayos X), cantidad 2 para rayos X. Pregunta de seguimiento sobre ciudad o cantidad (no marca). **Responderla en el campo y clic en "Agregar dato"**: el transcript se re-extrae y el faltante desaparece. Pie de inferencia con las mismas métricas (< 2 s). Explicar: schema estricto + blindaje que anula lo no literal y ancla marca/edad a la modalidad correcta.
5. **Confirmación (30 s).** Revisar, elegir "Confirmar" o "Sin confirmar". Persistencia en SQLite local con autor, fecha y fuente. El sistema re-blindaje al guardar: no entra marca inventada.
6. **Base instalada (60 s).** La tabla 360 actualiza sin doble conteo. Mostrar renovación (≥ 7 años), frescura, aviso de conflicto/duplicado. Desplegar observaciones individuales bajo `<details>`.
7. **Cierre (30 s).** Arquitectura en un proceso, modelo Qwen 600M Q4, métricas (12/12 cliente/modalidad, 16/16 cantidad, 0 alucinaciones, p95 ~1 s), impacto Philips: de notas perdidas a inventario vivo con trazabilidad.
