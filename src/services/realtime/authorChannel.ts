/**
 * Live updates for the profile on screen: that person's posts appearing, changing or disappearing,
 * and their profile edits (name, bio, banner, links, ...).
 *
 * Reported: "she published, and it showed up for me two minutes later", and "the description is
 * not real time". The Worker publishes to `post:author:<id>` when a post is created, edited or
 * deleted and when the profile is edited (`channels.author` in workers/api/src/realtime.ts). This
 * subscribes while the profile is on screen, and only then.
 *
 * Cost, kept low on purpose:
 *   - No polling. Nothing is requested while nothing changes.
 *   - A profile edit carries the changed fields, which are written straight into the entity store
 *     the profile renders from: no request at all.
 *   - A post event carries only the post id and refetches that profile's first page once, the same
 *     request opening the profile makes.
 *   - The channel is detached when the last screen showing that profile goes away.
 */
import { useEffect } from 'react';
import { authorChannelName, getRealtime } from './ably';
import { leaseChannel } from './channelLease';
import { invalidateProfilePosts } from '../profilePosts';
import { useEntityStore } from '../entityStore';
import { toSceneText } from '../syncService';

function applyProfileEdit(profileId: string, payload: Record<string, unknown>): void {
  const entity = useEntityStore.getState();
  const existing: any = entity.profiles[profileId];
  // Nothing cached means nothing on screen is rendering this profile from the store yet; the
  // screen's own fetch will bring the new values.
  if (!existing) return;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(payload, k);
  const merged: any = { ...existing };
  if (has('display_name')) merged.display_name = payload.display_name;
  if (has('username')) merged.username = payload.username;
  if (has('emoji')) merged.emoji = payload.emoji;
  if (has('bio')) merged.bio = payload.bio ?? '';
  if (has('banner_url')) merged.banner_url = payload.banner_url ?? null;
  if (has('theme_id')) merged.theme_id = payload.theme_id ?? null;
  if (has('badge')) merged.badge = payload.badge ?? null;
  if (has('is_verified')) merged.is_verified = !!payload.is_verified;
  if (has('screenshots_disabled')) merged.screenshots_disabled = !!payload.screenshots_disabled;
  // Stored the way the profile screen stores a fetched profile: links as a JSON string, the
  // header scene as text.
  if (has('links')) merged.links = payload.links == null ? null : JSON.stringify(payload.links);
  if (has('header_scene')) merged.header_scene = toSceneText(payload.header_scene);
  if (has('updated_at')) merged.updated_at = payload.updated_at ?? existing.updated_at;
  entity.upsertProfile(merged);
}

/**
 * Subscribe to `profileId`'s author channel while `active` (the profile is focused). Not for your
 * own profile: your edits already update your own copy, and your posts invalidate it directly.
 */
export function useAuthorChannel(profileId: string | undefined, active: boolean): void {
  useEffect(() => {
    if (!profileId || !active) return;
    const realtime = getRealtime();
    if (!realtime) return;
    // Counted per channel, so a stacked copy of the same profile keeps it attached; detached
    // shortly after the last one goes (channelLease.ts).
    const lease = leaseChannel(realtime, authorChannelName(profileId));
    const channel = lease.channel;
    const onMessage = (msg: { name?: string; data?: any }) => {
      try {
        if (msg?.name === 'author.profile.edit') {
          if (msg.data && typeof msg.data === 'object') applyProfileEdit(profileId, msg.data);
          return;
        }
        if (msg?.name === 'author.post.new' || msg?.name === 'author.post.edit' || msg?.name === 'author.post.delete') {
          invalidateProfilePosts(profileId);
        }
      } catch {
        // A live update that cannot be applied leaves the screen as it was; opening it again refetches.
      }
    };
    void channel.subscribe(onMessage);
    return () => {
      try { channel.unsubscribe(onMessage); } catch {}
      lease.release();
    };
  }, [profileId, active]);
}
