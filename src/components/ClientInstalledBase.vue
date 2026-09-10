<script setup lang="ts">
import type { ObservationRecord } from "../../shared/observation";

defineProps<{ observations: ObservationRecord[] }>();

function byClient(observations: ObservationRecord[]) {
  const map = new Map<string, ObservationRecord[]>();
  for (const o of observations) {
    const key = o.client ?? "Sin cliente";
    const list = map.get(key) ?? [];
    list.push(o);
    map.set(key, list);
  }
  return [...map.entries()];
}
</script>

<template>
  <section class="card">
    <h2>Base instalada por cliente</h2>
    <p v-if="observations.length === 0" class="muted">Sin observaciones todavía. Captura la primera arriba.</p>
    <article v-for="[client, list] in byClient(observations)" :key="client" class="client">
      <h3>{{ client }} <small>{{ list[0]?.city ?? "" }} {{ list[0]?.country ?? "" }}</small></h3>
      <ul>
        <li v-for="o in list" :key="o.id">
          <span v-for="(e, i) in o.equipment" :key="i">
            {{ e.quantity ?? "?" }}× {{ e.modality ?? "equipo" }}{{ e.brand ? ` ${e.brand}` : "" }}{{ e.model ? ` ${e.model}` : "" }}{{ e.ageYears !== null ? ` · ${e.ageYears} años` : "" }};
          </span>
          <em class="status" :data-s="o.status">{{ o.status }}</em>
        </li>
      </ul>
    </article>
  </section>
</template>
