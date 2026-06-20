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
    plugins: [
      'react-native-reanimated/plugin',
    ],
  };
};
