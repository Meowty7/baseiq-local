<script setup lang="ts">
import { computed } from "vue";
import type { ObservationRecord } from "../../shared/observation";
import { aggregate360 } from "../../shared/observation";

const props = defineProps<{ observations: ObservationRecord[] }>();

const rows = computed(() => aggregate360(props.observations));

const byClient = computed(() => {
  const map = new Map<string, typeof rows.value>();
  for (const r of rows.value) {
    const list = map.get(r.client) ?? [];
    list.push(r);
    map.set(r.client, list);
  }
  return [...map.entries()];
});
</script>

<template>
  <section class="card">
    <h2>Customer 360 — base instalada</h2>
    <p v-if="rows.length === 0" class="muted">Sin observaciones todavía. Captura la primera arriba.</p>
    <article v-for="[client, list] in byClient" :key="client" class="client">
      <h3>{{ client }} <small>{{ list[0]?.city ?? "" }}{{ list[0]?.country ? `, ${list[0].country}` : "" }}</small></h3>
      <table class="table360">
        <thead>
          <tr><th>Modalidad</th><th>Cant.</th><th>Edad</th><th>Confianza</th><th>Frescura</th><th>Última visita</th><th>Obs.</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in list" :key="r.modality">
            <td>{{ r.modality }}</td>
            <td>{{ r.quantity }}</td>
            <td>{{ r.ageRange ?? "—" }}</td>
            <td><em class="status" :data-s="r.confidence">{{ r.confidence }}</em></td>
            <td>{{ r.freshness }}</td>
            <td>{{ r.lastSeen }}</td>
            <td>{{ r.observations }}</td>
          </tr>
        </tbody>
      </table>
      <details>
        <summary>Observaciones individuales ({{ props.observations.filter((o) => o.client === client).length }})</summary>
        <ul>
          <li v-for="o in props.observations.filter((o) => o.client === client)" :key="o.id" class="obs">
            <span v-for="(e, i) in o.equipment" :key="i">
              {{ e.quantity ?? "?" }}× {{ e.modality ?? "equipo" }}{{ e.brand ? ` ${e.brand}` : "" }}{{ e.model ? ` ${e.model}` : "" }}{{ e.ageYears !== null ? ` · ${e.ageYears} años` : "" }};
            </span>
            <em class="status" :data-s="o.status">{{ o.status }}</em>
            <span class="meta-line">{{ o.observedAt ?? o.createdAt.slice(0, 10) }}{{ o.submittedBy ? ` · ${o.submittedBy}` : "" }}{{ o.sourceType ? ` · ${o.sourceType}` : "" }}</span>
            <details>
              <summary>Fuente y evidencia</summary>
              <p class="evidence" v-for="(e, i) in o.equipment.filter((x) => x.evidence)" :key="i">"{{ e.evidence }}"</p>
              <p class="source">{{ o.sourceText }}</p>
            </details>
          </li>
        </ul>
      </details>
    </article>
  </section>
</template>
