/**
 * Expo config plugin: Xcode 26 fmt consteval workaround.
 * 
 * Patches the Podfile to add a post_install hook that sets FMT_USE_CONSTEVAL=0
 * in fmt/base.h after CocoaPods downloads the source.
 * 
 * This fixes the compilation error with Xcode 26 where fmt's consteval
 * detection incorrectly enables consteval support that doesn't compile.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const FMT_PATCH_MARKER = '# FMT_XCODE26_PATCH';

const FMT_PATCH_CODE = `
${FMT_PATCH_MARKER}
# Xcode 26 workaround: disable FMT_USE_CONSTEVAL in fmt library
def patch_fmt_for_xcode26(installer)
  fmt_base = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
  unless File.exist?(fmt_base)
    # Try alternative path
    Dir.glob(File.join(installer.sandbox.root, '**', 'fmt', 'base.h')).each do |f|
      fmt_base = f
      break
    end
  end
  return unless File.exist?(fmt_base)
  content = File.read(fmt_base)
  if content.include?('#  define FMT_USE_CONSTEVAL 1')
    patched = content.gsub('#  define FMT_USE_CONSTEVAL 1', '#  define FMT_USE_CONSTEVAL 0')
    File.chmod(0644, fmt_base) rescue nil
    File.write(fmt_base, patched)
    Pod::UI.puts "[FMT PATCH] Applied Xcode 26 workaround: FMT_USE_CONSTEVAL=0"
  else
    Pod::UI.puts "[FMT PATCH] Already patched or not needed"
  end
end
`;

function withFmtPatch(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');

      if (!fs.existsSync(podfilePath)) {
        console.warn('[withFmtPatch] Podfile not found at:', podfilePath);
        return config;
      }

      let content = fs.readFileSync(podfilePath, 'utf8');

      // Skip if already patched
      if (content.includes(FMT_PATCH_MARKER)) {
        console.log('[withFmtPatch] Already patched, skipping');
        return config;
      }

      // Insert the patch function definition before post_install
      // and add the call inside post_install
      if (content.includes('post_install do |installer|')) {
        // Add function definition before post_install
        content = content.replace(
          'post_install do |installer|',
          `${FMT_PATCH_CODE}\npost_install do |installer|\n    patch_fmt_for_xcode26(installer)`
        );
      } else {
        // No post_install exists — append one
        content += `\n${FMT_PATCH_CODE}\npost_install do |installer|\n  patch_fmt_for_xcode26(installer)\nend\n`;
      }

      fs.writeFileSync(podfilePath, content);
      console.log('[withFmtPatch] ✅ Podfile patched with fmt Xcode 26 workaround');

      return config;
    },
  ]);
}

module.exports = withFmtPatch;
