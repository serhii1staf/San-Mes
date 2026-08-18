# Implementation Plan: Seasonal Profile Themes

## Overview

This plan builds Seasonal Profile Themes bottom-up: pure logic first (the theme
registry + total resolver, the effective-render selectors, particle-pool math,
the animation gate, and the per-account store), then property-based tests over
that logic, then the rendering components, then profile-screen wiring, then the
theme selection screen, then the backend column + validation, then the client
plumbing that mirrors `banner_url`, and finally the asset license manifest +
build-fail verifier.

Language: **TypeScript** (React Native / Expo SDK 54), matching the existing
codebase. Tests use **fast-check + Jest**, the project's existing PBT stack
(`src/**/__tests__/*.property.test.ts`), ≥100 iterations per property, each
tagged `// Feature: seasonal-profile-themes, Property {n}: {text}`.

PLACEHOLDER strategy (design "Asset dependency"): built-in themes ship with
`backgroundIllustration = null` and `themeFont.asset = null` until real assets
are sourced/licensed. Every task below — code and tests — must work with **zero
asset files present**; themes resolve palette-only via the same fallback path
used for a failed image load. Tasks that require real (not-yet-sourced)
illustration/font assets are marked optional and **[BLOCKED ON ASSETS]** so the
rest of the feature is fully implementable now.

Performance constraints from Requirements 6 and 7 (≥55 FPS while animating and
during scroll, pause-on-scroll within 100 ms / resume within 200 ms,
weak-device = 0 particles) are called out on the relevant tasks and verified via
the project's `perfMonitor` FPS snapshots (manual, noted as sub-bullets).

## Tasks

- [x] 1. Theme registry + total resolver (pure logic)
  - [x] 1.1 Implement `src/theme/profileThemes.ts` registry and resolver
    - Define `ProfileThemeId`, `AmbientAnimationType`, `ThemePalette`, `EmojiAccentSet`, `ThemeFont`, `ProfileTheme` types per design §"Components and Interfaces #1"
    - Build `BUILT_IN_THEMES` (exactly six: `default-dark`, `spring`, `summer-beach`, `autumn`, `winter`, `purple-pixel`) and stable-order `BUILT_IN_THEME_LIST`; set `backgroundIllustration: null` and `themeFont.asset: null` on all (PLACEHOLDER); `default-dark` has null illustration/ambient/emoji/font and a complete neutral dark palette
    - Implement `isKnownThemeId`, `DEFAULT_THEME_ID`, total `resolveProfileTheme(id)` (never throws / never `undefined`), and `resolveProfileThemeResult(id)` returning `{ theme, requestedId, isFallback }`
    - Re-export from `src/theme/index.ts` (no parallel provider — Req 9.1)
    - _Requirements: 1.1, 1.2, 1.6, 1.7, 3.5, 3.6, 5.1, 5.2, 5.5, 5.6, 9.1, 9.6, 9.7_

  - [x]* 1.2 Write property test for resolver totality + purity
    - **Property 1: Resolver is total and pure with a complete output**
    - Generators: `fc.oneof(fc.constantFrom(...KNOWN_IDS), fc.string(), fc.constant(null), fc.constant(undefined))`; assert ≥2 gradient stops, defined font, stable repeat result, no throw
    - **Validates: Requirements 3.5, 5.5, 5.6**

  - [x]* 1.3 Write property test for missing/unknown → Default_Theme
    - **Property 2: Missing or unknown ids resolve to the Default_Theme**
    - **Validates: Requirements 1.7, 3.6, 5.1, 5.2, 9.6**

  - [x]* 1.4 Write property test for fallback-result preservation
    - **Property 3: Fallback resolution preserves the requested id and flags the fallback**
    - Assert `requestedId === input` and `isFallback === !isKnownThemeId(input)`; when fallback, `theme.id === 'default-dark'`
    - **Validates: Requirements 9.7**

  - [x]* 1.5 Write property test for palette structural validity
    - **Property 15: Every built-in palette is structurally valid**
    - Over `fc.constantFrom(...BUILT_IN_THEME_LIST)`: gradient length ∈ [2,5], non-empty `text`/`secondaryText`/`accent`, complete emoji slots when defined, non-empty font family when defined
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5**

  - [x]* 1.6 Write unit test for registry shape
    - Exactly six ids equal to the expected set; `default-dark` is neutral and attribute-free
    - _Requirements: 1.1, 1.6_

