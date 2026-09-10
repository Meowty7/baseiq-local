import { initializeWorker } from "@qvac/sdk/worker-lifecycle";
import { registerPlugins } from "@qvac/inference/plugins";
import { llmPlugin } from "@qvac/inference/llamacpp-completion/plugin";

console.log("probe: init");
initializeWorker();
console.log("probe: plugins");
registerPlugins([llmPlugin]);
console.log("probe-ok");
