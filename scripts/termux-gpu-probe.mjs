// Standalone probe under run_with_timeout in termux-start.sh. If the
// native addon hangs inside a static initializer (e.g. vkCreateInstance
// deadlocking on this device's driver), no JS exception ever fires — the
// only signal is how far these unbuffered marks got before SIGKILL.
import fs from "bare-fs";

function mark(step) {
  try {
    fs.writeSync(1, `probe:${step}\n`);
  } catch {
    // best-effort — if fd 1 itself is the problem there is nothing to log to
  }
}

mark("start");
const { registerPlugins } = await import("@qvac/inference/plugins");
mark("plugins-barrel-loaded");
const { llmPlugin } = await import("@qvac/inference/llamacpp-completion/plugin");
mark("llm-plugin-loaded"); // reaching here means the native addon's static init returned
registerPlugins([llmPlugin]);
mark("registered");
// writeSync, no console.log: el proceso puede quedar vivo (hilos nativos de
// Vulkan) hasta que el watchdog externo lo mate a los 20s, y console.log
// bufferea — se perdería justo esta línea si no se ha volcado a disco antes.
mark("gpu-probe-ok");
