/**
 * Expo config plugin: relax one fatal Android release-lint check.
 *
 * The app localizes the iOS permission prompts (NSPhotoLibraryUsageDescription,
 * NSCameraUsageDescription, …) via `expo.locales` (locales/en.json + ru.json).
 * Expo prebuild copies those strings into Android `values-b+en` / `values-b+ru`
 * string resources too, but they have no entry in the DEFAULT `values/strings.xml`
 * (they're iOS-only). Android's `lintVitalRelease` then aborts the release build
 * with fatal `ExtraTranslation` errors.
 *
 * These strings are harmless on Android (never looked up there), so we disable
 * ONLY the `ExtraTranslation` check for the app module. Everything else lint
 * checks stays on. This keeps the localized iOS permission dialogs intact while
 * letting the Android release build (AAB) assemble.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const LINT_MARKER = '// LINT_EXTRATRANSLATION_DISABLE';

const LINT_BLOCK = `
    ${LINT_MARKER}
    lint {
        // iOS-only NS* permission strings are emitted into Android localized
        // resources without a default-locale fallback; they are never read on
        // Android, so this otherwise-fatal release-lint check is disabled.
        disable += ['ExtraTranslation']
    }
`;

function withAndroidLintDisable(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    if (contents.includes(LINT_MARKER)) {
      return config;
    }

    // Insert the lint block right after the opening of the `android {` block.
    const androidBlock = /android\s*\{/;
    if (androidBlock.test(contents)) {
      contents = contents.replace(androidBlock, (match) => `${match}\n${LINT_BLOCK}`);
      config.modResults.contents = contents;
    } else {
      console.warn('[withAndroidLintDisable] Could not find `android {` block in app/build.gradle');
    }

    return config;
  });
}

module.exports = withAndroidLintDisable;
