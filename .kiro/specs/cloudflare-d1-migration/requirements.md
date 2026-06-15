# Cloudflare D1 migration — Requirements

## Background

Supabase (Postgres + Storage + Auth) has been the data layer since launch.
On 2026-06-14 the project hit Supabase Free's egress quota and was
HTTP-402 hard-locked. Recovery requires either paying for Pro (declined)
or waiting for the next billing reset. The user has authorised migrating
the data layer to Cloudflare D1 (SQLite) so we own the egress story going
forward.

R2 is already used for media (`san`, `san-uploads` buckets) and stays —
egress from R2 is free, so the media path is already cheap.

## Goals

1. **Eliminate single-vendor egress lock-in.** Cloudflare D1's free tier
   has no egress limit, only a daily-row-read cap. Even after we exceed
   the row cap, the failure mode is rate-limiting, not a hard 402.
2. **Stand up the foundation for a phased migration** so Supabase stays
   the source of truth until D1 has been validated and data has been
   exported. Reads land first, then writes, then a flag-flipped cutover.
3. **Reduce per-request egress today** so the 402 lifts faster after the
   billing reset and so any future provider-bound traffic stays light.

## Non-goals (Phase 1)

- Replacing Supabase Auth. Auth flows still use Supabase JWT issuance;
  the new Worker only verifies those JWTs. Auth replacement is its own
  spec (see Phase 6 in `tasks.md`).
- Replacing Supabase Storage for media. Media already lives in R2.
- Real-time subscriptions. The chat realtime path uses Ably and
  Supabase realtime channels — neither moves in Phase 1.
- Decommissioning Supabase. Supabase remains a fallback until the
  cutover phase succeeds and observability shows no regressions for at
  least two weeks.

## User-visible success criteria

When Phase 1 ships, an end user sees no behaviour change. The new
Worker is purely additive — it answers `/v1/health` and one read
endpoint and is not yet wired into the app. The user notices Phase 1
indirectly through the egress reduction (Phase 1.5):

1. **Followers / Following modal opens instantly** even on a cold
   network because the cached list paints first.
2. **Comments thread re-opens instantly** when the user revisits a
   post within the 5-minute TTL window — no spinner, no network burst.
3. **The home feed paints faster** because the first network query
   asks for 20 posts instead of 50, cutting cold-open egress by ~60 %
   on the most expensive screen.

## Engineering success criteria (Phase 1 acceptance)

- A D1 database `san-mes` exists with all 9 reverse-engineered tables.
- A Worker at `https://san-mes-api.odi44972.workers.dev` answers:
  - `GET /v1/health` → `{ ok: true, db: 'san-mes', dbHealthy: true, ts }`
  - `GET /v1/posts/:id` → `{ data: post|null, error: null }`
- JWT verification works against Supabase's JWKS without a shared
  secret committed to the Worker.
- CORS preflight responds correctly to all known app origins.
- No client-side code is changed to depend on the Worker yet.
- Egress reduction commit (Phase 1.5) is independently shippable and
  doesn't change any data shape.

## Constraints

### Technical

- D1 is SQLite-on-disk-replicated; some Postgres features don't exist:
  - No `uuid` type → text columns + `crypto.randomUUID()` in the Worker.
  - No `timestamptz` → ISO-8601 text. We use the JS Date stringifier on
    write so the format always carries a `Z` suffix.
  - No `boolean` → `INTEGER 0/1`, normalised in the Worker `db.ts`.
  - No `jsonb` → text. We `JSON.stringify` on write, `JSON.parse` on read.
  - No row-level security → authorization happens in Worker handlers.
  - No PostgREST embed syntax (`profiles:author_id (...)`) → handlers
    do explicit JOINs and shape the response to match the embed shape
    so existing app callers don't have to change.
- Foreign-key constraints are deliberately omitted. They make migrations
  brittle and Supabase-side broken FKs are exactly what's bitten us
  (see `services/follow.ts` comments). The Worker enforces integrity.

### Operational

- Wrangler 4.63 (4.100 on first deploy) authenticated via OAuth as
  `odi44972@gmail.com`. Account ID `8e0d53f0faad2f48870d0a570dadd03f`.
- D1 database ID `62428750-5f61-4ed8-9bd9-51241ad95d16`. Region EEUR
  (closest to most users in Russia / Europe).
- R2 buckets `san` and `san-uploads` are already configured and
  preserved; this spec does not touch storage.
- The OTA workflow uses `npm install --no-audit --no-fund --omit=optional`
  on the root `package.json`. Worker deps live in `workers/api/package.json`
  — they MUST NOT leak into the root install graph or the OTA pipeline
  pulls extra MB into the bundle.

### Apple compliance

- ATS: every Worker URL is HTTPS; no exception domains needed.
- No new permissions requested. No `Info.plist` changes.
- The Worker logs structured request data only. We do NOT log JWT
  payloads, `Authorization` headers, or any PII. (See `index.ts`.)