- [x] 2. Effective-render selectors (pure logic)
  - [x] 2.1 Implement `src/theme/profileThemeEffective.ts`
    - `effectiveEmojiAccents(theme)` → the set or null (Req 4.6, 4.7)
    - `effectiveFont(theme, fontState: 'loaded'|'loading'|'error'|'absent')` → theme family only when defined and loaded, else app default; palette always retained (Req 4.8, 4.9, 5.4)
    - `effectiveIllustration(theme, loadState: 'ok'|'error'|'timeout'|'absent')` → illustration only on `ok` with a non-null asset, else palette-only (Req 4.5, 5.3, 7.7)
    - `effectiveStaticAttributes(theme, animationEnabled)` → palette/illustration/emoji computed identically regardless of `animationEnabled` (Req 7.5)
    - _Requirements: 4.5, 4.6, 4.7, 4.8, 4.9, 5.3, 5.4, 7.5, 7.7_

  - [x]* 2.2 Write property test for emoji-accent presence
    - **Property 4: Emoji accents are rendered exactly when the theme defines them**
    - **Validates: Requirements 4.6, 4.7**

  - [x]* 2.3 Write property test for theme-font selection
    - **Property 5: Profile font is the theme font when present and loaded, otherwise the app default**
    - Over themes × `fc.constantFrom('loaded','loading','error','absent')`
    - **Validates: Requirements 4.8, 4.9, 5.4**

  - [x]* 2.4 Write property test for illustration load-failure fallback
    - **Property 6: Illustration load failure degrades to palette-only**
    - Over themes × `fc.constantFrom('ok','error','timeout','absent')`
    - **Validates: Requirements 4.5, 5.3, 7.7**

  - [x]* 2.5 Write property test for static attributes vs animation gate
    - **Property 8: Static theme attributes are independent of the animation gate**
    - Over themes × `fc.boolean()` animationEnabled; assert palette/illustration/emoji identical
    - **Validates: Requirements 7.5**

- [x] 3. Weak-device detection, particle-pool math, and animation gate (pure logic)
  - [x] 3.1 Implement `src/utils/deviceCapability.ts` + `useWeakDevice()`
    - Privacy-safe coarse heuristic (no fingerprinting, no new permissions — Apple §3.3.3): iOS liquid-glass-capable → not weak; Android/non-glass or `Device.deviceYearClass`/low memory or Android API ≤ 30 → weak; memoized once per session
    - _Requirements: 7.1, 7.5_

  - [x] 3.2 Implement particle-pool sizing in `src/components/profile/ambientParticles.ts`
    - Export `PARTICLE_CAP = 14`, `PARTICLE_CAP_WEAK = 0`, and pure `computeParticlePoolSize(requestedCount, isWeak)` clamped to `[0, PARTICLE_CAP]`, returning `0` when weak
    - _Requirements: 6.1, 7.1_

  - [x]* 3.3 Write property test for particle-pool sizing
    - **Property 7: Particle count never exceeds the Particle_Cap**
    - Over `fc.integer()` requested × `fc.boolean()` weak; assert `0 ≤ size ≤ PARTICLE_CAP` and `size === 0` when weak
    - **Validates: Requirements 6.1, 7.1**

  - [x] 3.4 Implement `src/hooks/useReducedMotion.ts` + `src/hooks/useAmbientAnimationGate.ts`
    - `useReducedMotion()` wraps `AccessibilityInfo.isReduceMotionEnabled()` + `reduceMotionChanged` listener (updates within 500 ms, no remount — Req 7.3)
    - Extract a pure `computeAmbientGate({ hasAnimation, isWeak, reducedMotion })` core returning `{ enabled, particleCap }`; hook composes it with `useWeakDevice`/`useReducedMotion`; `AppState`/focus drive the transient `paused` prop, not `enabled` (Req 6.7)
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

  - [x]* 3.5 Write property test for animation-gate suppression
    - **Property 9: Ambient animation is disabled under any suppressing condition**
    - Over themes × `fc.boolean()` weak × `fc.boolean()` reducedMotion against `computeAmbientGate`
    - **Validates: Requirements 7.1, 7.2**

- [x] 4. Per-account owner theme state
  - [x] 4.1 Implement `src/store/profileThemeStore.ts` + `useActiveProfileThemeId(accountId)`
    - `byAccount` map keyed via `accountKey()`; `getThemeId`, `setThemeId` (optimistic/commit), `revertThemeId(prev)`; isolation so updating one account never touches others (Req 9.5)
    - _Requirements: 9.5, 9.6_

  - [x]* 4.2 Write property test for per-account isolation
    - **Property 11: Theme_Id is isolated per account**
    - Over `fc.dictionary(accountId, themeId)` × an arbitrary `setThemeId`; assert only the target key changes
    - **Validates: Requirements 9.5**

