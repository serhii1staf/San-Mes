# Bluesky parity — what to take, in order of value

Grounded in the real `package.json` of [`bluesky-social/social-app`](https://github.com/bluesky-social/social-app)
(v1.132.0), fetched and diffed against ours. Their repo is **MIT** (Copyright
2023–2026 Bluesky Social PBC): use, modify and ship commercially, provided the
copyright + permission notice accompany substantial portions. MIT is permissive
and imposes no copyleft, so it cannot contaminate non-FOSS paths — consistent
with `apple-compliance.md` §3.3.4. Anything copied verbatim gets a `NOTICE`.

Why they are the right reference: React Native + Expo + TypeScript, a production
social network with feeds, DMs, video and moderation. Same stack, same problems,
solved at scale. Telegram is not a usable reference — it is a native Swift/ObjC
layout engine, so only principles transfer, not code.

---

## Three findings that contradict what I previously assumed

These matter more than the shopping list below, because I had been optimising on
the opposite belief.

### 1. They do NOT use FlashList

There is no `@shopify/flash-list` in their dependencies. At all. A production
social feed at their scale runs on React Native's own lists plus React Compiler
plus disciplined memoisation.

I migrated two screens to FlashList this session and told the user it was the
answer. It was *an* answer to a specific measured problem (24 card mounts for 3
visible rows on `profile/[id]`), and that fix stands. But "FlashList is what
makes an app smooth" is not supported by the one production example we have on
this stack. Do not treat further FlashList migrations as automatically correct.

### 2. They measure with `flashlight` + `maestro`, not hand-rolled adb

From their scripts:

    "perf:test:measure": "flashlight test --bundleId xyz.blueskyweb.app
        --testCommand \"pnpm perf:test\" --duration 150000
        --resultsFilePath .perf/results.json"
    "perf:test": "NODE_ENV=test maestro test"
    "perf:measure": "flashlight measure"

`maestro` drives a scripted flow; `flashlight` measures FPS, CPU and RAM over it
and writes a comparable report.

This is the single most important thing to adopt, and it is a process fix, not a
code fix. Over this session my own instrumentation lied **twice** — once by
double-counting card mounts through the reveal queue (reporting ~70 ms where the
real per-card increment was 15–31 ms), once by reporting `ui: 0` fps forever
because the pause filter discards every window. On top of that my adb harness
was contaminated by Facebook running in the background and by my own builds
competing for the host CPU. Every wrong turn this session traces back to bad
measurement. Fix the instrument before optimising anything else.

### 3. They ship a NATIVE text component

`@bsky.app/react-native-uitextview` — their own native module for text.

Text layout is one of the largest costs in a React Native list, and our
`FormattedText` is pure JS: a fence regex, a 12-regex `looksLikeCode` battery,
then one `<RNText>` per inline part. On our profile cards that is 5–15 ms per
card on a cache miss, plus native text measurement on every mount regardless of
cache. Worth investigating, but it needs a native build — not OTA.

---

## Priority list

### P0 — Measurement (do this first, everything else depends on it)

- `maestro` + `flashlight`, wired as npm scripts mirroring theirs.
- Fix or delete our own broken marks:
  - `UserProfilePostCard.body` / `ProfilePostCard.body` double-count, because
    `revealQueue.ts` releases `CARDS_PER_FRAME = 2` into one React batch and both
    cards stop their clocks on the same commit.
  - `PerfMonitorBubble`'s UI fps is permanently 0 — the `uiMaxGap > 120`
    pause filter discards every window on real devices.
- Rule going forward: no perf claim without a flashlight report before and after.

### P1 — Server state: TanStack Query

They use `@tanstack/react-query` + `@tanstack/query-async-storage-persister` +
`@tanstack/react-query-persist-client`. We hand-roll the same job with MMKV
snapshots, Zustand, `syncThrottle`, write-side equality guards in
`entityStore`, and module-level ledgers (`paintedProfileIds`,
`requestedRepostOriginalIds`).

This is the root of "данные перезагружаются" and of the app feeling like it is
"held together with tape": every screen remembers different things in a different
way, so revisits are inconsistent by construction. Query gives one cache, one
staleness model, one persistence layer, and revisit-from-cache for free.

Largest change on this list, and the one that actually answers the complaint.
Pure JS, so OTA-deliverable. Migrate route by route, starting with
`profile/[id]` (worst measured) and `chat/[id]`.

### P2 — Already matched this session

- **React Compiler** — `babel-plugin-react-compiler` + `react-compiler-runtime`,
  `experiments.reactCompiler: true`. Healthcheck: 166/166 components, zero
  bail-outs. Verified active in the bundle. Shipped.
- Follow-up: delete the now-redundant hand-written `useMemo`/`useCallback`.
  Their `CLAUDE.md` instructs contributors not to write them at all. Do this
  only after the compiler has been shown to hold, so regressions stay
  attributable.

### P3 — Also worth taking

- `fast-deep-equal` instead of our hand-rolled `rowEqualIgnoring`.
- `react-native-edge-to-edge` — we already emit
  `setBackgroundColorAsync is not supported with edge-to-edge enabled`.
- `@bsky.app/expo-scroll-edge-effect` — native scroll edge effect. Directly
  relevant to the repeatedly-reported bottom-scrim inconsistency.
- Android `--variant debugOptimized`, which Reanimated's performance guide also
  recommends.
- `oxlint` in place of eslint (developer speed, not runtime).

### P4 — Needs a native build, defer

They run Expo 57 / RN 0.86 / React 19.2.3; we are on Expo 54 / RN 0.81.5 /
React 19.1.0. Being two SDKs behind also blocks the Reanimated feature flags
that matter for us: `IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS` and
`USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS` need Reanimated ≥ 4.2.0 (we have
4.1.7), and they are static native flags regardless.

---

## The chat experiment (requested)

Their DM screens live in `src/screens/Messages/`. What is and is not portable:

**Not portable.** Their chat talks to `chat.bsky.convo.*` through their `agent`
from `@atproto/api`, with their auth, their schema and their cursor pagination.
We are on Supabase + Ably. Lifting it whole means lifting their entire data
layer, which produces their app, not ours with their chat.

**Portable, and it is the part that decides smoothness.** The rendering layer:
list virtualisation, keeping scroll position while prepending older messages,
message-cell geometry and grouping. None of that depends on the protocol.

Plan, revertible by deleting one file:
1. `app/chat/labs/[id].tsx`. `app/chat/[id].tsx` is not touched.
2. Their message-list rendering, fed with OUR data.
3. Seed several hundred messages with images and GIFs so the load is real.
4. `NOTICE` for anything verbatim.
5. Measure with flashlight against the current chat.

The result is diagnostic either way: if their list flies with our data, our
renderer is the problem and we replace it. If it stalls too, the problem is data
and network, and further renderer work is wasted.
