# Guion de demo (máx. 5 min)

Grabar con Wi‑Fi **desconectado** (icono visible) a 768–1024 px de ancho.

1. **Problema (30 s).** Técnico en hospital sin red, datos sensibles del cliente. Nada puede ir a la nube. Mostrar `http://127.0.0.1:3001` + pastilla "IA local lista".
2. **Observación (45 s).** Pegar: "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo. Uno de los resonadores parece de unos ocho años." Clic en "Extraer con IA local".
3. **Extracción (60 s).** Borrador con evidencia citada, pregunta de seguimiento ("¿En qué ciudad…?"), latencia visible (~1–2 s). Explicar: schema estricto + blindaje que anula lo no literal.
4. **Confirmación (30 s).** Corregir cantidad si hace falta, "Confirmar". Persistencia en SQLite local.
5. **Base instalada (60 s).** Vista por hospital con estados; resumen global: barras por modalidad, chips por país, **oportunidad de renovación** (8 años), aviso de duplicado.
6. **Cierre (45 s).** Arquitectura en un proceso, modelo Qwen 600M Q4, métricas (0 alucinaciones, p95 < 6 s), impacto Philips: de notas perdidas a inventario vivo.
