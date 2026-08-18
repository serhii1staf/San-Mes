# Implementation Plan

## Overview

This plan fixes the abrupt chat composer height transition in
`src/components/chat/ChatInputBar.tsx` by replacing the one-shot
`LayoutAnimation.configureNext(INPUT_GROW_ANIM)` height cushioning with an explicit Reanimated
animated height (`fieldHeight` `useSharedValue` clamped to `[22, 100]`, animated via `withTiming`,
applied through `useAnimatedStyle`). It follows the bugfix methodology: a bug-condition exploration
test first (expected to FAIL on unfixed code), then the fix, then preservation/fix-checking property
tests. All preserved behaviors — `sw`-driven horizontal swallow/emoji reveal, max-height internal
scroll, send/clear collapse, render isolation, liquid-glass union, and the chat-open deferral in
`app/chat/[id].tsx` — are validated unchanged. The change is OTA-deliverable and Apple-compliant: no
new native module or permission.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "description": "Bug condition exploration test — FAILS on unfixed code (Property 1)",
      "tasks": ["1"]
    },
    {
      "wave": 2,
      "description": "Preservation baseline tests — observe and capture ¬C(X) behavior, PASS on unfixed code (Property 2)",
      "tasks": ["2"]
    },
    {
      "wave": 3,
      "description": "Apply the fix — explicit Reanimated height; re-run Property 1 and Property 2 against fixed code",
      "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8"]
    },
    {
      "wave": 4,
      "description": "Optional property-based tests hardening Property 1 and Property 2",
      "tasks": ["4", "5"]
    },
    {
      "wave": 5,
      "description": "Checkpoint — all tests pass, OTA/Apple compliance verified",
      "tasks": ["6"]
    }
  ]
}
```

Tasks 1 → 2 → 3 are strictly ordered (explore, observe baseline, then fix). Sub-tasks 3.7/3.8 re-run
the SAME tests from tasks 1/2 against fixed code. Tasks marked `*` (4, 5) are optional property-based
tests that harden the guarantees from tasks 1/2. `C(X)` = `isBugCondition`; `¬C(X)` = non-buggy inputs.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Smooth Height Transition
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists (one-shot `LayoutAnimation` is the snap mechanism)
  - **DO NOT attempt to fix the test or the code when it fails** — the failure is the deliverable for this task
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation (re-run in task 3.7)
  - **GOAL**: Surface counterexamples that demonstrate the abrupt snap and confirm the root cause
  - **Scoped PBT Approach**: For deterministic reproduction, scope the property to concrete failing sequences (grow 22→48→70, shrink 70→48→22, cascade 22→48→70→92) fed faster than the animation duration; the bug condition is `isBugCondition(input)` from design (`kind = "contentSizeChange"` AND `newLineCount ≠ prevLineCount` AND `fieldHeight ∈ [22, 100]`, OR `kind = "chatOpen"`)
  - Create the test target for `src/components/chat/ChatInputBar.tsx`; mock `react-native`'s `LayoutAnimation` (spy on `configureNext`) and `react-native-reanimated`'s `withTiming`
  - **Grow snap case**: drive `handleContentSizeChange` 22→48 then 48→70 within < 260 ms; assert (on unfixed code) `LayoutAnimation.configureNext` is called per change and NO time-interpolated `withTiming` height sequence exists
  - **Shrink snap case**: drive 70→48→22 rapidly; assert the same `configureNext` cancellation pattern, no `withTiming` retargeting
  - **Multi-line cascade case**: drive 22→48→70→92; assert each step issues a separate global layout transaction rather than one continuous interpolation
  - **Chat-open edge case**: render the chat screen and assert (baseline) no height animation is scheduled on the mount/navigation frame
  - The test assertions encode the **Expected Behavior** from design: height retargets via `withTiming` toward `clamp(height, 22, 100)` with NO `LayoutAnimation` call
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct — it proves the snap mechanism exists)
  - Document counterexamples found (e.g., "growth 48→70 commits via `configureNext` while the prior transaction is unsettled → instant snap, no interpolation")
  - Mark task complete when test is written, run, and the failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Write preservation baseline tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Buggy Input Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology — observe the UNFIXED code for inputs where `isBugCondition` returns false, record the actual outputs, then assert those outputs
  - **Single-line stability (3.1)**: observe that a keystroke not changing content height schedules no height animation (deduped by `lastHeightRef`); capture as a test
  - **Max-height internal scroll (3.2)**: observe that content above `MAX_FIELD_HEIGHT` keeps the `TextInput` at `maxHeight: 100` and scrolls internally; capture as a test
  - **Horizontal swallow + emoji reveal (3.3)**: observe `sw` transitions and the swallow/emoji `useAnimatedStyle` outputs across the 28/34 hysteresis thresholds (`setExpanded(true)` at `h > 34`, `setExpanded(false)` at `h < 28`); capture as a test
  - **Glass union once-per-transition (3.4)**: observe that the glass-merge threshold flip on `sw` fires once per expand/collapse, not per height frame; capture as a test
  - **Send/clear collapse (3.5)**: observe that `clear`/`setText('')` resets the field to base height and calls `setExpanded(false)`; capture as a test
  - **Render isolation (3.6)**: observe that typing re-renders only the memoized `ChatField`, not the parent screen or message list (assert render counts)
  - **No new native module/permission (3.7)**: assert the change set imports no new native module and `app.json` `ios.infoPlist` is unchanged (OTA-deliverable, Apple-compliant)
  - Property-based testing is recommended here for stronger guarantees (random sequences crossing 28/34 thresholds, exactly at max height) — see optional task 5
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Fix abrupt input-field height transition (explicit Reanimated height)

  - [x] 3.1 Introduce an explicit animated height shared value
    - Add module constants `MIN_FIELD_HEIGHT = 22` and `MAX_FIELD_HEIGHT = 100` (mirror current `TextInput` `minHeight`/`maxHeight`)
    - In `ChatInputBar`, add `const fieldHeight = useSharedValue(MIN_FIELD_HEIGHT);` (initialize to collapsed base — no measure-then-animate on mount)
    - Add `const heightStyle = useAnimatedStyle(() => ({ height: fieldHeight.value }));` and apply it to the field wrapper that currently sizes implicitly (`inputWrap` / `inputWrapGlass` content row)
    - Keep the inner `TextInput`'s `minHeight: 22` / `maxHeight: 100` so the OS still reports content size and scrolls internally at the cap
    - _Bug_Condition: isBugCondition(input) where kind = "contentSizeChange" AND newLineCount ≠ prevLineCount AND fieldHeight ∈ [22,100]_
    - _Expected_Behavior: explicit, component-owned, clamped animated height replaces implicit TextInput height_
    - _Preservation: 3.1, 3.2_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 Replace `LayoutAnimation` with `withTiming` retargeting in `handleContentSizeChange`
    - Remove the `LayoutAnimation.configureNext(INPUT_GROW_ANIM)` call; remove the now-unused `INPUT_GROW_ANIM` constant and any Android `setLayoutAnimationEnabledExperimental` enable that existed solely for it
    - Clamp the measured content height: `const target = Math.min(MAX_FIELD_HEIGHT, Math.max(MIN_FIELD_HEIGHT, h));`
    - Animate: `fieldHeight.value = withTiming(target, { duration: 160, easing: Easing.out(Easing.quad) });` (interruptible — retargets smoothly mid-animation)
    - Keep the existing `lastHeightRef` dedupe so an unchanged height does nothing (preserves 3.1)
    - Keep the horizontal-swallow hysteresis (`setExpanded(true)` at `h > 34`, `setExpanded(false)` at `h < 28`) exactly as-is — `sw` and swallow/emoji reveal untouched
    - _Bug_Condition: isBugCondition(input) — within-range line-count change_
    - _Expected_Behavior: expectedBehavior(result) — height animates over time via withTiming, no instant snap; retarget continues from current value_
    - _Preservation: 3.3 (sw hysteresis unchanged)_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Collapse on send/clear via the same shared value
    - In the imperative `clear` and `setText('')`/empty paths, set `fieldHeight.value = withTiming(MIN_FIELD_HEIGHT, { duration: 160, easing: Easing.out(Easing.quad) })`
    - Keep the existing `setExpanded(false)` and `lastHeightRef.current = 0` resets alongside it
    - _Bug_Condition: N/A (send/clear is ¬C — preserved behavior, now eased instead of snapped)_
    - _Expected_Behavior: field returns to collapsed base height smoothly_
    - _Preservation: 3.5_
    - _Requirements: 2.1, 2.2_

  - [x] 3.4 Keep height isolated from the per-keystroke render path
    - Route all height updates through the shared value on the UI thread; add NO `setState` to the keystroke path
    - Keep `ChatField` memoized and owning text state; the new `useSharedValue`/`useAnimatedStyle` live in `ChatInputBar` and add no renders
    - _Bug_Condition: N/A (render isolation is ¬C)_
    - _Expected_Behavior: typing re-renders only ChatField_
    - _Preservation: 3.6_
    - _Requirements: 2.1_

  - [x] 3.5 Keep the liquid-glass union recompute once-per-transition
    - Animate only the field wrapper's own `height`; leave the glass-merge state driven by the existing threshold flip on `sw` (snapped once per expand/collapse)
    - Verify on a glass device that the union still snaps once and does not relayout every height frame
    - _Bug_Condition: N/A (glass union is ¬C)_
    - _Expected_Behavior: no per-frame glass-union recompute introduced by height animation_
    - _Preservation: 3.4_
    - _Requirements: 2.1_

  - [x] 3.6 Keep the chat-open frame free of new work
    - Confirm `fieldHeight` initializes to `MIN_FIELD_HEIGHT` (bar mounts at rest, no measure-then-animate)
    - Add NO mount-time effect that animates height; the first real `onContentSizeChange` after mount sets the same base value (deduped by `lastHeightRef`), so no animation fires on open
    - Preserve the existing `chromeReady`/`listReady`/`imagesReady` + `InteractionManager.runAfterInteractions` deferral in `app/chat/[id].tsx` UNCHANGED; if profiling still shows input-bar mount cost on the navigation frame, gate the heavier glass chrome behind the existing `chromeReady` flag (memoized) rather than adding a new deferral
    - _Bug_Condition: isBugCondition(input) where kind = "chatOpen"_
    - _Expected_Behavior: no height animation scheduled on the navigation frame; entry without perceptible frame drop_
    - _Preservation: 3.7_
    - _Requirements: 2.4_

  - [x] 3.7 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Smooth Height Transition
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior; when it passes it confirms the smooth, interruptible, clamped height animation is in place and no `LayoutAnimation` call remains
    - Run the bug condition exploration test from task 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms the snap is fixed for grow, shrink, cascade; chat-open schedules no height animation)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.8 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Buggy Input Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run the preservation baseline tests from task 2
    - **EXPECTED OUTCOME**: Tests PASS (no regressions — single-line stability, max-height scroll, sw swallow/emoji reveal, glass union once-per-transition, send/clear collapse, render isolation, no new native module/permission all unchanged)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 4. * (Optional) Fix-checking property test for smooth height transition
  - **Property 1: Bug Condition** - Smooth Height Transition (property-based)
  - For random monotonic and oscillating height sequences within `[22, 100]` fed at varying intervals, assert the fixed handler always retargets `fieldHeight` via `withTiming` toward `clamp(height)` and NEVER calls `LayoutAnimation.configureNext`
  - For random `chatOpen` mounts, assert no height animation is scheduled on the mount frame
  - Generates many sequences automatically for stronger confidence than the scoped cases in task 1
  - **EXPECTED OUTCOME**: Property holds on FIXED code
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [ ] 5. * (Optional) Preservation property test for non-buggy inputs
  - **Property 2: Preservation** - Non-Buggy Input Behavior Unchanged (property-based)
  - For random non-bug inputs (single-line keystrokes, content ≥ max height, panel toggles, send/clear) assert observable swallow, emoji, scroll, and collapse outputs equal the original
  - For random sequences crossing the 28/34 thresholds, assert `sw` expand/collapse decisions are unchanged (catches edge cases exactly at the thresholds and exactly at max height that hand-written cases miss)
  - **EXPECTED OUTCOME**: Property holds on FIXED code, matching observed baseline from task 2
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 6. Checkpoint - Ensure all tests pass
  - Run the full test suite; confirm Property 1 (task 1, re-run in 3.7) PASSES and Property 2 (task 2, re-run in 3.8) PASSES, plus any optional property tests (4*, 5*)
  - Confirm the change is OTA-deliverable: JS/asset-only, no new native module, no new `NS*UsageDescription`, no `app.json` `ios.infoPlist` change (Apple-compliant per steering)
  - Manual device pass: type across 2→3→4 lines and back (continuous cushioned grow/shrink), open a chat (smooth entry, no dropped frames), verify on a liquid-glass device that the union still snaps once
  - Ensure all tests pass; ask the user if questions arise
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

## Notes

- **Methodology**: Bug condition `C(X)` = `isBugCondition` from design (within-range line-count change OR chat open). `¬C(X)` = all other inputs, which must be preserved. `F` = unfixed `ChatInputBar`, `F'` = fixed.
- **Test ordering is load-bearing**: Task 1 must FAIL and task 2 must PASS on unfixed code before any fix is applied. Sub-tasks 3.7/3.8 re-run those exact tests — do not author new tests there.
- **Optional PBT** (tasks 4, 5, marked `*`): property-based tests that strengthen the scoped/observed cases; skip if the project has no PBT harness, but they give the strongest preservation guarantees.
- **Compliance**: This is a JS/asset-only OTA change. No new native module, no new permission, no `Info.plist` change — consistent with `.kiro/steering/apple-compliance.md`.
