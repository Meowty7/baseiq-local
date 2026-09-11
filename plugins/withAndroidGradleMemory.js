const { withGradleProperties } = require('@expo/config-plugins');

// Serial, low-RAM Gradle config. Kept as a config plugin (not a hand-edited
// android/gradle.properties) so it survives `expo prebuild`, which regenerates
// android/ from scratch. Needed on machines with ~12GB RAM, where the default
// parallel build spawns enough concurrent Gradle/Kotlin daemons to crash on
// native OOM (malloc failure) even though the JVM heap itself has headroom.
const OVERRIDES = {
  'org.gradle.jvmargs': '-Xmx1536m -XX:MaxMetaspaceSize=512m',
  'org.gradle.parallel': 'false',
  'org.gradle.workers.max': '1',
  'kotlin.daemon.jvm.options': '-Xmx768m',
};

function withAndroidGradleMemory(config) {
  return withGradleProperties(config, (config) => {
    for (const [key, value] of Object.entries(OVERRIDES)) {
      const existing = config.modResults.find(
        (item) => item.type === 'property' && item.key === key
      );
      if (existing) {
        existing.value = value;
      } else {
        config.modResults.push({ type: 'property', key, value });
      }
    }
    return config;
  });
}

module.exports = withAndroidGradleMemory;
