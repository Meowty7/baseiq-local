const { getDefaultConfig } = require("expo/metro-config");

module.exports = (() => {
  const config = getDefaultConfig(__dirname);
  // Metro defaults to one transform worker per CPU core. On a low-RAM dev
  // machine that spawns enough Node processes to swap to disk and stall
  // bundling indefinitely (same class of problem as the Gradle daemon OOM).
  config.maxWorkers = 2;
  return config;
})();
