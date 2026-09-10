<script setup lang="ts">
import { ref } from "vue";
import { api, type ExtractionResult } from "../services/api";
import { appendFollowUp, type ObservationDraft } from "../../shared/observation";

const emit = defineEmits<{ saved: [] }>();

const text = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const result = ref<ExtractionResult | null>(null);
const draft = ref<ObservationDraft | null>(null);
const saving = ref(false);
const submittedBy = ref("");
const observedAt = ref(new Date().toISOString().slice(0, 10));
const sourceType = ref("visita");
const followAnswer = ref("");
const transcript = ref("");

const EXAMPLES = [
  "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo. Uno de los resonadores parece de unos ocho años.",
  "Clínica Brisa del Norte, Bogotá, Colombia. Tres ecógrafos Novascan NS-200 de unos cinco años.",
  "Hospital Valle Serena en Madrid. Un tomógrafo Medtron de tres años y dos equipos de rayos X sin marca visible.",
];

async function extract() {
  if (text.value.trim().length < 10 || loading.value) return;
  transcript.value = text.value.trim();
  await runExtraction(transcript.value);
}

async function answerFollowUp() {
  if (!result.value || followAnswer.value.trim().length < 2 || loading.value) return;
  transcript.value = appendFollowUp(transcript.value, followAnswer.value);
  followAnswer.value = "";
  await runExtraction(transcript.value);
}

async function runExtraction(input: string) {
  loading.value = true;
  error.value = null;
  result.value = null;
  try {
    result.value = await api.extract(input);
    draft.value = JSON.parse(JSON.stringify(result.value.draft));
  } catch (e) {
    error.value = e instanceof Error ? e.message : "extract_failed";
  } finally {
    loading.value = false;
  }
}

async function confirm(status: "Confirmado" | "Reportado" | "Estimado" | "Desconocido") {
  if (!draft.value || !result.value || saving.value) return;
  if (!draft.value.client) {
    error.value = "Falta el cliente: complétalo antes de guardar.";
    return;
  }
  saving.value = true;
  try {
    await api.save({
      client: draft.value.client,
      city: draft.value.city,
      country: draft.value.country,
      status,
      sourceText: result.value.sourceText,
      equipment: draft.value.equipment,
      submittedBy: submittedBy.value.trim() || null,
      observedAt: observedAt.value || null,
      sourceType: sourceType.value,
      comments: null,
    });
    result.value = null;
    draft.value = null;
    text.value = "";
    emit("saved");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "save_failed";
  } finally {
    saving.value = false;
  }
}

function updateEquipment(index: number, field: string, value: string) {
  if (!draft.value) return;
  const eq = draft.value.equipment[index];
  if (!eq) return;
  if (field === "quantity" || field === "ageYears") {
    const n = value === "" ? null : Number(value);
    (eq as Record<string, unknown>)[field] = Number.isInteger(n) ? n : null;
  } else {
    (eq as Record<string, unknown>)[field] = value === "" ? null : value;
  }
}
</script>

<template>
  <section class="card">
    <h2>Nueva observación</h2>
    <label class="field">
      <span>Lo que viste en la visita</span>
      <textarea v-model="text" rows="4" placeholder="Ej.: Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores…" />
    </label>
    <div class="grid meta">
      <label>Quién observó <input v-model="submittedBy" placeholder="Nombre del colaborador" /></label>
      <label>Fecha de visita <input v-model="observedAt" type="date" /></label>
      <label>Fuente
        <select v-model="sourceType">
          <option value="visita">visita presencial</option>
          <option value="llamada">llamada</option>
          <option value="reporte">reporte de tercero</option>
        </select>
      </label>
    </div>
    <div class="row">
      <button :disabled="loading || text.trim().length < 10" @click="extract">
        {{ loading ? "Extrayendo en el dispositivo…" : "Extraer con IA local" }}
      </button>
    </div>
    <div class="examples">
      <button v-for="ex in EXAMPLES" :key="ex" class="link" @click="text = ex">
        {{ ex.slice(0, 60) }}…
      </button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="result && draft" class="review">
      <h3>Borrador extraído <small>({{ (result.inferMs / 1000).toFixed(1) }} s en local)</small></h3>
      <div class="grid">
        <label>Cliente <input v-model="draft.client" /></label>
        <label>Ciudad <input v-model="draft.city" /></label>
        <label>País <input v-model="draft.country" /></label>
      </div>
      <div v-for="(eq, i) in draft.equipment" :key="i" class="equip">
        <h4>Equipo {{ i + 1 }}</h4>
        <div class="grid">
          <label>Modalidad
            <select :value="eq.modality ?? ''" @change="updateEquipment(i, 'modality', ($event.target as HTMLSelectElement).value)">
              <option value="">—</option>
              <option value="resonador">resonador</option>
              <option value="tomografo">tomógrafo</option>
              <option value="ecografo">ecógrafo</option>
              <option value="rayos-x">rayos X</option>
              <option value="mamografo">mamógrafo</option>
              <option value="otra">otra</option>
            </select>
          </label>
          <label>Cantidad <input type="number" min="1" :value="eq.quantity ?? ''" @input="updateEquipment(i, 'quantity', ($event.target as HTMLInputElement).value)" /></label>
          <label>Marca <input :value="eq.brand ?? ''" @input="updateEquipment(i, 'brand', ($event.target as HTMLInputElement).value)" /></label>
          <label>Modelo <input :value="eq.model ?? ''" @input="updateEquipment(i, 'model', ($event.target as HTMLInputElement).value)" /></label>
          <label>Antigüedad (años) <input type="number" min="0" max="60" :value="eq.ageYears ?? ''" @input="updateEquipment(i, 'ageYears', ($event.target as HTMLInputElement).value)" /></label>
        </div>
        <p v-if="eq.evidence" class="evidence">“{{ eq.evidence }}”</p>
      </div>
      <p v-if="result.question" class="question">{{ result.question }}</p>
      <div v-if="result.question" class="follow">
        <input v-model="followAnswer" placeholder="Responde aquí, ej.: Es de la marca Novascan" @keyup.enter="answerFollowUp" />
        <button :disabled="loading || followAnswer.trim().length < 2" @click="answerFollowUp">Agregar dato</button>
      </div>
      <div class="row">
        <button class="primary" :disabled="saving" @click="confirm('Confirmado')">Confirmar</button>
        <button :disabled="saving" @click="confirm('Reportado')">Guardar como reportado</button>
        <button :disabled="saving" @click="confirm('Estimado')">Guardar como estimado</button>
        <button :disabled="saving" @click="confirm('Desconocido')">Sin confirmar</button>
      </div>
    </div>
  </section>
</template>
