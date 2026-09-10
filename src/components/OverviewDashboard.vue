<script setup lang="ts">
import { computed } from "vue";
import type { OverviewResult } from "../services/api";
import type { ObservationRecord } from "../../shared/observation";

const props = defineProps<{ overview: OverviewResult | null; observations: ObservationRecord[] }>();

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

const geoTree = computed(() => {
  const tree = new Map<string, Map<string, Map<string, number>>>();
  for (const o of props.observations) {
    const country = o.country ?? "Sin país";
    const city = o.city ?? "Sin ciudad";
    const client = o.client ?? "Sin cliente";
    const cities = tree.get(country) ?? new Map();
    const clients = cities.get(city) ?? new Map();
    clients.set(client, (clients.get(client) ?? 0) + 1);
    cities.set(city, clients);
    tree.set(country, cities);
  }
  return [...tree.entries()].map(([country, cities]) => ({
    country,
    cities: [...cities.entries()].map(([city, clients]) => ({
      city,
      clients: [...clients.entries()].map(([client, n]) => ({ client, n })),
    })),
  }));
});
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
      <h3>Mapa geográfico</h3>
      <details v-for="g in geoTree" :key="g.country" class="geo-node">
        <summary>{{ g.country }} ({{ g.cities.reduce((a, c) => a + c.clients.reduce((b, cl) => b + cl.n, 0), 0) }} obs.)</summary>
        <details v-for="c in g.cities" :key="c.city" class="geo-node" style="margin-left: 1rem">
          <summary>{{ c.city }} ({{ c.clients.reduce((a, cl) => a + cl.n, 0) }})</summary>
          <ul style="margin-left: 2rem">
            <li v-for="cl in c.clients" :key="cl.client">{{ cl.client }} ({{ cl.n }})</li>
          </ul>
        </details>
      </details>
      <p v-if="geoTree.length === 0" class="muted">Sin datos geográficos.</p>
      <h3>Oportunidades de renovación <small>(≥ 7 años)</small></h3>
      <ul v-if="overview.renewals.length > 0" class="renew">
        <li v-for="(r, i) in overview.renewals" :key="i">
          {{ r.client }} · {{ r.modality ?? "equipo" }}{{ r.brand ? ` ${r.brand}` : "" }}{{ r.model ? ` ${r.model}` : "" }} · {{ r.ageYears }} años
        </li>
      </ul>
      <p v-else class="muted">Sin equipos en edad de renovación.</p>
      <h3>Frescura de datos</h3>
      <p v-if="overview.stale.length === 0" class="muted">Todo verificado recientemente.</p>
      <p v-for="(s, i) in overview.stale" :key="i" class="question">{{ s }}</p>
      <h3>Conflictos <small>(no se fusionan solos)</small></h3>
      <p v-if="overview.conflicts.length === 0" class="muted">Sin observaciones contradictorias.</p>
      <p v-for="(c, i) in overview.conflicts" :key="i" class="question">
        {{ c.client }} · {{ c.modality }}: {{ c.detail }} ({{ c.dates.join(" / ") }})
      </p>
      <p v-for="(d, i) in overview.duplicates" :key="i" class="question">Posible duplicado: {{ d }}</p>
    </div>
  </section>
</template>
