import { initializeWorker, ensureRPCSetup } from "@qvac/sdk/worker-lifecycle";
import { registerPlugins } from "@qvac/inference/plugins";
import { llmPlugin } from "@qvac/inference/llamacpp-completion/plugin";

const { hasRPCConfig } = initializeWorker();
registerPlugins([llmPlugin]);
if (hasRPCConfig) ensureRPCSetup();