- App Store privacy nutrition: data flows are unchanged at user-visible
  level — same data is collected, just routed via Cloudflare. The
  privacy policy URL doesn't need a new disclosure for Phase 1, but
  cutover-phase will mention "data hosted on Cloudflare D1".

## Reverse-engineered Supabase schema

The 9 tables exercised by `supabase.from(...)` calls across the codebase:

| Table | Source files (representative) | Columns observed |
|---|---|---|
| `profiles` | `src/lib/supabase.ts`, `services/aiService.ts`, `components/ui/AccountSwitcher.tsx`, `app/settings/admin.tsx` | id, username, display_name, emoji, bio, pin_hash, device_key, banner_url, links (jsonb), badge, is_verified, created_at, updated_at |
| `posts` | `src/lib/supabase.ts`, `app/(tabs)/index.tsx`, `app/profile/[id].tsx`, `app/settings/admin.tsx` | id, author_id, content, image_url, likes_count, comments_count, shares_count, created_at |
| `comments` | `src/lib/supabase.ts`, `app/comments/[id].tsx`, `app/notifications.tsx` | id, post_id, author_id, content, created_at |
| `likes` | `src/lib/supabase.ts`, `services/syncService.ts`, `app/notifications.tsx` | user_id, post_id, created_at (composite PK) |
| `follows` | `src/lib/supabase.ts`, `services/follow.ts`, `services/syncService.ts` | follower_id, following_id, created_at (composite PK) |
| `mini_apps` | `src/store/miniAppsStore.ts`, `components/ui/MiniAppPreviewCard.tsx`, `app/mini/[id].tsx`, `app/m/[short].tsx` | id, creator_id, name, description, emoji, url, created_at |
| `conversations` | `src/lib/supabase.ts`, `app/chat/[id].tsx` | id, created_at |
| `conversation_participants` | `src/lib/supabase.ts`, `app/chat/[id].tsx` | conversation_id, user_id (composite PK) |
| `messages` | `src/lib/supabase.ts`, `app/chat/[id].tsx` | id, conversation_id, sender_id, text, created_at |

The full DDL with indexes is in `workers/schema.sql`.

## Gaps from the reverse-engineering (verify when Supabase unblocks)

The following can't be inferred with full confidence from the codebase
and must be verified against the live Supabase schema once egress
unblocks:

1. **`profiles.pin_hash` nullability.** The codebase always writes a
   non-null hash on register, but admin-created accounts (or accounts
   that pre-date the PIN feature) may have `NULL` pin_hash rows in
   prod. The schema models it as nullable to be safe.
2. **`profiles.username` uniqueness.** Inferred from the duplicate-key
   error branch in `registerUser`. We applied a UNIQUE index. If the
   live schema only has a non-unique index the migration will be a
   no-op; if there are duplicate rows in prod the import script will
   need to dedupe them.
3. **`profiles.created_at` / `updated_at` defaults.** The live schema
   likely has `now()` server defaults; we use SQLite's
   `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` to emit ISO-Z strings. The
   format matches what JS `new Date().toISOString()` produces, so app
   parsing is unaffected.
4. **`comments.id` type.** Likely `uuid DEFAULT gen_random_uuid()` in
   Postgres. We model it as TEXT and let the Worker generate IDs. No
   reads project the raw column shape from the client beyond the ID
   itself, so this is safe.
5. **Unknown columns added by features that weren't in scope.** If
   the live schema includes columns the codebase never touches (e.g.
   experimental moderation flags, A/B test buckets), we'll learn about
   them only when we export the data. The data-migration script will
   tolerate unknown columns by ignoring them.
6. **No dedicated `notifications`, `reports`, `blocked_users`, or
   `push_tokens` table.** The notifications screen synthesises from
   `likes` + `comments` + `follows`. Reports are sent via a toast,
   not persisted. Blocked users are MMKV-only. Push tokens haven't
   been wired up. None of these need a D1 table in Phase 1.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| D1 daily row-read limit hits during peak | medium | Move read traffic onto Worker reads after Phase 2 to track usage; aggressive client-side caching reduces queries. |
| Supabase data export blocked by 402 | high | Start porting reads first so app keeps working off Supabase reads; once billing resets, run the export script and replay any post-cutover writes. |
| JWKS endpoint unreachable from Worker | low | `jose` caches JWKS; module-level cache survives across requests within an isolate; on 401 the client falls through to anonymous. |
| Schema mismatch when data lands | medium | Phase 3 dual-write surfaces mismatches before cutover; the Worker rejects unknown columns with a 400 in Phase 3 so we catch shape drift early. |
| OTA install graph pollution | low | Worker package.json is its own root; root `npm install` ignores `workers/api/`. CI builds verify this stays true. |
