// Mini-apps endpoints.
//
// `GET /v1/mini-apps?limit=50` — list all, newest first. Mirrors the
//                                existing `miniAppsStore.loadApps()`
//                                shape (no embed; stores fetch the
//                                creator profile separately).
// `GET /v1/mini-apps/:id`       — single mini-app with creator profile
//                                embedded. Used by the share-link
//                                landing screen and the `/m/:short`
//                                redirect renderer.

import { fail, ok } from '../http';
import { register } from '../router';
import { normalizeProfile, query, queryOne } from '../db';
import { parseLimit, parseUuid } from '../util';

// ── GET /v1/mini-apps ──────────────────────────────────────────────────
register('GET', '/v1/mini-apps', async (req, env) => {
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get('limit'), 100, 50);
  const rows = await query<{
    id: string;
    creator_id: string;
    name: string;
    description: string;
    emoji: string;
    url: string;
    created_at: string;
  }>(
    env,
    `SELECT id, creator_id, name, description, emoji, url, created_at
       FROM mini_apps
   ORDER BY created_at DESC
      LIMIT ?`,
    [limit],
  );
  return ok(req, rows);
});

// ── GET /v1/mini-apps/:id ──────────────────────────────────────────────
//
// Embeds the creator profile so the share-landing screen can render
// "made by @user" without a follow-up trip. Empty match → 200 + null.
register('GET', '/v1/mini-apps/:id', async (req, env, _ctx, params) => {
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid mini-app id', 400);

  interface Row {
    id: string;
    creator_id: string;
    name: string;
    description: string;
    emoji: string;
    url: string;
    created_at: string;
    profile_id: string | null;
    profile_username: string | null;
    profile_display_name: string | null;
    profile_emoji: string | null;
    profile_badge: string | null;
    profile_is_verified: number | null;
  }
  const row = await queryOne<Row>(
    env,
    `SELECT m.id,
            m.creator_id,
            m.name,
            m.description,
            m.emoji,
            m.url,
            m.created_at,
            pr.id            AS profile_id,
            pr.username      AS profile_username,
            pr.display_name  AS profile_display_name,
            pr.emoji         AS profile_emoji,
            pr.badge         AS profile_badge,
            pr.is_verified   AS profile_is_verified
       FROM mini_apps m
  LEFT JOIN profiles pr ON pr.id = m.creator_id
      WHERE m.id = ?
      LIMIT 1`,
    [id],
  );
  if (!row) return ok(req, null);
  return ok(req, {
    id: row.id,
    creator_id: row.creator_id,
    name: row.name,
    description: row.description,
    emoji: row.emoji,
    url: row.url,
    created_at: row.created_at,
    profiles: row.profile_id
      ? normalizeProfile({
          id: row.profile_id,
          username: row.profile_username,
          display_name: row.profile_display_name,
          emoji: row.profile_emoji,
          badge: row.profile_badge,
          is_verified: row.profile_is_verified,
          links: null,
        })
      : null,
  });
});
