# Native build notes

Changes here require a **native rebuild** (`eas build`), NOT an OTA update.
They are committed to the repo, so the next build of EITHER platform picks
them up automatically via Expo autolinking / prebuild.

## Native dependencies that must be in the binary

| Package | Why | Added |
| --- | --- | --- |
| `@react-native-masked-view/masked-view` | Fading frosted blur header (`FadingBlurHeader`) | earlier |
| `expo-paste-input` | Native image/sticker/GIF **paste** into the chat composer (`onPaste`) | 2026-06 |

## Native paste (`expo-paste-input`)

- React Native's core `TextInput` has **no `onPaste`** for images, so the OS
  paste menu can only paste text. `expo-paste-input` wraps the TextInput at
  the native layer and intercepts paste, returning local `file://` URIs for
  pasted images / stickers / GIFs (iOS `UIPasteboard` + keyboard sticker
  hooks; Android `OnReceiveContentListener`).
- Integrated in `src/components/chat/ChatInputBar.tsx`:
  - The module is loaded with a **guarded dynamic `import()`** inside a
    `useEffect`. On older binaries that don't have the native view
    (`ExpoPasteInput`), `requireNativeView` throws and we swallow it — the
    composer falls back to the plain `TextInput`, NO crash. This is what
    makes it safe to OTA the JS to existing users before/without the build.
  - When present, the TextInput is wrapped in `<TextInputWrapper style={{ flex: 1 }}>`
    and `onPaste` → `onPasteImages(uris)` → `addPastedImages` in
    `app/chat/[id].tsx` (resizes to 1280px JPEG, appends to pendingImages).
- JS-only fallbacks remain for old binaries / discoverability:
  - "Paste image" chip above the composer when the clipboard holds an image
    (`Clipboard.hasImageAsync`).
  - Long-press the 📷 attach button to paste from the clipboard.

## Build reminders

- `runtimeVersion.policy = "appVersion"` (currently `1.0.0`), so a new native
  build at version 1.0.0 keeps runtime `1.0.0` and continues to receive the
  same `production` OTA channel.
- Android native build credits on the EAS free plan reset ~July 1; until then
  do iOS builds. When the Android build runs, `expo-paste-input` (and any
  other native dep above) is included automatically — nothing extra to do.
