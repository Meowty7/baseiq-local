# Reto Philips — Inteligencia de la base instalada de clientes

Traducción al español del brief oficial (`doc-1788886999143-c967da0a.docx`). El original en inglés está en `docs/philips-brief.md`.

Convertir lo que un colaborador ve en una visita en una vista viva, confiable y accionable del parque tecnológico de cada cliente.

---

## En una frase

Haz un prototipo donde capturar lo que viste en el hospital sea tan fácil como tener una conversación.

## El problema que Philips quiere resolver

Cada día, ingenieros de servicio, vendedores, especialistas de aplicación y gerentes de cuenta visitan hospitales y clínicas. Ven resonadores, tomógrafos, ecógrafos, monitores y otros equipos, de distintas marcas.

Ese conocimiento hoy se queda en notas personales, conversaciones o memoria. Capturarlo a mano toma tiempo, las descripciones no coinciden, varias personas reportan el mismo equipo y las observaciones suelen ser incompletas. Es difícil agregar todo eso por hospital, ciudad, país o región.

Philips tiene poca visibilidad del panorama tecnológico real de muchos clientes. Quiere que la IA, una interfaz conversacional y un tablero conviertan esas visitas en un dataset estructurado de **inteligencia de base instalada**.

## Tu misión

Después de una visita, el colaborador abre una app (o Teams) y dice algo como:

> «Hoy visité el Hospital Alpha. Tienen tres resonadores, dos tomógrafos y cuatro ecógrafos. Dos de los resonadores parecen de unos 8 a 10 años.»

> «Estoy en el Hospital Alpha, en São Paulo. Vi dos tomógrafos y tres resonadores. Uno de los resonadores se ve relativamente nuevo.»

La solución debe interpretar eso, extraer lo relevante, estructurarlo y actualizar un repositorio. Con el tiempo, muchas observaciones sueltas pintan el paisaje tecnológico de los clientes.

## Qué puedes construir

### 1. Captura conversacional

Una interfaz intuitiva. Puede ser agente de Teams, app web o móvil, asistente de voz, chatbot u otra idea. El usuario habla o escribe de forma natural: no llena un formulario largo.

### 2. Extracción con IA

La IA saca de ese texto:

| Área | Campos de ejemplo |
|---|---|
| Cliente | Nombre del hospital o clínica, ciudad, país, sede |
| Equipo | Modalidad (resonador, tomógrafo, etc.), fabricante, modelo si se conoce, cantidad, antigüedad o año de instalación si se conoce, comentarios |
| Observación | Quién la envió, fecha, nivel de confianza, tipo de fuente, notas |

Si alguien solo sabe «hay tres resonadores» y no conoce marca ni edad, eso **igual vale**. No tires la observación.

### 3. Validación inteligente

- Pregunta lo que falta. Ejemplo: «Tienen dos tomógrafos» → «¿Sabes marca o modelo?» → «Uno tiene unos seis años, no sé el modelo.»
- Detecta posibles duplicados o contradicciones.
- No trates todo como hecho. Usa estados:

**Confirmado · Reportado · Estimado · Desconocido**

Así el dataset gana confianza con el tiempo.

## Qué espera ver Philips

No solo recolectar. Mostrar cómo una observación se vuelve inteligencia accionable.

### Vista 360 del cliente

Perfil del hospital con su parque conocido. Ejemplo: Hospital Alpha — São Paulo. Se puede entrar a cada observación y ver cuándo se actualizó.

| Tipo de equipo | Cantidad | Antigüedad aprox. | Confianza |
|---|---|---|---|
| Resonador | 3 | 4–10 años | Alta |
| Tomógrafo | 2 | Desconocida | Media |
| Ecógrafo | 5 | Mixta | Media |

### Mapa geográfico

Navegar: Región → País → Ciudad → Cliente → Equipos. Al elegir Brasil, ver clínicas con observaciones y un resumen por modalidad.

### Tablero y analítica

- Equipos por modalidad, geografía y edad
- Clientes con tecnología envejecida
- Clientes con información incompleta
- Sitios actualizados recientemente
- Confianza y frescura de los datos
- Oportunidades de renovación o upgrade

## El prototipo del hackathon

No piden un sistema de empresa. Piden el concepto de punta a punta:

**Capturar → Entender → Estructurar → Validar → Guardar → Visualizar → Sacar insight**

Ejemplo de flujo: alguien envía una observación → la IA extrae cliente, lugar, tipo, cantidad, edad → el sistema pregunta si falta algo importante → compara con lo ya guardado → persiste → el tablero o el mapa se actualiza → se puede explorar por cliente o por geografía.

### Mínimo que debes demostrar

1. Captura en lenguaje natural
2. Extracción con IA de datos estructurados
3. Almacenamiento en un dataset estructurado
4. Vista de base instalada por cliente
5. Agregación o visualización básica entre varios clientes

### Metas extra (si sobra tiempo)

- Dictado por voz al terminar la visita
- Foto de etiquetas o placas (si el modelo de visión lo permite)
- Detección de duplicados
- Puntaje de confianza (completitud, antigüedad, confirmaciones independientes)
- Alertas de información no verificada hace tiempo
- Preguntas automáticas por el dato faltante más valioso
- Consultas en lenguaje natural: «clientes en Brasil con resonadores de más de siete años»
- Identificar sitios con oportunidad de renovación

## Criterios de diseño (cómo te van a mirar)

- **Simplicidad:** segundos, no minutos.
- **Adopción:** ¿por qué un técnico lo usaría después de cada visita?
- **Calidad:** distinguir observación de dato verificado.
- **Confianza:** de dónde salió la info y cuándo se observó.
- **Privacidad:** datos de cliente tratados con cuidado. En el hackathon, **solo dataset sintético**.
- **Escala:** imaginar miles de clientes y varios países.

## La pregunta grande

Hoy, cada visita genera conocimiento. ¿Puedes convertir miles de observaciones sueltas en una vista viva, confiable y accionable de la base instalada?

Construye la capa de inteligencia que une lo que la gente ve en campo con lo que la organización puede saber.

## Regla de datos (importante)

Usa un dataset **sintético y pequeño**. Prohibido: datos confidenciales de clientes reales o información competitiva real. Inventa hospitales, marcas, modelos y ciudades.

---

## Cómo encaja BaseIQ Local con este brief

Ya cubrimos el mínimo: captura, extracción local con QVAC, estados, vista por hospital y resumen entre clientes. También hay alerta de renovación (≥ 7 años) y aviso de duplicado.

Lo que el brief pide y todavía no mostramos bien en pantalla: quién observó, cuándo y de dónde salió el dato (confianza / frescura). El mapa y las consultas en lenguaje natural son extras; no hace falta inventarlos para el video.
