# Bugfix Requirements Document

## Introduction

The chat screen's message input bar (`src/components/chat/ChatInputBar.tsx`, rendered by `app/chat/[id].tsx`) regressed: the composer field used to grow and shrink **smoothly** as the user typed onto additional lines and deleted them. It now resizes **abruptly** — each line that wraps snaps the field to its new height in a single jump, and shrinking back is equally instant. The smooth height animation that used to cushion every line-count change was lost.

The height of the field is driven by the multiline `TextInput`'s `onContentSizeChange` (`handleContentSizeChange`), which fires once per line added/removed. A one-shot `LayoutAnimation.configureNext(INPUT_GROW_ANIM)` is meant to ease each of those height commits, but in practice the grow/shrink reads as a hard snap rather than the previous cushioned transition.

A related symptom is reported on the same screen: opening a chat with a user can drop frames (просадки / jank) on screen entry and first render, so the chat-open experience feels stuttery rather than smooth.

Scope and constraints:
- The fix is expected to be a JS/asset-only change deliverable via OTA (`eas update`). It MUST NOT introduce any new native module, native permission, or `Info.plist` usage-description change (Apple Developer Program License Agreement compliance — see `.kiro/steering/apple-compliance.md`).
- `react-native-reanimated` and `react-native-gesture-handler` are already installed and available.

### Bug Condition (C) and Methodology

**F** = the current `ChatInputBar` height-transition behavior (abrupt). **F'** = the fixed behavior (smooth grow/shrink restored).

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type InputInteraction
  OUTPUT: boolean

  // X describes an interaction with an OPEN chat's composer or the chat-open
  // event. The bug is triggered whenever the field's rendered height must
  // change because the wrapped line count changed (grow OR shrink) within the
  // animatable range (minHeight 22 .. maxHeight 100), and also on chat entry.
  RETURN (X.kind = "contentSizeChange"
            AND X.newLineCount <> X.prevLineCount
            AND X.fieldHeight is within [minHeight, maxHeight])
       OR (X.kind = "chatOpen")
END FUNCTION
```

```pascal
// Property: Fix Checking — smooth height transitions + smooth chat open
FOR ALL X WHERE isBugCondition(X) DO
  result <- F'(X)
  IF X.kind = "contentSizeChange" THEN
    ASSERT result.heightChange is animated (interpolated over time)
        AND NOT instantaneous_snap(result)
  ELSE IF X.kind = "chatOpen" THEN
    ASSERT result has no perceptible frame drop on entry
  END IF
END FOR
```

```pascal
// Property: Preservation Checking — non-buggy inputs unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

## Bug Analysis

### Current Behavior (Defect)

What currently happens on the chat screen's input bar and on chat entry.

1.1 WHEN the user types enough text to wrap onto an additional line THEN the system grows the input field height abruptly/instantly instead of animating the height change.

1.2 WHEN the user deletes text so the content shrinks by one or more lines THEN the system shrinks the input field height abruptly/instantly instead of animating the height change.

1.3 WHEN the line count changes across several lines in succession (e.g. 2→3→4 lines) THEN the system snaps to each new height with no smooth, cushioned transition between heights.

1.4 WHEN the user opens a chat with another user THEN the system can drop frames / stutter (просадки) during screen entry and first render, so the chat-open transition does not feel smooth.

### Expected Behavior (Correct)

What should happen instead for those same conditions.

2.1 WHEN the user types enough text to wrap onto an additional line THEN the system SHALL animate the input field height growth smoothly over a short duration.

2.2 WHEN the user deletes text so the content shrinks by one or more lines THEN the system SHALL animate the input field height shrink smoothly over a short duration.

2.3 WHEN the line count changes across several lines in succession (e.g. 2→3→4 lines and back) THEN the system SHALL apply the smooth height transition to every line-count change, not only at the first single-line↔multiline threshold.

2.4 WHEN the user opens a chat with another user THEN the system SHALL present the chat-open transition without perceptible frame drops on entry and first render.

### Unchanged Behavior (Regression Prevention)

Existing behavior that must be preserved.

3.1 WHEN the user types on a single line (no line-count change) THEN the system SHALL CONTINUE TO keep the field at its base height with no spurious resize animation.

3.2 WHEN the field reaches its maximum height (`maxHeight: 100`, ~5 lines) THEN the system SHALL CONTINUE TO stop growing and scroll its content internally.

3.3 WHEN the field expands to multiline THEN the system SHALL CONTINUE TO perform the horizontal "swallow" of the photo/attach button and reveal the top-left emoji button exactly as before.

3.4 WHEN liquid glass is active THEN the system SHALL CONTINUE TO fuse the photo and field glass surfaces (liquid union) without reintroducing a per-frame glass-union recompute during the height/expand transition.

3.5 WHEN the user sends a message or clears the field THEN the system SHALL CONTINUE TO reset the field to its collapsed base height and behave as before.

3.6 WHEN the user types into the composer THEN the system SHALL CONTINUE TO re-render only the isolated input field (not the parent screen or the message list), preserving the existing typing-performance isolation.

3.7 WHEN a chat is open THEN the system SHALL CONTINUE TO render messages, scrolling, swipe-to-reply, and keyboard handling exactly as before, with no new native module or permission introduced (OTA-deliverable, Apple-compliant).
