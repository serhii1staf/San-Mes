# Chat screen: the architecture, and how to fix it in reviewable pieces

Written after the snapshot of 2026-08-26. The question being answered is the one asked directly:
*is the problem the architecture, and can the app be lifted rather than patched?*

**Short answer: yes about the chat screen, no about the app.** The evidence says so, and this
document exists so the work is planned rather than improvised across sessions.

---

## 1. What the numbers actually say

From the device snapshot (`perfMonitor`, release build, real usage):

| route | score | long tasks | worst FPS | mounts | note |
|---|---|---|---|---|---|
| `chat/[id]` | **40.8** | 3 (worst 199 ms, avg 174) | **11** | 14 | more than 2× the next worst |
| `(tabs)/messages` | 19.0 | 1 (215 ms) | 12 | 1 @ **71 ms** | still `Reanimated.FlatList` |
| `settings/stickers` | 13.8 | 0 | 13 | 0 | image grid |
| `(tabs)/profile` | 4.7 | **0** | 34 | 40 | was the worst route repeatedly; PR #143 fixed it |
| `(tabs)` | 2.7 | 0 | 48 | 3 | fine |
| `comments/[id]` | 1.3 | 0 | 53 | 1 | fine |
| `(root)` | 0.3 | 0 | 60 | 1 | fine |

So this is **not** "the whole app's architecture". Four of seven routes are clean, and the profile
screen — previously the worst — is now at 0 long tasks and 0 jank after a targeted structural fix.
A full rewrite would throw that away and reintroduce risk on screens that already work.

Three routes are the problem, and `chat/[id]` is most of it.

## 2. Why `chat/[id]` is architectural and not a missing optimisation

The decisive detail is in the event log:

```
MARK  chat.cachedHistory.read   5 ms
MARK  chat.reverse(120)         0 ms
MARK  chat.dayLabels(120)       1 ms
LONG  long task @ chat/[id]   190 ms   (pendingDecodes 2)
```

**Six milliseconds of measured work inside a 190 ms task.** Every derivation this screen was
suspected of is already cheap. What is expensive is what a new array identity *causes*:

- `app/chat/[id].tsx` is **6,697 lines**; `ChatScreen` is a single **~4,900-line function body**
- holding **26 `useState`**, **39 `useRef`**, **28 `useEffect`**, **53 `useCallback`**, **13 `useMemo`**
- and **12 store subscriptions**

Any one of those re-runs the body that derives `data`, `renderItem` and `dayLabels`, and then
FlashList reconciles 120 rows. There is **no per-row update channel**: changing one field on one
message costs O(n) twice plus a full-list reconcile.

Nine structural problems were catalogued. In priority order:

1. **One component owns the data pipeline *and* the chrome.** Search keystrokes, the emoji panel,
   the scroll button and keyboard state share a render scope with the transcript.
2. **`data` identity is coupled to every store write** — serverId reconcile, upload-URL swap,
   stuck-message sweep, history-poll merge all re-derive the whole render array.
3. **Loading 60 older rows parsed/healed/filtered up to 1000.**
4. **Five sources of truth for one array**: `chat_tail:<id>`, `chat_messages:<id>`,
   `cachedHistoryRef`, `historyHydratedRef`, the live store — with three separate hydrators, each
   with its own heal/merge/tombstone pass. This is why "does row X keep its identity?" has a
   different answer per code path.
5. **The screen subscribes to the global conversation list**, so unrelated chat activity re-renders it.
6. **`renderItem` has 34 dependencies**, including `theme`, `activeMatchId`, `jumpHighlightId`.
   The file already works around this with four ref-indirections — that count is the signal.
7. **27-prop row with a hand-written comparator** that is the only barrier between a parent render
   and 24 bubble re-renders.
8. **Mount cost lives in the row**: two reveal hooks, a `GestureDetector` with a composed gesture,
   three Reanimated layers, an optional `LinearGradient`. 14 × 11–23 ms on first open.
9. **Instrumentation in the hot path**, while the two genuinely expensive passes were outside the spans.

## 3. What has already landed

| PR | change | problem |
|---|---|---|
| #143 | profile revisit: seeded readiness, write-side equality bail-outs, session-scoped request ledger | fixed `(tabs)/profile` — 0 long tasks, 0 jank |
| #145 | transcript memo boundary; conversation-row selector; per-bubble subscription removed; comparator reference shortcut; lazy heal + named span | 1 (partly), 2 (partly), 3, 5, 9 |

## 4. The plan, in reviewable pieces

Each step is independently shippable, independently revertable, and verifiable by `tsc` + jest. No
step depends on a later one. **Ordered by measured impact per unit of risk.**

### Step 1 — Split `ChatScreen` into a data owner and a transcript child
*Problems 1, 2, 6. Largest win. Highest risk, so it goes first while attention is on it.*

Extract `<Transcript>` as a module-level `React.memo` component taking exactly: `data`,
`dayLabels` (via context), the six SharedValues, and the stable callbacks. The screen keeps the
chrome. The memo boundary from #145 already sits where this split goes, so this is mechanical
rather than exploratory.

Grounding: react.dev prescribes splitting at the state read and passing the narrow slice down —
"minimizing props changes", and the context-split technique for `memo`'d children.
<https://react.dev/reference/react/memo>

