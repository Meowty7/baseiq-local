import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { bundleSdk } from "@qvac/sdk/commands";

const r = await bundleSdk({
  projectRoot: process.cwd(),
  configPath: "./qvac.config.json",
  hosts: ["android-arm64", "ios-arm64", "ios-arm64-simulator", "ios-x64-simulator"],
  defer: ["expo-file-system", "react-native-bare-kit", "@qvac/sdk/worker.mobile.bundle"],
});

copyFileSync(r.bundlePath, join("node_modules/@qvac/sdk/dist/worker.mobile.bundle.js"));

console.log(JSON.stringify({ plugins: r.plugins, addons: r.addons, bundlePath: r.bundlePath }, null, 2));
