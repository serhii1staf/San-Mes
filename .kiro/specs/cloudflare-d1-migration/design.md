# Cloudflare D1 migration — Design

## Architecture

```
                        ┌──────────────────────────────────────┐
                        │           iOS / Web client           │
                        │  (expo-router, MMKV, Zustand store)  │
                        └────────┬─────────────────┬───────────┘
                                 │                 │
                  Supabase JWT   │                 │  R2 public URL
                                 ▼                 ▼
              ┌─────────────────────────┐    ┌──────────────────┐
              │   Supabase project      │    │   R2 buckets     │
              │   (legacy data layer)   │    │   san, san-uploads│
              │   ycwadqglcykcpucembjn  │    └──────────────────┘
              └────────┬─────┬──────────┘
                       │     │
        Phase 2: reads │     │ Phase 3: dual-writes
                       ▼     ▼
              ┌─────────────────────────┐
              │   san-mes-api Worker    │  ← Phase 1 lands here
              │   workers.dev URL       │     • routing
              │   /v1/health            │     • CORS
              │   /v1/posts/:id         │     • JWT verify
              └────────┬────────────────┘     • D1 binding
                       │
                       │ D1 prepared statements
                       ▼
              ┌─────────────────────────┐
              │     D1: san-mes         │
              │   62428750-…-a95d16     │
              │   9 tables, EEUR        │
              └─────────────────────────┘
```

The Worker is a thin REST layer in front of D1. Phase 1 wires the
plumbing only; subsequent phases extend the surface area.

## Endpoint contracts

All JSON responses share the shape `{ data: T | null, error: string | null }`
to mirror what the existing `getXxx` callers in `src/lib/supabase.ts`
destructure. That symmetry lets us port a caller from Supabase to the
Worker without altering its consumer.

### `GET /v1/health` (Phase 1)

Validates routing + D1 binding. Used by the OTA pipeline and by
`app/settings/admin.tsx`'s service-status page once Phase 2 wires it.

```http
GET /v1/health
→ 200 { "ok": true, "db": "san-mes", "dbHealthy": true, "ts": "2026-…Z" }
```

`dbHealthy` is `false` if the inline `SELECT 1` throws — useful for the
admin status dashboard.

### `GET /v1/posts/:id` (Phase 1 — proof-of-concept read)

Read one post + its author profile via JOIN. Shape mirrors the
PostgREST embed `*, profiles:author_id (...)` so callers can swap
`supabase.from('posts').select(...)` for `fetch('/v1/posts/:id')`
without re-shaping.

```http
GET /v1/posts/00000000-0000-0000-0000-000000000000
→ 200 { "data": null, "error": null }            // empty DB

GET /v1/posts/<existing-uuid>
→ 200 { "data": {
    "id": "...",
    "author_id": "...",
    "content": "...",
    "image_url": "...|...",
    "likes_count": 0,
    "comments_count": 0,
    "shares_count": 0,
    "created_at": "2026-…Z",
    "profiles": { "id": "...", "username": "...", "display_name": "...",
                  "emoji": "...", "badge": null, "is_verified": false,
                  "links": null }
  }, "error": null }
```

### Forthcoming endpoints (Phase 2 sketch)

| Replaces | Method + path | Notes |
|---|---|---|
| `getPosts(limit, offset)` | `GET /v1/feed?limit=20&offset=0` | Adds the JOIN inside the SQL; returns the same row shape. |
| `getProfile(id)` | `GET /v1/profiles/:id` | Single row by id. |
| `getProfiles()` | `GET /v1/profiles?limit=50` | Discover list. |
| `getComments(postId)` | `GET /v1/posts/:postId/comments` | `ORDER BY created_at ASC`. |
| `getFollowers(userId)` | `GET /v1/profiles/:id/followers` | Two-step replaced by single query. |
| `getFollowing(userId)` | `GET /v1/profiles/:id/following` | Two-step replaced by single query. |
| `getFollowCounts(userId)` | `GET /v1/profiles/:id/follow-counts` | Two `COUNT(*)` in a single trip. |
| `getLikedPosts(userId)` | `GET /v1/profiles/:id/likes` | JOIN likes → posts → profiles. |
| `getUserComments(userId)` | `GET /v1/profiles/:id/comments` | JOIN comments → posts → profiles. |
| `getConversations(userId)` | `GET /v1/conversations` | Authed-only. |
| `getMessages(convId)` | `GET /v1/conversations/:id/messages` | Authed-only. |
| `mini_apps` list | `GET /v1/mini-apps` | Used by mini-app store. |

### Forthcoming write endpoints (Phase 3 sketch)

