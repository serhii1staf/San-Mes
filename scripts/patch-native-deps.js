/**
 * `postinstall`: small source fixes to native dependencies, applied to node_modules after every
 * install (locally, on the GitHub runners and on the EAS build workers, which all run `npm install`).
 * Each fix is idempotent, looks for the exact text it replaces, and only warns when that text is
 * missing (a dependency update changed the file), so an install never fails because of this script.
 * Native changes reach users only with a new binary, never through an over-the-air update.
 */
/* global __dirname */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function patchFile(label, relPath, apply) {
  const file = path.join(root, relPath);
  if (!fs.existsSync(file)) {
    console.log(`[patch-native-deps] ${label}: ${relPath} not found, skipped`);
    return;
  }
  try {
    const before = fs.readFileSync(file, 'utf8');
    const result = apply(before);
    if (result === null) {
      console.log(`[patch-native-deps] ${label}: already applied`);
    } else if (result === undefined) {
      console.warn(`[patch-native-deps] ${label}: the text it replaces is not in ${relPath} (dependency updated?), NOT applied`);
    } else {
      fs.writeFileSync(file, result);
      console.log(`[patch-native-deps] ${label}: applied to ${relPath}`);
    }
  } catch (e) {
    console.warn(`[patch-native-deps] ${label}: failed (${e && e.message}), skipped`);
  }
}

// ── 1. fmt: consteval off (Xcode 26) ─────────────────────────────────────────────────────────────
// Moved here unchanged from the inline postinstall; eas-build-post-install.sh and
// plugins/withFmtPatch do the same for the copies in ios/Pods.
patchFile('fmt FMT_USE_CONSTEVAL', 'node_modules/react-native/ReactCommon/fmt/include/fmt/base.h', (src) => {
  if (!src.includes('define FMT_USE_CONSTEVAL 1')) return null;
  return src.replace(/#  define FMT_USE_CONSTEVAL 1/g, '#  define FMT_USE_CONSTEVAL 0');
});

// ── 2. Reanimated: no re-application of every animated prop on a native state update ─────────────
//
// React Native updates a ScrollView's Fabric state (its content offset) on EVERY scroll frame, on
// both platforms (Android ReactScrollViewHelper.updateStateOnScrollChanged, iOS
// RCTScrollViewComponentView scrollViewDidScroll). Each update is queued (EventQueue) and committed
// to the shadow tree on the JS thread. Reanimated 4.1's ReanimatedCommitHook treats every commit it
// did not make itself like a React commit: it collects the props of EVERY view it has ever animated
// and clones them into the new tree, so each scroll frame cost that clone on the JS thread and one
// prop update per animated view on the UI thread when the result was mounted.
//
// Traced on the Android emulator (atrace, Nov 2026): scrolling Settings, a batch of 9 UPDATE_PROPS
// after every state update, 3-10 ms each, 93 of 96 frames over 17 ms; scrolling a chat, batches of
// 16-20 UPDATE_PROPS, up to 19 ms each. Nothing on screen had changed.
//
// A state update clones the CURRENT tree, which already holds every animated prop Reanimated has
// committed, so it needs none re-applied. Only React commits (source React) can carry stale props
// for an animated view; they still get them. Updates Reanimated holds back while its commits are
// paused are not cancelled here, so it commits them itself when the pause ends. Nor do state updates
// pause it: the pause keeps Reanimated's frame-by-frame commits from making a long React commit retry,
// and a state update is a short commit (the scroll view's ancestors cloned), cheap to retry if one
// of Reanimated's lands first.
patchFile('reanimated commit hook', 'node_modules/react-native-reanimated/Common/cpp/reanimated/Fabric/ReanimatedCommitHook.cpp', (src) => {
  const marker = '[san-mes] native state updates';
  if (src.includes(marker)) return null;
  const anchor = '  reaShadowNode->unsetReanimatedMountTrait();\n  RootShadowNode::Unshared rootNode = newRootShadowNode;';
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const anchorHere = anchor.replace(/\n/g, eol);
  if (!src.includes(anchorHere)) return undefined;
  const insert = [
    '  reaShadowNode->unsetReanimatedMountTrait();',
    '#if REACT_NATIVE_MINOR_VERSION >= 80',
    `  // ${marker} (a ScrollView's offset, every scroll frame) clone the current`,
    '  // tree, which already holds every committed animated prop: nothing to re-apply,',
    '  // nothing to pause for. See scripts/patch-native-deps.js.',
    '  if (commitOptions.source != ShadowTreeCommitSource::React) {',
    '    return newRootShadowNode;',
    '  }',
    '#endif',
    '  RootShadowNode::Unshared rootNode = newRootShadowNode;',
  ].join(eol);
  return src.replace(anchorHere, insert);
});
