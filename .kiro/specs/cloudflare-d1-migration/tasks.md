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

## Phase 3 — Worker write endpoints ✅

Auth + every write surface routed through the Worker.

- [x] 3.1 Implement Phase 3 write endpoints. Auth (register, login,
      login-with-pin, me, refresh, delete account), posts CRUD + repost
      + like toggle, comments edit/delete, profiles PATCH, follow PUT/
      DELETE + exists probe, conversations + messages, mini-apps CRUD,
      notifications consolidation, admin endpoints under `X-Admin-Key`.
- [x] 3.2 (skipped) `client-mutation-id` was the dual-write idempotency
      shim — not needed now that the Worker is the only write target.
      Solo-user fresh cutover obsoletes the dual-write phase.
- [x] 3.3 (skipped) `offlineQueue.sendToServer` calls the Worker via
      `src/lib/supabase.ts` shims; no Supabase write fires.
- [x] 3.4 (skipped) Dual-write metrics window unnecessary — solo user
      fresh-cutover.

## Phase 4 — Data migration ✅ (skipped)

Solo-developer cutover: no production rows exist in Supabase that need
to follow the user. The user re-registers fresh on the next OTA.

## Phase 5 — Cutover ✅

Every read + write flows through the Worker.

- [x] 5.1 `useD1Reads: boolean` → `dataLayer: 'd1' | 'supabase'`,
      default `'d1'` in production. The `'supabase'` value is an
      emergency escape-hatch label only; `supabase.ts` no longer
      honours it (it always uses the Worker).
- [x] 5.2 Every `getXxx` and write function in `src/lib/supabase.ts`
      delegates to `apiClient` / `authClient`. The Supabase JS client
      stays imported only as a `getPublicUrl()` formatter for legacy
      image URLs.
- [x] 5.3 Default `dataLayer = 'd1'` ships in production via the next
      OTA on `main`.
- [x] 5.4 (skipped) Two-week monitoring window unnecessary for a solo
      cutover.
- [x] 5.5 Supabase fallback paths removed from the hot path.
      `@supabase/supabase-js` import remains in `lib/supabase.ts` for
      the storage `getPublicUrl()` URL formatter; cleanup pass tracked
      separately.
- [ ] 5.6 Decommission Supabase: cancel project (or downgrade to free
      and leave it cold for archival). Remove
      `@supabase/supabase-js` from root deps. Tracked separately.

## Phase 6 — Auth replacement ✅

Worker is the auth authority. HS256 JWTs signed by `JWT_SECRET`,
verified by the same Worker on every authed request.

- [x] 6.1 Self-hosted symmetric JWT issuer backed by D1 — no
      Better-Auth dependency.
- [x] 6.2 PIN-hash login flow ported as-is. Server-side `hashPin`
      mirrors the client algorithm so the on-the-wire shape stays
      stable.
- [x] 6.3 `auth.ts:verifyToken` switched from JWKS to symmetric
      `jwtVerify(token, JWT_SECRET, { algorithms: ['HS256'] })`.
      `signToken(env, userId)` mints fresh 30-day tokens.
- [x] 6.4 Supabase Auth removed from the client.
      `src/services/authClient.ts` wraps the Worker auth endpoints.