- [x] 5. Rendering components (background, scope, ambient layer)
  - [x] 5.1 Implement `ProfileThemeContext` + `src/components/profile/ProfileThemeScope.tsx`
    - Resolve via `resolveProfileTheme`; render Layer 0 palette gradient (`expo-linear-gradient`) and provide resolved theme/accents/font through context **scoped to the subtree only**; context default = `DEFAULT_THEME`, `emojiAccents: null`, app default font (no leakage — Req 4.10)
    - Glass cards remain **siblings on top** of the background layers, never children of an animating layer (design rendering-stack rule)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.10, 6.5_

  - [x]* 5.2 Write property test for scope containment
    - **Property 10: Theme attributes are confined to the profile screen scope**
    - Assert reading `ProfileThemeContext` outside any `ProfileThemeScope` yields default values for any active theme
    - **Validates: Requirements 4.10, 6.5**

  - [x] 5.3 Implement `src/components/profile/ProfileThemeBackground.tsx`
    - Mirror `ChatBackgroundLayer` absoluteFill; `expo-image` for bundled `require()` sources; `null` illustration → render nothing (palette shows through); 5 s timer + `onError` → palette-only fallback; owns its own fade-in as a sibling-under-glass (Req 9.2)
    - _Requirements: 4.5, 5.3, 7.7, 9.2_

  - [x] 5.4 Implement `src/components/profile/AmbientAnimationLayer.tsx`
    - Reanimated UI-thread particle system; `pointerEvents="none"`, `StyleSheet.absoluteFill`; fixed pool sized once via `computeParticlePoolSize` (provably ≤ `PARTICLE_CAP`, 0 on weak device); `paused` freezes via shared value while keeping the static background visible
    - **Perf: ≥55 FPS while animating (Req 6.6/7.6); pause ≤100 ms on scroll start (Req 6.2), resume ≤200 ms (Req 6.3); pause on background/off-screen (Req 6.7) — verify via `perfMonitor` FPS snapshots**
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.6_

  - [x]* 5.5 Write unit/example tests for ambient wiring
    - `onScrollBeginDrag` pauses; `onScrollEndDrag`/`onMomentumScrollEnd` resumes; `AppState` background + screen blur pause; paused keeps static background; reduced-motion toggled at runtime suppresses within 500 ms without remount
    - _Requirements: 6.2, 6.3, 6.4, 6.7, 7.3_

- [x] 6. Profile-screen integration and themed controls (wiring)
  - [x] 6.3 Implement theme-aware accent controls + themed text
    - New components in `src/components/profile/` (e.g. `ThemedLikeIcon`, `ThemedMenuTrigger`, `ThemedFollowButton`, `ThemedProfileText`) reading `useProfileThemeAccents()`/font from context: render the emoji glyph when an `EmojiAccentSet` exists, otherwise the existing Feather controls; apply themed font only within the scope, falling back to app default after 5 s/error
    - _Requirements: 4.6, 4.7, 4.8, 4.9, 5.4_

  - [x] 6.1 Integrate theme into owner profile `app/(tabs)/profile.tsx`
    - Wrap scroll content in `<ProfileThemeScope themeId={useActiveProfileThemeId(currentUser.id) ?? currentUser.themeId} scrollActive={...} screenFocused={useIsFocused()}>`; derive `scrollActive` from existing scroll handlers; mount `ProfileThemeBackground` + gated `AmbientAnimationLayer`; swap like/menu/follow to the themed controls; keep `useLiquidGlassActive()` glass-vs-fallback gate drawing fallback colors from the resolved palette
    - **Perf: scroll ≥55 FPS on the primary Weak_Device, within 5 FPS of themeless baseline (Req 7.6) — verify via `perfMonitor`**
    - _Requirements: 4.2, 4.4, 6.2, 6.3, 7.4, 9.3_

  - [x] 6.2 Integrate theme into visitor profile `app/profile/[id].tsx`
    - Same wrapping using `profile.theme_id` from the entity store/fetch; resolve unknown/missing to default; same scroll-pause + glass-fallback wiring
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 7.4, 9.3_

  - [x]* 6.4 Write render integration tests (React Native Testing Library)
    - Own + visitor profile apply the resolved theme; background is an absoluteFill layer above which glass cards sit; `useLiquidGlassActive()` toggles glass vs non-glass fallback; emoji accents/font appear only inside the scope
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 4.10, 7.4, 9.2, 9.3_

