# Cloudflare D1 migration — Tasks

This is a phased migration. Each phase is independently shippable and
revertible. Sub-agents working on a phase MUST read `requirements.md`
and `design.md` first.

## Phase 1 — Foundations ✅ (this PR)

- [x] 1.1 Reverse-engineer the Supabase schema from every
      `supabase.from(...)` call. Document tables, columns, FKs,
      defaults in `requirements.md`. Capture gaps that need
      verification once Supabase unblocks.
- [x] 1.2 Write `workers/schema.sql` with SQLite DDL for the 9 tables
      and indexes for every observed `WHERE` / `ORDER BY` / `IN`.
      Postgres → SQLite type translation per `design.md` mapping.
- [x] 1.3 Apply the schema to D1 via `npx wrangler d1 execute san-mes
      --remote --file workers/schema.sql`. Verify via `SELECT name
      FROM sqlite_master WHERE type='table'`.
- [x] 1.4 Scaffold the Worker under `workers/api/`:
      `wrangler.toml`, `package.json`, `tsconfig.json`,
      `src/index.ts`, `src/db.ts`, `src/auth.ts`, `.gitignore`.
- [x] 1.5 Implement `GET /v1/health` (proves routing + D1 binding).
- [x] 1.6 Implement `GET /v1/posts/:id` (proves JOIN + empty handling).
- [x] 1.7 JWT verification against Supabase JWKS via `jose`,
      module-level cache for 24h.
- [x] 1.8 CORS for known origins + OPTIONS short-circuit.
- [x] 1.9 `npx wrangler deploy` from `workers/api/`. Capture URL.
- [x] 1.10 `curl <url>/v1/health` returns `{ ok:true, dbHealthy:true }`.
- [x] 1.11 `curl <url>/v1/posts/<random-uuid>` returns
      `{ data:null, error:null }`.
- [x] 1.12 Update root `.gitignore` to cover Worker local state.

## Phase 1.5 — Egress reduction (independent commit)

Client-side only; no Worker dependency. Ships today.

- [ ] 1.5.1 `FollowsListModal.tsx` — synchronous MMKV hydrate from
      `@san:followers:<id>` / `@san:following:<id>` on mount,
      background refetch. 24h TTL.
- [ ] 1.5.2 `app/comments/[id].tsx` — confirm synchronous on-mount
      MMKV hydrate is wired correctly. Add 5-minute TTL guard on the
      on-mount network refetch.
- [ ] 1.5.3 `app/(tabs)/index.tsx` — feed page size 50 → 20.
- [ ] 1.5.4 `app/(tabs)/profile.tsx` — own posts page size 50 → 25.
- [ ] 1.5.5 `app/profile/[id].tsx` — other-profile posts limit 50 → 25.
- [ ] 1.5.6 `services/syncService.ts` — verify `shouldSync` is honoured
      on every entry point. Tighten any bypass paths.

## Phase 2 — Read endpoints

Move read traffic onto the Worker. Writes still go to Supabase via
`offlineQueue.ts`. A feature flag `useD1Reads` (default `false` in
prod) gates the cutover so we can flip one screen at a time.

- [x] 2.1 Implement Phase 2 endpoints listed in `design.md`:
      `/v1/feed`, `/v1/profiles[/:id]`, `/v1/posts/:id/comments`,
      `/v1/profiles/:id/{followers,following,follow-counts,likes,comments}`,
      `/v1/conversations[/:id/messages]`, `/v1/mini-apps`.
      Plus `/v1/profiles/by-username/:username`,
      `/v1/profiles/by-device-key/:deviceKey`,
      `/v1/profiles/:id/posts`, `/v1/profiles/:id/replies` (renamed
      from `comments` to disambiguate from `/posts/:id/comments`),
      `/v1/mini-apps/:id`. Smoke tests via `vitest run` cover the
      router + util + a few representative endpoints.
- [x] 2.2 Add `src/services/apiClient.ts` — typed wrapper around
      `fetch` to the Worker base URL with auth header injection,
      8 s default timeout, offline short-circuit, perfMonitor
      integration. Exposes `apiGet`, `apiPost`, `apiPatch`,
      `apiDelete`.
- [x] 2.3 Add `useD1Reads` to `src/store/settingsStore.ts`. Default
      `__DEV__ ? true : false`. Persisted via the existing settings
      store storage layer.
