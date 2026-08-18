# Chat Input Animation Fix — Bugfix Design

## Overview

The chat composer (`ChatField` inside `src/components/chat/ChatInputBar.tsx`) lost its smooth
grow/shrink. The field's height is implicit: a multiline `TextInput` with `minHeight: 22` /
`maxHeight: 100` resizes itself as wrapped lines are added or removed, and `handleContentSizeChange`
fires once per line-count change. To cushion each of those height commits the handler calls a single
`LayoutAnimation.configureNext(INPUT_GROW_ANIM)` before letting the implicit height change land. In
practice the transition reads as a hard snap.

The root cause is that one-shot `LayoutAnimation` is the wrong tool for a value that changes several
times in quick succession while other layout systems are simultaneously animating. On iOS only one
`LayoutAnimation` transaction can be in flight; a fresh `configureNext` fired before the previous
260 ms spring settles cancels the in-flight animation and commits the remaining delta instantly. Fast
typing fires `onContentSizeChange` far more often than every 260 ms, so each new line aborts the prior
animation mid-flight — the user sees snaps. Worse, `LayoutAnimation` is global: it animates *every*
layout change in the next commit, so it races the `react-native-keyboard-controller` keyboard frame,
the Reanimated swallow spring (`sw`), and the FlashList content layout that share that frame. The
result is non-deterministic — sometimes a partial ease, usually a snap.

**Fix strategy (chosen): explicit Reanimated height.** Replace the implicit, `LayoutAnimation`-eased
height with an explicit animated height the component owns. `handleContentSizeChange` measures the
content, clamps it to `[MIN_FIELD_HEIGHT, MAX_FIELD_HEIGHT]`, and writes the target into a
`useSharedValue` animated with `withTiming` (short duration, standard easing). A `useAnimatedStyle`
applies that height to the field wrapper on the UI thread. `withTiming` is **interruptible**: a new
target mid-animation retargets smoothly from the current value instead of snapping, so 2→3→4 lines and
back all ease. This runs entirely on the UI thread, touches only the field wrapper's own height (never
a global layout transaction), and so cannot race the keyboard, the swallow spring, or the list.

**Why not a corrected `LayoutAnimation`?** A corrected version (e.g. de-dupling or guarding
`configureNext`) cannot fix the fundamental problems: it is still single-transaction (interruption
snaps), still global (races other animators on the same frame), and still fired imperatively from JS
with no control over the value once committed. Reanimated gives interruptible, isolated, frame-paced,
deterministic animation — exactly what this value needs.

**Secondary symptom — chat-open jank.** `app/chat/[id].tsx` already defers heavy work past the
navigation transition (`chromeReady`, `listReady`, `imagesReady`, seed/hydration all gated behind
`InteractionManager.runAfterInteractions`). The remaining contributor relevant to this fix is the
input bar itself mounting its glass chrome and animation hooks on the navigation frame. The fix keeps
the existing deferral architecture intact and ensures the new height machinery adds **zero** work to
the open frame: the shared value initializes to the collapsed base height (no measure-then-animate on
mount), the animated style is a cheap height read, and no new effect runs during entry.

## Glossary

- **Bug_Condition (C)**: The field's rendered height must change because the wrapped line count
  changed (grow or shrink) within `[MIN_FIELD_HEIGHT, MAX_FIELD_HEIGHT]`, OR a chat is being opened.
- **Property (P)**: For a content-size change the height transition is animated over time (no instant
  snap); for a chat open there is no perceptible frame drop on entry/first render.
- **Preservation**: Every behavior in Unchanged clauses 3.1–3.7 — single-line stability, max-height
  internal scroll, horizontal photo-swallow + emoji reveal, liquid-glass union without per-frame
  recompute, send/clear collapse, typing-perf render isolation, OTA-only/Apple compliance.
- **`handleContentSizeChange`**: The `onContentSizeChange` handler in `ChatInputBar` that receives the
  `TextInput`'s measured content height once per line-count change.
- **`INPUT_GROW_ANIM` / `LayoutAnimation.configureNext`**: The one-shot layout config and its trigger
  call — the defective mechanism being removed.
- **`sw`**: The existing Reanimated shared value (0→1) that drives the *horizontal* swallow (photo
  `marginRight`, field `paddingLeft`) and the emoji reveal. Orthogonal to height — must stay unchanged.
- **`fieldHeight`** (new): The Reanimated shared value owning the field's explicit, clamped, animated
  height.
- **`MIN_FIELD_HEIGHT` / `MAX_FIELD_HEIGHT`**: The clamp bounds (22 / 100), matching the current
  `TextInput` `minHeight`/`maxHeight`.

## Bug Details

### Bug Condition