| Replaces | Method + path |
|---|---|
| `createPost` | `POST /v1/posts` |
| `deletePost` | `DELETE /v1/posts/:id` |
| `toggleLike` | `POST /v1/posts/:id/like` (idempotent toggle) |
| `createComment` | `POST /v1/posts/:id/comments` |
| `updateComment` | `PATCH /v1/comments/:id` |
| `deleteComment` | `DELETE /v1/comments/:id` |
| `followUser` / `unfollowUser` | `PUT/DELETE /v1/profiles/:id/follow` |
| `updateProfile` | `PATCH /v1/profiles/me` |
| `sendMessage` | `POST /v1/conversations/:id/messages` |
| `mini_apps` CRUD | `POST/PATCH/DELETE /v1/mini-apps[/:id]` |

## Auth flow

```
client                                  Worker                    Supabase JWKS
  │                                       │                            │
  │ Authorization: Bearer <jwt>           │                            │
  │ ────────────────────────────────────▶ │                            │
  │                                       │  fetch JWKS (cached 24h)   │
  │                                       │ ────────────────────────▶  │
  │                                       │ ◀──────────────────────── │
  │                                       │  jwtVerify(token, jwks)    │
  │                                       │  ─ issuer:                 │
  │                                       │     https://<ref>.supabase.co/auth/v1
  │                                       │  ─ audience: authenticated │
  │                                       │                            │
  │ { data, error }   authedUserId set    │                            │
  │ ◀──────────────────────────────────── │                            │
```

If the JWT is missing or invalid, `authedUserId` is `null` and read
endpoints serve anonymous content. Mutating endpoints check for
`authedUserId !== null` and return 401 otherwise (Phase 3).

