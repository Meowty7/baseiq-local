import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default {
  plugins: ["@qvac/sdk/llamacpp-completion/plugin"],
  loggerLevel: "info",
  loggerConsoleOutput: true,
  httpDownloadConcurrency: 3,
  httpConnectionTimeoutMs: 10000,
  cacheDirectory: path.join(root, ".qvac", "models"),
};
