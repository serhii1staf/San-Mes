// Moderation service — thin client wrapper around the san-mes Worker's
// moderation endpoints (report + block).
//
// Every function here is intentionally GUARDED: moderation calls are
// best-effort, fire-and-forget friendly side effects that must never
// throw into (or block) the optimistic UI. Reporting a post, blocking a
// user, etc. update local state instantly; this layer mirrors that to
// the server and silently swallows any transport failure (offline,
// timeout, 4xx/5xx). Callers can branch on the small structured results
// where useful (`submitReport` → `{ ok }`, `fetchBlockedIds` → `string[]`)
// but never have to wrap calls in their own try/catch.
//
// Backend contract (Worker):
//   POST   /v1/reports          { targetType, targetId, category, reason? }
//   POST   /v1/blocks           { blockedId }
//   DELETE /v1/blocks/:id
//   GET    /v1/blocks           → string[] of blocked user ids
//
// Apple compliance note: report + block are App Review Guideline 1.2
// requirements for user-generated content. This module is the network
// half of those flows — keep it wired.

import { apiGet, apiPost, apiDelete } from './apiClient';

/**
 * The kinds of entities a user can report. Other agents depend on this
 * exact union — keep the member names stable.
 */
export type ReportTargetType = 'post' | 'comment' | 'profile' | 'mini_app' | 'message';

/**
 * Submit a content/user report to the Worker. Fire-and-forget friendly:
 * never throws, returns `{ ok }` reflecting whether the server accepted
 * it (`ok: false` on any error, including offline).
 */
export async function submitReport(params: {
  targetType: ReportTargetType;
  targetId: string;
  category: string;
  reason?: string;
}): Promise<{ ok: boolean }> {
  try {
    const { error } = await apiPost('/v1/reports', params);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/**
 * Mirror a block to the server. Guarded — never throws. The local
 * blocked-users store is the source of truth for the UI; this just
 * keeps the server copy in sync.
 */
export async function blockUserRemote(blockedId: string): Promise<void> {
  try {
    await apiPost('/v1/blocks', { blockedId });
  } catch {
    // best-effort
  }
}

/**
 * Mirror an unblock to the server. Guarded — never throws.
 */
export async function unblockUserRemote(blockedId: string): Promise<void> {
  try {
    await apiDelete('/v1/blocks/' + encodeURIComponent(blockedId));
  } catch {
    // best-effort
  }
}

/**
 * Fetch the server's authoritative list of blocked user ids. Guarded —
 * returns `[]` on any error (offline, timeout, malformed body) so callers
 * can safely union it into local state.
 */
export async function fetchBlockedIds(): Promise<string[]> {
  try {
    const { data } = await apiGet<string[]>('/v1/blocks');
    return data || [];
  } catch {
    return [];
  }
}
