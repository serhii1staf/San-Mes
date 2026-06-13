# Chat Liquid-Glass — implementation notes

Companion notes to `feat(chat-glass):` rollout. Captures decisions that
diverge from the original spec and the reasoning behind each.

## Surfaces that received glass

| Surface                            | Material                | Drag-stretch |
| ---------------------------------- | ----------------------- | ------------ |
| ChatInputBar — image-picker button | `GlassCapsule` (44×44)  | ❌            |
| ChatInputBar — text input bubble   | `GlassCapsule` (pill)   | ❌            |
| ChatInputBar — send / check button | `GlassCapsule` + tinted | ❌            |
| Chat header (default mode)         | `GlassCapsule` (28 r)   | ✅            |
| Chat header (search mode)          | unchanged               | ❌            |
| Messages tab search bar            | `GlassCapsule` (pill)   | ❌            |

## Why the messages-tab search bar doesn't drag

The spec asked for an attempted drag-stretch on the messages search
capsule, falling back to material-only on conflict. Skipped on first
implementation pass:

- The capsule directly wraps a `<TextInput>`. Wrapping the same node in
  a `Pan` gesture intercepts the down-event used by the system to focus
  the field. With `simultaneousWith` the focus race becomes flaky on
  warm-load devices (the field would focus only on a second tap).
- The chat-header drag works because the row is composed of `Pressable`
  buttons with no inner editable text. The pan minDistance of 4 px lets
  taps land before the gesture activates. A TextInput doesn't have an
  equivalent "tap before pan" hook on iOS; tap-to-focus and pan compete
  for the same gesture window.
- Spec explicitly permits the fallback: *"If that's tricky, skip drag
  for the search bar and document why."* — this is the documented why.

If we revisit, candidates are:
- Wrap only the leading `<Feather name="search" />` icon in the
  GestureDetector, leaving the TextInput outside the gesture region.
- Use `Gesture.Native()` from gesture-handler combined with a manual
  Pan that uses `requireExternalGestureToFail(focusGesture)` — would
  require manual gesture-handler refs on the TextInput, which the
  current `react-native-keyboard-controller` setup makes brittle.

## Why the chat header's search-mode branch is unchanged

When the user taps-and-holds the name pill, the header switches to a
search input the same way the messages tab does. Same TextInput
focus-vs-pan conflict applies. The non-search-mode branch, which is the
default state and the one a user spends 99 % of their chat time in, gets
the full glass + drag treatment. The search-mode branch keeps its
existing flat row to preserve focus reliability when the user actually
needs to type into it.

## Performance posture

- iOS only: a single `BlurView` per surface, `systemThinMaterial*` tint,
  intensity ≤ 60. The previous "lens BlurView on top of card BlurView"
  cost is not reintroduced.
- Android: NO `BlurView`. Flat `rgba(40,40,45,0.65)` (dark) /
  `rgba(255,255,255,0.78)` (light) fill mirrors the
  `DynamicOverlayHost` Android branch. BlurView on Android is too
  expensive on a keyboard-coupled view; we already removed it from the
  chat input once for that reason.
- `GlassCapsule` is wrapped in `React.memo` so the shell never
  re-renders on text input churn. The chat input bar still owns its
  text state locally — no parent re-renders on keystrokes.
- `ChatInputBar` itself stays inside `React.memo(forwardRef(...))` —
  unchanged from the previous implementation.

## Drag physics

Chat header release spring is intentionally softer than the Dynamic
Overlay (`damping: 24, stiffness: 100, mass: 1.4`) per the user request
for "более плавным" — the bar settles back over a longer ease than the
overlay's `(22, 110, 1.3)` spring. Same caps (24 px x, 18 px y, 0.025
stretch ceiling) so the bar never wanders far enough to feel jumpy.

## Apple compliance

- No new permissions, no new native modules — OTA-deployable.
- Glass capsule sits below `insets.top` everywhere it's applied, so it
  never draws over the system status bar or Dynamic Island.
- Existing keyboard avoidance, swipe-to-reply, search-mode toggle, and
  user-blocking flows all continue to work unchanged.