The bug manifests whenever the composer's height needs to change due to a line-count change while
within the animatable range, or when a chat is opened. The current implementation drives height
implicitly through the multiline `TextInput` and tries to cushion it with a single global
`LayoutAnimation` per change — which is either cancelled mid-flight by the next change (snap), or
overridden by a competing layout transaction on the same frame (snap / jitter).

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type InputInteraction
  OUTPUT: boolean

  RETURN (input.kind = "contentSizeChange"
            AND input.newLineCount <> input.prevLineCount
            AND input.fieldHeight >= MIN_FIELD_HEIGHT
            AND input.fieldHeight <= MAX_FIELD_HEIGHT)
       OR (input.kind = "chatOpen")
END FUNCTION
```

### Examples

- **Grow (2→3 lines):** Expected — height eases up over ~140–180 ms. Actual — height snaps to the
  3-line height in one jump (prior 260 ms spring was cancelled by this change's `configureNext`).
- **Shrink (4→2 lines, rapid backspace):** Expected — height eases down smoothly. Actual — each
  deletion fires a fresh `configureNext` that aborts the previous one, so the field stair-steps/snaps.
- **Sustained typing across 2→3→4 lines:** Expected — one continuous cushioned grow. Actual — a hard
  step at each wrap because successive layout transactions cancel each other.
- **Chat open (edge case):** Expected — smooth slide-in with no dropped frames. Actual — first render
  can stutter as heavy chrome/list/image work competes for the navigation frame.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Single-line typing keeps the field at its collapsed base height with no spurious resize animation
  (3.1).
- At `MAX_FIELD_HEIGHT` (100, ~5 lines) the field stops growing and scrolls its content internally
  (3.2).
- The horizontal swallow of the photo/attach button and the top-left emoji reveal behave exactly as
  before, driven by the existing `sw` shared value (3.3).
- When liquid glass is active the photo + field surfaces fuse (liquid union) with the glass-merge
  state snapped once per transition — no per-frame glass-union recompute (3.4).
- Sending a message or clearing the field resets the field to its collapsed base height (3.5).
- Typing re-renders only the isolated `ChatField` — never the parent screen or the message list (3.6).
- All chat rendering, scrolling, swipe-to-reply, and keyboard handling are unchanged, with no new
  native module or permission (OTA-deliverable, Apple-compliant) (3.7).

**Scope:**
All inputs that are NOT a within-range line-count change and NOT a chat-open event must be completely
unaffected. This includes: single-line keystrokes, content changes at/above max height (internal
scroll), horizontal expand/collapse, send/clear, panel toggles (emoji/GIF/keyboard), and all message
interactions.

## Hypothesized Root Cause

Based on the code in `ChatInputBar.tsx`, the most likely issues are, in order of confidence:

1. **One-shot `LayoutAnimation` is non-interruptible and gets cancelled mid-flight (primary).**
   `handleContentSizeChange` calls `LayoutAnimation.configureNext(INPUT_GROW_ANIM)` once per
   line-count change. On iOS only one layout transaction animates at a time; a new `configureNext`
   fired before the prior 260 ms spring settles commits the in-flight delta instantly. Typing/deleting
   across lines fires changes faster than 260 ms → each cancels the last → snap.

2. **`LayoutAnimation` is global and races co-scheduled animators.** It animates every layout change
   in the next commit, so it competes with the `react-native-keyboard-controller` keyboard frame, the
   Reanimated swallow spring (`sw`), and FlashList layout on the same frame — yielding inconsistent
   eases or snaps depending on what else committed.

3. **Implicit, uncontrolled height.** The height is a side effect of `TextInput` content + min/max,
   not a value the component controls. There is no shared value to interpolate, so the only available
   easing hook was the fragile global `LayoutAnimation`.

4. **Chat-open frame contention (secondary).** Even with existing deferral, the input bar mounting its
   glass chrome and animation hooks on the navigation frame, plus any height machinery that
   measures-then-animates on mount, can shave frames off the open transition.

## Correctness Properties

Property 1: Bug Condition — Smooth Height Transition

_For any_ input where the bug condition holds (`isBugCondition` returns true): when
`input.kind = "contentSizeChange"`, the fixed `ChatInputBar` SHALL animate the field height from its
current value toward the new clamped target over time (interpolated via `withTiming`), retargeting
smoothly rather than snapping when a further change arrives mid-animation; and when
`input.kind = "chatOpen"`, the fixed screen SHALL complete entry/first render without adding the
height machinery's work to the navigation frame, presenting the open without perceptible frame drops.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation — Non-Buggy Input Behavior Unchanged

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false) — single-line
keystrokes, content at/above max height, horizontal expand/collapse, send/clear, panel toggles, and
all message interactions — the fixed code SHALL produce the same observable result as the original
code, preserving collapsed base height on single line (3.1), max-height internal scroll (3.2), the
`sw`-driven photo-swallow + emoji reveal (3.3), the once-per-transition liquid-glass union (3.4),
send/clear collapse (3.5), per-keystroke render isolation to `ChatField` (3.6), and all chat
rendering/scroll/swipe/keyboard behavior with no new native module or permission (3.7).

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct:

**File**: `src/components/chat/ChatInputBar.tsx`

**Functions/areas**: `handleContentSizeChange`, the field wrapper render, module-level constants,
imperative `clear`/`setText` collapse paths.

**Specific Changes**:

1. **Introduce an explicit animated height shared value.**
   - Add module constants `MIN_FIELD_HEIGHT = 22` and `MAX_FIELD_HEIGHT = 100` (mirroring the current
     `TextInput` `minHeight`/`maxHeight`).
   - In `ChatInputBar`, add `const fieldHeight = useSharedValue(MIN_FIELD_HEIGHT);`.
   - Add a `heightStyle = useAnimatedStyle(() => ({ height: fieldHeight.value }))` and apply it to the
     field wrapper that currently sizes implicitly (the `inputWrap` / `inputWrapGlass` content row).
     Keep the inner `TextInput`'s `minHeight: 22` and `maxHeight: 100` so the OS still reports content
     size and still scrolls internally at the cap.

2. **Replace `LayoutAnimation` with `withTiming` retargeting in `handleContentSizeChange`.**
   - Remove the `LayoutAnimation.configureNext(INPUT_GROW_ANIM)` call (and, if unused elsewhere, the
     `INPUT_GROW_ANIM` constant and the Android `setLayoutAnimationEnabledExperimental` enable that
     existed solely for it).
   - Clamp the measured content height: `const target = Math.min(MAX_FIELD_HEIGHT, Math.max(MIN_FIELD_HEIGHT, h));`
   - Animate: `fieldHeight.value = withTiming(target, { duration: 160, easing: Easing.out(Easing.quad) });`
   - Keep the existing `lastHeightRef` dedupe so an unchanged height does nothing (preserves 3.1: a
     single-line keystroke that doesn't change height triggers no animation).
   - Keep the existing horizontal-swallow hysteresis (`setExpanded(true)` at `h > 34`,
     `setExpanded(false)` at `h < 28`) exactly as-is — `sw` and the swallow/emoji reveal are untouched.

3. **Collapse on send/clear via the same shared value.**
   - In the imperative `clear` and `setText('')`/empty paths, set
     `fieldHeight.value = withTiming(MIN_FIELD_HEIGHT, { duration: 160, easing: Easing.out(Easing.quad) })`
     alongside the existing `setExpanded(false)` and `lastHeightRef.current = 0` resets (preserves 3.5,
     now smoothly rather than via a snap).

4. **Keep height isolated from the per-keystroke render path (3.6).**
   - All height updates go through the shared value on the UI thread; no `setState` is added to the
     keystroke path. `ChatField` remains memoized and continues to own text state. The new
     `useSharedValue`/`useAnimatedStyle` live in `ChatInputBar` and do not add renders.

5. **Keep the liquid-glass union recompute once-per-transition (3.4).**
   - The height animates the field wrapper's own `height` only. The glass-merge state continues to be
     driven by the existing threshold flip on `sw` (snapped once per expand/collapse), so animating
     height does not reintroduce a per-frame glass-union recompute. Verify on a glass device that the
     union still snaps once and does not relayout every height frame.

6. **Chat-open jank: keep the open frame free of new work (2.4).**
   - Initialize `fieldHeight` to `MIN_FIELD_HEIGHT` so the bar mounts at rest with no
     measure-then-animate on first render.
   - Do not add any mount-time effect that animates height. The first real `onContentSizeChange` after
     mount sets height to the same base value (deduped by `lastHeightRef`), so no animation fires on
     open.
   - Preserve the existing `chromeReady`/`listReady`/`imagesReady` deferral in `app/chat/[id].tsx`
     unchanged. If profiling still shows input-bar mount cost on the navigation frame, gate the bar's
     heavier glass chrome behind the existing `chromeReady` flag (memoized) rather than introducing a
     new deferral mechanism. Memoization of `ChatInputBar` (already `memo`) and stable callbacks are
     retained.

## Testing Strategy

### Validation Approach

Two phases: first surface counterexamples that demonstrate the abrupt snap on the current (unfixed)
code and confirm the root cause; then verify the fix animates smoothly and preserves all unchanged
behavior. Note that "smoothness" is partly perceptual — automated tests assert the *mechanism*
(interruptible time-based interpolation of a clamped height, no `LayoutAnimation` call), and final
visual smoothness is confirmed by manual device testing.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the snap BEFORE implementing the fix, and confirm
the root cause (one-shot `LayoutAnimation` cancellation / global race). If refuted, re-hypothesize.

**Test Plan**: Drive `handleContentSizeChange` with a sequence of increasing/decreasing content
heights faster than the animation duration and observe how height is committed. On the unfixed code,
assert that height changes are produced by a `LayoutAnimation.configureNext` call (mock it) and that
no time-interpolated value sequence exists — demonstrating the snap mechanism.

**Test Cases**:
1. **Grow snap**: feed 22→48 then 48→70 within < 260 ms; assert `configureNext` is called per change
   and the second call occurs while the first transaction is unsettled (will fail to ease on unfixed
   code).
2. **Shrink snap**: feed 70→48→22 rapidly; assert the same cancellation pattern (will fail on unfixed
   code).
3. **Multi-line cascade**: feed 22→48→70→92; assert each step uses a separate global layout
   transaction (will fail on unfixed code).
4. **Chat-open edge**: render the screen and assert no height animation is scheduled on the mount
   frame (baseline for the preservation that open adds no height work).

**Expected Counterexamples**:
- Height commits are global `LayoutAnimation` transactions cancelled by the next change rather than a
  retargeting interpolation.
- Possible causes: single in-flight iOS layout transaction, global layout race with keyboard/`sw`/list,
  implicit uncontrolled height.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function animates the
height smoothly (interruptible, time-based, clamped) and adds no work to the open frame.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := handleContentSizeChange_fixed(input)   // or mount, for chatOpen
  IF input.kind = "contentSizeChange" THEN
    ASSERT fieldHeight animates via withTiming toward clamp(input.height)
       AND retarget mid-animation continues from current value (no snap)
       AND NOT layoutAnimationConfigured(result)
  ELSE IF input.kind = "chatOpen" THEN
    ASSERT no height animation scheduled on the mount/navigation frame
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed component
produces the same observable result as the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT observable(handleInput_original(input)) = observable(handleInput_fixed(input))
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation because it generates many
content-size and interaction sequences across the input domain, catching edge cases (e.g. exactly at
the 28/34 swallow thresholds, exactly at max height) that hand-written cases miss, and gives strong
confidence that horizontal swallow, emoji reveal, send/clear, and render-isolation are unchanged.

**Test Plan**: Observe behavior on the UNFIXED code for the non-bug inputs (single-line stability,
max-height scroll, horizontal swallow, send/clear, panel toggles, render isolation), then write
property-based and unit tests capturing that behavior and assert it still holds after the fix.

**Test Cases**:
1. **Single-line stability**: a keystroke that does not change content height schedules no height
   animation (dedupe via `lastHeightRef`) — observed unchanged.
2. **Max-height scroll**: content above `MAX_FIELD_HEIGHT` clamps `fieldHeight` to 100 and the
   `TextInput` keeps `maxHeight: 100` so it scrolls internally — observed unchanged.
3. **Horizontal swallow + emoji reveal**: `sw` transitions and the swallow/emoji `useAnimatedStyle`
   outputs are identical to before across the 28/34 thresholds.
4. **Glass union once-per-transition**: the glass-merge threshold flip on `sw` fires once per
   expand/collapse; no per-height-frame recompute.
5. **Send/clear collapse**: `clear`/empty resets `fieldHeight` to base and `setExpanded(false)`.
6. **Render isolation**: typing re-renders only `ChatField`; parent screen and list render counts
   unchanged.

### Unit Tests

- `handleContentSizeChange` clamps target to `[MIN_FIELD_HEIGHT, MAX_FIELD_HEIGHT]` and calls
  `withTiming` (not `LayoutAnimation.configureNext`).
- Duplicate height (no line-count change) is a no-op (no animation scheduled).
- Swallow hysteresis still flips `sw` at `h > 34` / `h < 28`.
- `clear`/`setText('')` collapse `fieldHeight` to base and `sw` to 0.

### Property-Based Tests

- For random monotonic and oscillating height sequences within range, the fixed handler always
  retargets `fieldHeight` via `withTiming` and never calls `LayoutAnimation` (Property 1).
- For random non-bug inputs (single-line, ≥ max-height, panel toggles, send/clear), observable swallow,
  emoji, scroll, and collapse outputs equal the original (Property 2).
- For random sequences crossing the 28/34 thresholds, `sw` expand/collapse decisions are unchanged.

### Integration Tests

- Full compose flow: type across 2→3→4 lines and back; assert height value sequence is a continuous
  interpolation (sampled) rather than discrete jumps, and the swallow/emoji reveal still fire.
- Chat-open flow: mount the chat screen; assert `chromeReady`/`listReady`/`imagesReady` deferral is
  intact and no height animation is scheduled on the navigation frame; first paint shows the collapsed
  bar.
- Keyboard + height: bring the keyboard up (keyboard-controller) while the field grows; assert the
  height animation and keyboard frame no longer fight (no snap), confirming the global-layout race is
  resolved.
