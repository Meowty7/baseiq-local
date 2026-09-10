<script setup lang="ts">
import { ref } from "vue";
import { api, type ExtractionResult } from "../services/api";
import type { ObservationDraft } from "../../shared/observation";

const emit = defineEmits<{ saved: [] }>();

const text = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const result = ref<ExtractionResult | null>(null);
const draft = ref<ObservationDraft | null>(null);
const saving = ref(false);

const EXAMPLES = [
  "Estoy en Hospital DemoCare Pacific, en Panamá. Vi dos resonadores y un tomógrafo. Uno de los resonadores parece de unos ocho años.",
  "Clínica Santa Fe, Bogotá, Colombia. Tres ecógrafos GE Voluson de unos cinco años.",
  "Hospital Reina Sofía en Madrid. Un tomógrafo Siemens de tres años y dos equipos de rayos X sin marca visible.",
];

async function extract() {
  if (text.value.trim().length < 10 || loading.value) return;
  loading.value = true;
  error.value = null;
  result.value = null;
  try {
    result.value = await api.extract(text.value.trim());
    draft.value = JSON.parse(JSON.stringify(result.value.draft));
  } catch (e) {
    error.value = e instanceof Error ? e.message : "extract_failed";
  } finally {
    loading.value = false;
  }
}

async function confirm(status: "Confirmado" | "Reportado" | "Estimado") {
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
      <div class="row">
        <button class="primary" :disabled="saving" @click="confirm('Confirmado')">Confirmar</button>
        <button :disabled="saving" @click="confirm('Reportado')">Guardar como reportado</button>
        <button :disabled="saving" @click="confirm('Estimado')">Guardar como estimado</button>
      </div>
    </div>
  </section>
</template>
