<script setup lang="ts">
import { onMounted, ref } from "vue";
import ObservationCapture from "./components/ObservationCapture.vue";
import ClientInstalledBase from "./components/ClientInstalledBase.vue";
import OverviewDashboard from "./components/OverviewDashboard.vue";
import { api, type OverviewResult } from "./services/api";
import type { ObservationRecord } from "../shared/observation";

const status = ref<{ ready: boolean; model: string; device: "gpu" | "cpu" | null; lastInferMs: number | null }>({ ready: false, model: "", device: null, lastInferMs: null });
const observations = ref<ObservationRecord[]>([]);
const overview = ref<OverviewResult | null>(null);

async function refresh() {
  try {
    const [s, list, ov] = await Promise.all([api.status(), api.list(), api.overview()]);
    status.value = s;
    observations.value = list;
    overview.value = ov;
  } catch {
    // backend aún no arranca; la UI reintenta
    setTimeout(refresh, 3000);
  }
}

onMounted(refresh);
</script>

<template>
  <header class="top">
    <div>
      <p class="kicker">Philips · Base instalada · prototipo de campo</p>
      <h1>BaseIQ Local</h1>
    </div>
    <p class="pill" :data-ready="status.ready">
      {{ status.ready ? "● IA local lista" : "○ cargando modelo…" }}
      <span v-if="status.device">{{ status.device.toUpperCase() }}</span>
      <span v-if="status.lastInferMs !== null">{{ (status.lastInferMs / 1000).toFixed(1) }} s</span>
    </p>
  </header>
  <main>
    <ObservationCapture @saved="refresh" />
    <div class="cols">
      <ClientInstalledBase :observations="observations" />
      <OverviewDashboard :overview="overview" :observations="observations" />
    </div>
  </main>
  <footer>100% en el dispositivo · QVAC {{ status.model }} · datos sintéticos</footer>
</template>
