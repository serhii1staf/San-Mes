// https://docs.expo.dev/guides/using-eslint/
//
// Scaffolded by `expo lint`. The ignore list mirrors `tsconfig.json`'s
// `exclude`: the Cloudflare Worker under `workers/` has its own toolchain
// (vitest + its own tsconfig) and must not be linted with the React Native
// config, and generated/build output is not ours to lint.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/*',
      'workers/**',
      '.expo/**',
      'ios/**',
      'android/**',
      'coverage/**',
    ],
  },
]);
