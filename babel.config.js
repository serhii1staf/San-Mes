module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // NOTE: the standalone @babel/plugin-transform-class-properties /
    // -private-methods / -private-property-in-object plugins were removed.
    // babel-preset-expo (SDK 54) already includes @babel/preset-typescript +
    // the class-features transforms in the CORRECT order (TS `declare` fields
    // are stripped BEFORE class-properties runs). Having the standalone
    // class-properties plugin run first made it choke on the `declare` class
    // fields in expo-file-system's shipped TS source
    // ("declare fields must first be transformed by @babel/plugin-transform-
    // typescript"), which broke the Metro bundle. Letting the preset own these
    // transforms fixes it. Reanimated's plugin must stay LAST.
    env: {
      production: {
        plugins: [
          // Strip console.log/debug/info from release bundles.
          //
          // These are not free. Every call crosses into the native logging
          // bridge on the JS thread, and the app ships 26 of them on paths that
          // run during scrolling and rendering. React Native's own performance
          // guide calls this out as a significant JS-thread bottleneck in
          // bundled apps.
          //
          // `error` and `warn` are kept: existing diagnostics depend on them
          // (including the Sentry init failure path), and removing them would
          // silently blind us rather than speed anything up meaningfully.
          ['transform-remove-console', { exclude: ['error', 'warn'] }],
        ],
      },
    },
    // NO manual worklets/reanimated plugin entry. This is deliberate and verified.
    //
    // `babel-preset-expo` (SDK 54) adds it ITSELF. From
    // node_modules/babel-preset-expo/build/index.js:
    //
    //     hasModule('react-native-worklets') && ...
    //       ? [require('react-native-worklets/plugin')]
    //       : hasModule('react-native-reanimated') && [require('react-native-reanimated/plugin')]
    //
    // `react-native-worklets` IS installed (0.5.1, required by Reanimated 4), so the
    // preset picks `react-native-worklets/plugin` — the correct plugin for Reanimated 4,
    // which moved workletization out of the reanimated package.
    //
    // This file used to ALSO list `react-native-reanimated/plugin` by hand, so the
    // pipeline ran BOTH: the preset's worklets plugin and the legacy reanimated one.
    // That is a second workletization pass over every worklet in the app, and it is what
    // Reanimated 4 warns about ("It was moved to react-native-worklets package. Please
    // use react-native-worklets/plugin instead" — software-mansion/react-native-reanimated#8231).
    //
    // Expo's own upgrade note is explicit that with babel-preset-expo there is nothing to
    // specify: https://github.com/expo/fyi/blob/main/expo-54-reanimated.md
    //
    // If a worklet ever fails to compile after this, the fix is NOT to re-add the entry
    // here — check that `react-native-worklets` is still installed.
  };
};
