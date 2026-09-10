// Standalone probe: does loading the LLaMA addon with GPU .so files present
// hang or fail cleanly? Run under run_with_timeout from termux-start.sh —
// this file must never be trusted to exit on its own.
import { registerPlugins } from "@qvac/inference/plugins";
import { llmPlugin } from "@qvac/inference/llamacpp-completion/plugin";

registerPlugins([llmPlugin]);
console.log("gpu-probe-ok");
