const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [".expo/*", ".expo-export-check/*", "dist/*", "src/api/generated/*", "expo-env.d.ts"],
  },
]);
