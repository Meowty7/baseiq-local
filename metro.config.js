const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

// BareKit loads `@qvac/sdk/worker.mobile.bundle` (copied at prebuild into
// node_modules). Keep it aliased to the project bundle so NMT/LLM plugins
// match qvac.config.json without a stale SDK copy.
module.exports = (() => {
  const config = getDefaultConfig(__dirname);
  const workerBundle = path.resolve(__dirname, "qvac/worker.bundle.js");
  const defaultResolve = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === "@qvac/sdk/worker.mobile.bundle") {
      return { type: "sourceFile", filePath: workerBundle };
    }
    if (defaultResolve) return defaultResolve(context, moduleName, platform);
    return context.resolveRequest(context, moduleName, platform);
  };
  return config;
})();