- [x] 7. Theme selection screen
  - [x] 7.1 Implement `src/components/profile/ProfileThemePreviewCard.tsx`
    - Memoized miniature: palette swatch + illustration thumbnail (null-safe placeholder) + static emoji accents; no ambient animation in previews
    - _Requirements: 2.1, 2.2_

  - [x] 7.2 Implement `app/settings/profile-theme.tsx`
    - Mirror `appearance.tsx`: `InteractionManager`-deferred `cardsReady` gate; horizontal `FlatList` over `BUILT_IN_THEME_LIST` with `getItemLayout`, `initialNumToRender={2}`, `maxToRenderPerBatch={1}`, `windowSize={3}`, `removeClippedSubviews` (visible viewport + ~1 overscan)
    - Mark persisted id selected, else `default-dark`; on confirm do optimistic per-account `setThemeId`, then `PATCH /v1/profiles/me { theme_id }` raced against a 5 s timer; on success commit, on reject/timeout/`invalid_theme_id` revert via `revertThemeId` and `showToast` error
    - **Perf: opening the screen produces no `perfMonitor` long-task marker (Req 2.7) — verify via FPS snapshot**
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.2, 3.7, 3.8, 9.4_

  - [x]* 7.3 Write property test for optimistic commit/revert
    - **Property 13: Selection commits optimistically and reverts on persistence failure**
    - Over (prev known id, selected known id) with a mocked client forced to succeed/reject/never-resolve; fake timers for the 5 s race
    - **Validates: Requirements 2.4, 2.6, 3.8**

  - [x]* 7.4 Write example tests for the selection screen
    - Renders 6 previews; marks persisted id (or `default-dark` when none); uses the deferred-mount + virtualized `FlatList` config mirroring `appearance.tsx`
    - _Requirements: 2.1, 2.2, 2.3, 9.4_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all client-side unit/property/integration tests pass, ask the user if questions arise.

- [x] 9. Backend theme_id column, validation, and realtime
  - [x] 9.1 Add `theme_id` to schema `workers/schema.sql`
    - `ALTER TABLE profiles ADD COLUMN theme_id TEXT;` (nullable; NULL ⇒ default), mirroring `banner_url`'s migration
    - _Requirements: 3.1_

  - [x] 9.2 Thread `theme_id` through `workers/api/src/db.ts`
    - Append `theme_id` to `PROFILE_FULL_COLUMNS` so every projection returns it; `normalizeProfile` passes it through unchanged (string|null)
    - _Requirements: 3.1, 3.3, 3.5_

  - [x] 9.3 Validate + persist in `PATCH /v1/profiles/me` (`workers/api/src/routes/profiles.ts`)
    - Add `workers/api/src/themeIds.ts` shared known-id list (mirror of the RN registry); extract pure `validateThemeId(value)`; accept valid `theme_id` (bind + `recordChange('theme_id', next)` so it joins the realtime delta), reject unknown with `invalid_theme_id` (400) leaving the stored value unchanged
    - _Requirements: 3.2, 3.4, 3.7_

  - [x]* 9.4 Write property test for server validation
    - **Property 12: Server accepts known Theme_Ids and rejects unknown ones without mutating state**
    - Over `fc.oneof(known ids, arbitrary strings)` against `validateThemeId`
    - **Validates: Requirements 3.7**

  - [x]* 9.5 Write lock-step test: Worker id list equals RN registry
    - Assert `workers/api/src/themeIds.ts` list deep-equals the `BUILT_IN_THEME_LIST` ids from `src/theme/profileThemes.ts`
    - _Requirements: 3.7, 1.1_

  - [x]* 9.6 Write backend round-trip integration tests
    - `PATCH` then `GET /v1/profiles/me` round-trips `theme_id`; `GET /v1/profiles/:id` includes it; a `profile.edit` event carrying `theme_id` updates a mounted profile without restart
    - _Requirements: 3.1, 3.3, 3.4_

- [x] 10. Client profile plumbing (mirror `banner_url`)
  - [x] 10.1 Add `theme_id` to `src/lib/supabase.ts`
    - Extend `ProfileRow` and `updateProfile` types with `theme_id?: string | null`
    - _Requirements: 3.1, 3.3_

  - [x] 10.2 Add `theme_id` to `src/services/cacheService.ts`
    - Extend the `Profile` cache shape; persist in the existing per-account MMKV cache
    - _Requirements: 3.3, 9.5_

  - [x] 10.3 Add `theme_id` to `src/services/syncService.ts`
    - Include it in profile upserts/reads
    - _Requirements: 3.3, 3.5_

  - [x] 10.4 Add `themeId` to `authStore` user mapping
    - Map `theme_id` → `themeId` on the `user` object, matching `bannerUrl`
    - _Requirements: 3.3, 4.2_

  - [x] 10.5 Map `theme_id` in `AccountSwitcher`
    - Add the field to the per-account profile mappings
    - _Requirements: 3.3, 9.5_

  - [x] 10.6 Handle `theme_id` in `RealtimeAccountBridge.tsx`
    - Map the `profile.edit` `theme_id` delta into the entity store/authStore so renders update within 5 s without restart
    - _Requirements: 3.4, 3.5_

