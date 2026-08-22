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
    plugins: [
      'react-native-reanimated/plugin',
    ],
  };
};