- [ ] 2.4 Port one read at a time: each is its own commit so
      rollbacks are surgical. Worker errors fall through to Supabase
      and log to perfMonitor.
      - [x] 2.4.1 `getProfile` — proof-of-concept wiring shipped in
            `feat(profile): wire getProfile through useD1Reads flag`.
      - [ ] 2.4.2 `getPosts` (feed read).
      - [ ] 2.4.3 `getProfiles` (discover list).
      - [ ] 2.4.4 `getComments` (post comments thread).
      - [ ] 2.4.5 `getFollowers` / `getFollowing` (modal lists).
      - [ ] 2.4.6 `getFollowCounts` (profile header counts).
      - [ ] 2.4.7 `getLikedPosts` / `getUserComments` (profile tabs).
      - [ ] 2.4.8 `getConversations` / `getMessages` (chat list,
            chat thread).
      - [ ] 2.4.9 `miniAppsStore.loadApps` + the `app/mini/[id].tsx`
            single-app fetch.
- [x] 2.5 On every ported function, fall through to Supabase when
      the Worker call fails. Log the error to perfMonitor so we
      surface schema mismatches early. Implemented for `getProfile`;
      remaining ports inherit the same pattern.
- [ ] 2.6 Manual smoke: feed, profile, comments, notifications,
      followers/following modal — all populate correctly with the
      flag on AND with the flag off.
- [x] 2.7 Developer toggle on `app/settings/admin.tsx` (admin-only
      screen) under a "D1 migration" section. Shows the current
      Worker URL alongside for sanity-checking deploys.

## Phase 3 — Dual-write

Every successful Supabase write also fires a best-effort Worker write.
Surfaces schema mismatches before cutover. Idempotent via
`client-mutation-id` header.

- [ ] 3.1 Implement Phase 3 write endpoints (see `design.md`).
- [ ] 3.2 Wire `client-mutation-id` from `offlineQueue.generateTempId()`
      through to every Worker write.
- [ ] 3.3 In `offlineQueue.sendToServer`, after each successful
      Supabase call, fire the matching Worker call. Errors logged to
      perfMonitor; never bubble to the user.
- [ ] 3.4 Run for 1 week with metrics. If Worker error rate > 1 %,
      investigate before proceeding.

## Phase 4 — Data migration

When Supabase egress unblocks (next billing reset, ~July 1):

- [ ] 4.1 Verify Supabase access by hitting any read endpoint from a
      curl one-off.
- [ ] 4.2 From the Supabase dashboard SQL editor, export each of the
      9 tables to CSV via `COPY (...) TO STDOUT WITH CSV HEADER`.
      Save to `workers/data/{table}.csv` (gitignored).
- [ ] 4.3 Write `workers/scripts/import.ts` — reads each CSV and
      streams `INSERT OR IGNORE` per row into D1. Idempotent on
      replay. Chunked into 1000-row batches.
- [ ] 4.4 Run `npx tsx workers/scripts/import.ts` against `--remote`.
- [ ] 4.5 Verify `COUNT(*)` parity per table between Supabase and D1.
      Difference must be ≤ Phase-3 dual-write count (rows created
      after the export but before the import completed).
- [ ] 4.6 Spot-check 20 random rows per table for byte-equal content.

## Phase 5 — Cutover

Flip reads + writes to D1. Supabase becomes a read-only fallback.

- [ ] 5.1 Replace `useD1Reads: boolean` with
      `dataLayer: 'd1' | 'supabase' | 'dual'` in `settingsStore`.
- [ ] 5.2 Update `src/lib/supabase.ts` callers to route through
      `apiClient` when `dataLayer === 'd1'`.
- [ ] 5.3 Set `dataLayer = 'd1'` in production via OTA.
- [ ] 5.4 Monitor for 2 weeks. If error budget intact, proceed.
- [ ] 5.5 Remove the Supabase fallback paths. Remove the
      `dataLayer` flag (always D1).
- [ ] 5.6 Decommission Supabase: cancel project (or downgrade to free
      and leave it cold for archival). Remove
      `@supabase/supabase-js` from root deps.

## Phase 6 — Auth replacement (separate spec)

Lower priority because auth has minimal egress (JWKS endpoint only).
Tracked here for completeness; the actual work lands in
`.kiro/specs/auth-replacement/`.

- [ ] 6.1 Decide between Better-Auth on Workers vs. self-hosted JWT
      issuer backed by D1.
- [ ] 6.2 Migrate the `pin_hash`-based login flow.
- [ ] 6.3 Issue our own JWTs; the Worker `auth.ts` switches from
      JWKS verification to symmetric `jwtVerify` with a Worker secret.
- [ ] 6.4 Remove Supabase Auth from the client.