- [x] 11. Asset license manifest + build-fail verifier
  - [x] 11.1 Create `assets/profile-themes/licenses.json`
    - Initialize an empty records array (PLACEHOLDER phase); schema per record: `{ assetPath, type: 'illustration'|'font', licenseType, source, owner }`
    - _Requirements: 8.1, 8.2_

  - [x] 11.2 Implement `scripts/verify-theme-assets.js` + wire it up
    - Export pure `verifyThemeAssets(manifest, refs)`; enumerate every non-null `backgroundIllustration` / `themeFont.asset` in `BUILT_IN_THEMES`, assert each has a complete distribution-permitting record, exit non-zero naming any unlicensed asset (excluded from the shipped set); skip emoji glyphs
    - Add `"verify:theme-assets"` to `package.json` scripts and invoke it from the prebuild step in `.github/workflows/build-*.yml` (sub-note: CI/prebuild gate — passes with zero records while assets are PLACEHOLDER)
    - _Requirements: 8.3, 8.4, 8.5, 8.6_

  - [x]* 11.3 Write property test for the verifier
    - **Property 14: Asset-license verifier passes iff every shipped asset has a valid record**
    - Over generated `{ assets, records }` with arbitrary license types against `verifyThemeAssets`; assert success iff all shipped assets have valid records, and the error names every offending asset; emoji glyphs never required
    - **Validates: Requirements 8.1, 8.2, 8.4, 8.5, 8.6**

- [ ] 12. [BLOCKED ON ASSETS] Source and wire real theme assets
  - [ ]* 12.1 Add licensed background illustrations and wire them in **[BLOCKED ON ASSETS]**
    - Drop bundled illustration files for `spring`/`summer-beach`/`autumn`/`winter`/`purple-pixel`; set their `backgroundIllustration` to `require()` in `src/theme/profileThemes.ts`; add a matching record per asset to `licenses.json` (verifier must pass)
    - _Requirements: 1.3, 8.1, 8.4, 8.5_

  - [ ]* 12.2 Add the licensed `purple-pixel` font and wire it in **[BLOCKED ON ASSETS]**
    - Add the bundled pixel font; set `themeFont.asset` `require()` in `src/theme/profileThemes.ts`; load via `expo-font`; add the font's `licenses.json` record (verifier must pass)
    - _Requirements: 1.5, 8.2, 8.4, 8.5_

- [ ] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass and `npm run verify:theme-assets` succeeds; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests, plus the asset-dependent tasks) and can be skipped for a faster placeholder-phase MVP; core non-`*` tasks deliver a fully working palette-only feature with zero asset files present.
- Tasks tagged **[BLOCKED ON ASSETS]** (12.1, 12.2) depend on real illustration/font assets that must be sourced/owned or licensed before App Store submission (Apple §3.3.4). Everything else is implementable now.
- Each task references specific granular requirements for traceability.
- Property tests use fast-check + Jest, ≥100 iterations, tagged `// Feature: seasonal-profile-themes, Property {n}: {text}`, mapped to the pure function they validate (resolver, effective selectors, particle pool, gate, store, server validator, verifier).
- Performance (Req 6, 7) and long-task (Req 2.7) constraints are verified via the project's `perfMonitor` FPS snapshots — noted as sub-bullets, not standalone tasks.
- OTA caveat: new bundled assets/fonts ship only via a native build, never OTA (per workspace Apple-compliance steering) — relevant to tasks 12.1/12.2.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "3.2", "4.1", "9.1", "10.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "1.6", "2.1", "3.3", "3.4", "4.2", "9.2", "10.2", "10.3", "10.4", "10.5", "10.6", "11.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "3.5", "5.1", "5.3", "5.4", "9.3", "11.2"] },
    { "id": 3, "tasks": ["5.2", "5.5", "6.3", "7.1", "9.4", "9.5", "9.6", "11.3", "12.1"] },
    { "id": 4, "tasks": ["6.1", "6.2", "7.2", "12.2"] },
    { "id": 5, "tasks": ["6.4", "7.3", "7.4"] }
  ]
}
```
