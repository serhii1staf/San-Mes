/**
 * EAS Build hook (`eas-build-pre-install` in package.json). It runs on the build worker before
 * `npm install`, `expo prebuild` and `pod install`, and edits only the worker's copy of the project.
 *
 * On iOS builds it turns on Reanimated's static flag DISABLE_COMMIT_PAUSING_MECHANISM by adding it to
 * package.json, which is where RNReanimated.podspec reads static flags from at `pod install`
 * (node_modules/react-native-reanimated/scripts/reanimated_utils.rb, `get_static_feature_flags`).
 *
 * What the flag fixes: Reanimated skips its own frame updates while a React commit is in flight
 * (ReanimatedCommitHook pauses, ReanimatedMountHook resumes), so anything following the keyboard
 * frame by frame stalls for those frames and then catches up. That is the "sagging" search field.
 *
 * Why iOS only, and why here instead of in package.json:
 * - Reanimated's docs: the flag is safe only together with React Native's
 *   `preventShadowTreeCommitExhaustion`. Without it, React commits can starve and the app stops
 *   responding.
 * - iOS gets that flag from `ReactNativeReleaseLevel: "experimental"` in app.json (ios.infoPlist),
 *   read by ExpoReactNativeFactory. In RN 0.81.5 the iOS experimental overrides extend the stable
 *   ones and add only `preventShadowTreeCommitExhaustion` and `useTurboModuleInterop`. Nothing on
 *   iOS reads the second one: native code only hands it to JS, and no JS reads it
 *   (TurboModuleRegistry.js decides from the RN$UnifiedNativeModuleProxy global instead).
 * - Android has no equivalent switch without side effects. Its experimental overrides do not extend
 *   the stable ones (ReactNativeFeatureFlagsOverrides_RNOSS_Experimental_Android), so they would also
 *   drop `useShadowNodeStateOnClone` and turn on two experimental Android implementations. Android's
 *   build.gradle reads the same package.json, so a flag written there would reach Android builds
 *   without the protection. Writing it here, for iOS only, keeps it out of them.
 */
const fs = require('fs');
const path = require('path');

const platform = process.env.EAS_BUILD_PLATFORM;
if (platform !== 'ios') {
  console.log(`[eas-build-pre-install] ${platform || 'unknown platform'}: nothing to change`);
  process.exit(0);
}

const file = path.join(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
pkg.reanimated = pkg.reanimated || {};
pkg.reanimated.staticFeatureFlags = {
  ...(pkg.reanimated.staticFeatureFlags || {}),
  DISABLE_COMMIT_PAUSING_MECHANISM: true,
};
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(
  `[eas-build-pre-install] ios: reanimated.staticFeatureFlags = ${JSON.stringify(pkg.reanimated.staticFeatureFlags)}`,
);