Acceptance: search keystrokes, emoji panel, scroll button and keyboard motion produce **zero**
transcript re-renders. Verify with a render-count test in the existing `renderBudget` suite.

### Step 2 — One hydrator, one source of truth
*Problem 4.*

Collapse `hydrateFullHistory`, `ensureCachedHistory` and the AsyncStorage fallback into a single
history service with one heal/merge/tombstone pass and one identity contract. The tail cache stays
(it is what makes first paint O(60)); the three-way divergence goes.

Acceptance: `chat.reverse(N)` fires **once** per user action. The recorded `120→120→180→179`
sequence becomes a single write.

### Step 3 — Per-row update channel
*Problem 2, remainder.*

Route highlight, visibility and search-match state through the external-store pattern the file
already uses for `visTracker` (`useSyncExternalStore`, per-row subscription), so search navigation
and reply-jump stop re-rendering every mounted cell. Then `activeMatchId` and `jumpHighlightId`
leave `renderItem`'s dependency list.

Acceptance: pressing ↑/↓ in search re-renders **two** rows (old match, new match), not all mounted.

### Step 4 — Thin the row
*Problems 7, 8.*

Move per-row derivations out of `MessageBubble` and shrink the prop surface so the hand-written
comparator can go. FlashList v2's docs are explicit that v2 expects props to be memoised by the
caller and that row cost is what bounds scroll performance.
<https://shopify.github.io/flash-list/docs/usage>

### Step 5 — `(tabs)/messages` to FlashList v2
*Separate route, second-worst score.*

Still `Reanimated.FlatList` with hand-tuned `initialNumToRender` / `maxToRenderPerBatch` /
`windowSize` / `getItemLayout` — none of which exist in v2 — while comments and profile are already
migrated. 215 ms long task, 71 ms mount, worst FPS 12.

### Step 6 — Image delivery (infrastructure, needs a decision)
*Not a client change. Reported, not made unasked.*

Measured on device:

| source | timings |
|---|---|
| `san-mes-api.odi44972.workers.dev` | 447, 328, 308, 307, 302, 236, 218 ms |
| `api.san-m-app.com` | 157, 136, 106 ms |
| `pub-<hash>.r2.dev` | 343, 310, 225, 114, 94, 68, 62 ms |

Cloudflare documents the cause: **a Worker reading R2 through a binding is not served from
Cloudflare's cache.** Workers run *before* the cache, and only `fetch()` subrequests or an explicit
Cache API / Workers Cache usage are cached.
<https://developers.cloudflare.com/workers/reference/how-the-cache-works/>

Two further documented facts that matter:

- `r2.dev` is **not for production** — "variable rate limit", throttling to HTTP 429, and WAF,
  caching and access controls are all unavailable on it. So the endpoint that currently measures
  *fastest* is the one Cloudflare says not to rely on.
  <https://developers.cloudflare.com/r2/platform/limits/>
- The documented production shape is **R2 behind a custom domain** (which is what puts objects
  behind the CDN, ideally with Smart Tiered Cache), optionally with `/cdn-cgi/image/`
  transformations for per-device sizes.
  <https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/>

Recommendation, for a decision rather than for silent action: put R2 behind a custom domain and
serve images from it; if the Worker must stay in the path for auth, adopt Workers Cache with real
`Cache-Control` headers and verify via `Cf-Cache-Status`.

## 5. What was ruled out, and why

- **Rewriting the app.** Four of seven routes are clean and the profile fix is holding. A rewrite
  discards working code and reintroduces risk where there is currently none.
- **React Compiler.** It is stable, Metro is supported, and Expo SDK 54 has a documented opt-in
  (`experiments.reactCompiler`). But react.dev states it targets **update** performance and is
  explicitly not a fix for first-mount cost — and it memoises only components and hooks, not the
  shared helpers each row calls. It would help Step 1's symptoms without fixing Step 1's cause.
  Worth trying *after* the split, not instead of it. <https://react.dev/learn/react-compiler/introduction>
- **`<Suspense>` for the loading states.** React's docs say Suspense does not activate on data
  fetched in an Effect, and that suspending on a `useSyncExternalStore` value drops you to the
  fallback because store mutations cannot be marked as Transitions. Our data layer is Effect-based
  and Zustand-backed, so this is the wrong lever. <https://react.dev/reference/react/Suspense>
- **More `useMemo`/`useCallback` on top.** The file already has 53 `useCallback` and 13 `useMemo`
  and four ref-indirections written specifically to defeat dependency churn. That density is the
  diagnosis, not the cure.

## 6. Ground rules carried forward

- Validate every icon glyph name against the shipped glyphmap **including prop-driven ones**. A
  `name={icon as any}` compiles with a wrong name and renders an empty box; `tsc` cannot see it and
  jest does not render these screens. This shipped a "?" on device once.
- Never animate `opacity` on any ancestor of `GlassBg` / `NativeGlassView` (expo/expo#41024).
- `str_replace` silently no-ops on `app/(tabs)/messages.tsx`. Use a scripted line-based edit with
  per-anchor uniqueness assertions and a read-back verification.
- Every step verified with `npx tsc --noEmit` and `npx jest` (baseline: 63 suites, 411 passed,
  12 skipped) before it ships, and OTA-published to **both** platforms separately.
