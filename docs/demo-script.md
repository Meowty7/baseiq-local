# Guion de demo (máx. 5 min)

Grabar con Wi‑Fi **desconectado** (icono visible) a 768–1024 px de ancho.

1. **Problema (30 s).** Técnico en hospital sin red, datos sensibles del cliente. Nada puede ir a la nube. Mostrar `http://127.0.0.1:3001` + pastilla "IA local lista".
2. **Observación (45 s).** Pegar: "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo. Uno de los resonadores parece de unos ocho años." Indicar quién observó y fecha. Clic en "Extraer con IA local".
3. **Extracción (60 s).** Borrador con evidencia citada, pregunta de seguimiento ("¿En qué ciudad…?"). **Responderla en el campo y clic en "Agregar dato"**: el transcript se re-extrae y el faltante desaparece. Latencia visible (< 2 s). Explicar: schema estricto + blindaje que anula lo no literal.
4. **Confirmación (30 s).** Revisar, "Confirmar". Persistencia en SQLite local con autor, fecha y fuente.
5. **Base instalada (75 s).** Vista por hospital con estados, fecha/autor/fuente y "Fuente y evidencia" desplegable; resumen global: barras por modalidad, chips por país, **oportunidad de renovación** (8 años), frescura, aviso de duplicado/conflicto.
6. **Cierre (30 s).** Arquitectura en un proceso, modelo Qwen 600M Q4, métricas (12/12, 0 alucinaciones, p95 ~1.3 s), impacto Philips: de notas perdidas a inventario vivo con trazabilidad.
