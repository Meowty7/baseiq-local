<script setup lang="ts">
import type { OverviewResult } from "../services/api";

defineProps<{ overview: OverviewResult | null }>();

const MODALITY_LABELS: Record<string, string> = {
  resonador: "Resonadores",
  tomografo: "Tomógrafos",
  ecografo: "Ecógrafos",
  "rayos-x": "Rayos X",
  mamografo: "Mamógrafos",
  otra: "Otros",
};

function maxOf(entries: [string, number][]): number {
  return Math.max(1, ...entries.map(([, n]) => n));
}
</script>

<template>
  <section class="card">
    <h2>Resumen global</h2>
    <div v-if="!overview" class="muted">Cargando…</div>
    <div v-else>
      <p class="stat">{{ overview.observations }} observaciones · {{ overview.fieldsUnknown }} campos por verificar</p>
      <h3>Por modalidad</h3>
      <div v-for="([k, n]) in Object.entries(overview.byModality)" :key="k" class="bar-row">
        <span>{{ MODALITY_LABELS[k] ?? k }}</span>
        <div class="bar"><div :style="{ width: `${(n / maxOf(Object.entries(overview.byModality))) * 100}%` }" /></div>
        <b>{{ n }}</b>
      </div>
      <h3>Por país</h3>
      <p class="chips">
        <span v-for="([k, n]) in Object.entries(overview.byCountry)" :key="k" class="chip">{{ k }} · {{ n }}</span>
        <span v-if="Object.keys(overview.byCountry).length === 0" class="muted">Sin datos de país.</span>
      </p>
      <h3>Oportunidades de renovación <small>(≥ 7 años)</small></h3>
      <ul v-if="overview.renewals.length > 0" class="renew">
        <li v-for="(r, i) in overview.renewals" :key="i">
          {{ r.client }} · {{ r.modality ?? "equipo" }}{{ r.brand ? ` ${r.brand}` : "" }}{{ r.model ? ` ${r.model}` : "" }} · {{ r.ageYears }} años
        </li>
      </ul>
      <p v-else class="muted">Sin equipos en edad de renovación.</p>
      <p v-for="(d, i) in overview.duplicates" :key="i" class="question">Posible duplicado: {{ d }}</p>
    </div>
  </section>
</template>