JWKS caching uses `jose`'s built-in `cacheMaxAge` plus our own
`globalThis.__jwksCache` (cross-isolate-instance reuse on the same
isolate's lifetime). Worst case: cold isolate fetches JWKS once,
serving every request after that from memory.

## Dual-read / dual-write strategy

The cutover is staged so we can stop at any phase if regressions appear.

### Phase 2 — Read shadow

Reads are served from the Worker. Writes still flow through
`offlineQueue.ts` to Supabase. If the Worker fails (network, schema
mismatch), the client falls back to Supabase for that read. We add a
`useD1Reads` feature flag (default `true` in dev, `false` in prod
until validation completes) so we can flip prod incrementally.

### Phase 3 — Dual-write

Every successful Supabase write (returning `{ error: null }`) fires
a best-effort `POST /v1/...` to the Worker. The Worker write is
fire-and-forget — Supabase is still authoritative. The Worker logs
any 4xx / 5xx so we surface schema mismatches before cutover.

Idempotency: every Worker write accepts a `client-mutation-id`
header (the same ID `offlineQueue.generateTempId` already produces).
Repeated POSTs of the same mutation ID are no-ops on the second hit.

### Phase 4 — Data migration

Once Supabase egress unblocks (next billing reset, ~July 1):

1. From the Supabase dashboard SQL editor, export each table to CSV:
   ```sql
   COPY (SELECT * FROM profiles) TO STDOUT WITH CSV HEADER;
   ```
   The dashboard's "Export to CSV" button works without consuming the
   API egress quota — it streams from the database side.
2. A `workers/scripts/import.ts` Worker script reads the CSV, calls
   `INSERT OR IGNORE` per row (idempotent so we can replay on errors).
3. Any rows created in D1 between Phase 3 enable and the export
   timestamp are kept; Phase 3 ensured we have them. Any rows
   created post-cutover are D1-only and don't need a backfill.
4. We verify `COUNT(*)` parity between Supabase and D1 per table.

### Phase 5 — Cutover

A feature flag `dataLayer = 'd1' | 'supabase' | 'dual'` flips reads
and writes to D1 exclusively. Supabase becomes a read-only fallback
for two weeks (used only on D1 errors). After two weeks of clean
metrics, the Supabase code paths are removed.

### Phase 6 — Auth replacement (separate spec)

Out of scope for this spec. Auth has minimal egress (JWKS + login)
so it's a low-priority cleanup. Candidate replacements: Better-Auth
on Workers, or a self-hosted `jose`-based JWT issuer backed by D1.

## Schema mapping

See `workers/schema.sql` for the canonical DDL. Translation rules:

| Postgres | SQLite (D1) | Notes |
|---|---|---|
| `uuid` | `TEXT` | Generated by `crypto.randomUUID()` in the Worker. Length and hyphens preserved so old IDs round-trip without rewriting. |
| `timestamptz` | `TEXT (ISO-8601 with Z)` | Default `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`. The Worker's `INSERT` paths set `new Date().toISOString()` explicitly so client and server timestamps agree. |
| `boolean` | `INTEGER (0/1)` | `db.ts:asBool()` normalises on read. |
| `jsonb` | `TEXT` | `db.ts:asJson()` parses on read; `JSON.stringify` on write. |
| `serial` / `bigint` | (not used) | All tables UUID-keyed. |
| `FOREIGN KEY` | (omitted) | Worker enforces integrity. |
| RLS policies | (omitted) | Authorization in Worker handlers. |

Index choices follow every observed `WHERE` / `ORDER BY` / `IN`:
- `posts(author_id, created_at DESC)` covers feed and profile-posts.
- `comments(post_id, created_at)` covers thread render order.
- `comments(author_id, created_at DESC)` covers user-replies tab.
- `likes(post_id)` and `likes(user_id, created_at DESC)` cover
  notifications + liked-posts tab.
- `follows(follower_id, …)` and `follows(following_id, …)` cover
  follower / following lists symmetrically.
- `profiles(username)` UNIQUE — needed for the registration
  duplicate-key check.
- `profiles(device_key)` — `AccountSwitcher` lookup.

## Error semantics

- Successful read → `{ data: T, error: null }` 200.
- Empty read (no row) → `{ data: null, error: null }` 200. (Mirrors
  Supabase's `.single()` returning `null` data + `null` error when the
  row doesn't exist.)
- Validation failure → `{ data: null, error: '<reason>' }` 400.
- Unauthorised (Phase 3) → `{ data: null, error: 'unauthorised' }` 401.
- Forbidden (Phase 3) → `{ data: null, error: 'forbidden' }` 403.
- Unhandled exception → `{ data: null, error: '<message>' }` 500. Stack
  traces never leak to clients; the message is sanitised.

CORS is handled by `corsHeaders(req)` which reflects the request
origin if it matches the allow-list. Origins:

```
https://san-m-app.com
https://*.expo.dev
https://*.vercel.app
app://san-mes
capacitor://localhost
```

`OPTIONS` short-circuits at the top of the fetch handler with 204 +
CORS headers — no D1 query is wasted on preflight.

## Wrangler configuration

```toml
name = "san-mes-api"
main = "src/index.ts"
compatibility_date = "2025-12-01"
compatibility_flags = ["nodejs_compat"]
account_id = "8e0d53f0faad2f48870d0a570dadd03f"

[[d1_databases]]
binding = "DB"
database_name = "san-mes"
database_id = "62428750-5f61-4ed8-9bd9-51241ad95d16"

[vars]
SUPABASE_PROJECT_REF = "ycwadqglcykcpucembjn"

[observability]
enabled = true
```

`nodejs_compat` is set because `jose` imports `crypto` (Web Crypto is
available without it, but `jose`'s ESM build expects the Node-style
imports to resolve). `observability` gives us free metrics in the
Cloudflare dashboard for early Phase 2 debugging.

## Files added in Phase 1

| Path | Purpose |
|---|---|
| `workers/schema.sql` | DDL for D1, applied via `wrangler d1 execute`. |
| `workers/api/wrangler.toml` | Worker config, D1 binding, observability. |
| `workers/api/package.json` | Worker-only deps (`jose`, types, wrangler). |
| `workers/api/tsconfig.json` | Strict TS for the Worker. |
| `workers/api/src/index.ts` | Router, CORS, fetch handler, route table. |
| `workers/api/src/db.ts` | D1 prepared-statement wrapper, type normalisers. |
| `workers/api/src/auth.ts` | Supabase JWT verification via JWKS. |
| `workers/api/.gitignore` | `node_modules/`, `.dev.vars`, `.wrangler/`. |
| `.gitignore` | adds `workers/api/node_modules/`, `.dev.vars`, etc. |

## Phase 1.5 — egress reduction (separate commit)

Independently shippable client-side changes that don't depend on the
Worker. Goal: cut Supabase egress per cold-open by ~50–60 %.

1. **Followers / Following modal MMKV hydrate.** `FollowsListModal.tsx`
   reads from `@san:followers:<id>` / `@san:following:<id>` synchronously
   on mount, then refetches in the background. 24h TTL.
2. **Comments thread TTL guard.** `app/comments/[id].tsx` already
   caches via `kvSetJSON('comments:<postId>', data)`. Add a 5-minute
   TTL gate on the on-mount network refetch so rapid revisits don't
   spam.
3. **Smaller default page sizes.** Feed `limit(50)` → `limit(20)`,
   profile posts `limit(50)` → `limit(25)`. Pagination still works.
4. **Honour the `shouldSync` throttle on focus events.** `syncService`
   already uses `shouldSync`; ensure no path bypasses it.

These changes are in `app/(tabs)/index.tsx`, `app/(tabs)/profile.tsx`,
`app/profile/[id].tsx`, `app/comments/[id].tsx`, and
`src/components/profile/FollowsListModal.tsx`.

## Open questions

- **Custom domain routing.** `san-m-app.com` is on Vercel today; there
  are no Cloudflare Pages projects. Phase 1 uses the workers.dev URL.
  Phase 2 will decide between (a) DNS-only proxying through Cloudflare
  with a Worker route on `san-m-app.com/d1/*`, (b) moving the marketing
  page off Vercel onto Pages, or (c) keeping the workers.dev subdomain
  and hard-coding it in the app. Decision deferred until Phase 2.
- **Bulk import script shape.** Pure SQL `INSERT OR IGNORE` works for
  small tables; for `messages` (potentially millions of rows) we may
  want `wrangler d1 execute --file` with chunked batches. Phase 4
  will decide once we see the actual row counts.
