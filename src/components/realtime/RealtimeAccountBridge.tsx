import { useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useEntityStore } from '../../services/entityStore';
import { useChatStore } from '../../store/chatStore';
import { useFeedStore } from '../../store/feedStore';
import { useNotificationsBadge } from '../../store/notificationsBadgeStore';
import {
  feedPublicChannelName,
  getRealtime,
  userFollowsChannelName,
  userNotificationsChannelName,
  userProfileChannelName,
} from '../../services/realtime/ably';
import { isRepost, parseImageUrls, isImageSpoiler } from '../../lib/supabase';
import type { Post } from '../../types';

// App-wide realtime bridge.
//
// Mounts once when the user is authenticated, opens a single Ably
// connection, and subscribes to a small set of channels:
//
//   - `user:<myId>:notifications`  — incoming pings: new conversations,
//                                    likes, comments, follows, message
//                                    previews. Drives the bell + msg
//                                    tab badges.
//   - `user:<myId>:profile`        — bio / display name / banner edits
//                                    made on another device land here so
//                                    every signed-in surface stays
//                                    consistent.
//   - `user:<myId>:follows`        — follow graph events on both
//                                    directions: incoming `follow.added`
//                                    / `follow.removed`, and the user's
//                                    own `follow.outgoing.*` events so
//                                    multi-device sessions never drift.
//   - `feed:public`                — global firehose of new / edited /
//                                    deleted posts. We dedupe by id and
//                                    skip events authored by the current
//                                    user (already added locally).
//
// All of this runs effects-only (no rendered output). The bridge sits
// inside AuthNavigationGuard so it only mounts while the user is signed
// in, and the cached connection is released by `disconnectRealtime()`
// from `switchAccount` on logout / account switch.
export function RealtimeAccountBridge(): null {
  const userId = useAuthStore((s) => s.user?.id || null);

  useEffect(() => {
    if (!userId) return;
    // Defer the Ably client construction + channel.subscribes past the
    // current RAF so the cold-open critical path (app shell paint →
    // first tab render) is never competing with the WebSocket
    // handshake that `new Ably.Realtime(...)` kicks off. The bridge
    // mounts inside AuthNavigationGuard at app shell, which lands on
    // the same frame as the (tabs)/index commit on a cold open —
    // without this defer the auth-callback fetch
    // (`POST /api/ably-token`) and the subsequent socket open both
    // fire inline with the first tab's mount, and the WebSocket setup
    // steals UI thread time from the navigation transition into
    // whichever tab the user taps next. 0 ms timeout (macrotask) is
    // enough to push past the current commit + RAF; the user can't
    // perceive a 0–16 ms delay before realtime starts listening, but
    // they do feel the cold-open freeze if it doesn't.
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    const timer = setTimeout(() => {
      if (cancelled) return;
      const realtime = getRealtime();
      if (!realtime) return; // No deviceKey or auth not ready — degrade silently.

      // ─── notifications ─────────────────────────────────────────────
      // Existing flow: new conversation rows + new-message previews.
      // We tack `notif.like` / `notif.comment` / `notif.follow` /
      // `notif.message` onto the same channel so a fresh device picks
      // up activity hints without subscribing to anything else.
      const notifChannel = realtime.channels.get(userNotificationsChannelName(userId));

      const onNotif = (msg: { name?: string; data?: any }) => {
        const payload = msg?.data;
        if (!payload || typeof payload !== 'object') return;
        const name = msg.name || '';

        // ── Incoming message ping ──────────────────────────────────────
        // Canonical path: the Worker's `POST /v1/conversations/:id/messages`
        // publishes `notif.message` with snake_case fields
        // (`conversation_id`, `sender_id`, `preview`, `ts`). We also keep
        // backward-compat with the legacy client-side `new_message` /
        // `new_conversation` publishes (camelCase `conversationId` + an
        // embedded `message` object).
        if (name === 'new_conversation' || name === 'new_message' || name === 'notif.message') {
          const conversationId = String(
            payload.conversationId || payload.conversation_id || '',
          );
          if (!conversationId) return;
          const senderId = String(payload.senderId || payload.sender_id || '');

          // 1) Upsert the conversation row in the entity store so the
          //    messages tab shows it immediately. Dedupe by conversation id
          //    OR participant id — never two rows for the same peer.
          try {
            const store = useEntityStore.getState();
            const existing = store.conversations || [];
            const idx = existing.findIndex(
              (c: any) =>
                c.id === conversationId ||
                (senderId && c.participantId === senderId),
            );
            const lastMessage = String(
              payload.lastMessage || payload.preview || '',
            );
            const lastMessageAt = String(
              payload.lastMessageAt || payload.ts || new Date().toISOString(),
            );
            const nextRow = {
              id: conversationId,
              participantId: senderId,
              participantName: String(payload.senderName || ''),
              participantUsername: String(payload.senderUsername || ''),
              participantEmoji: String(payload.senderEmoji || '😊'),
              lastMessage,
              lastMessageAt,
            };
            if (idx >= 0) {
              const merged = [...existing];
              merged[idx] = { ...existing[idx], ...nextRow };
              store.setConversations(merged);
            } else {
              store.setConversations([nextRow, ...existing]);
            }
          } catch {}

          // 2) Drop the previewed message into this conversation's chat
          //    store so it's already on screen when the user opens the
          //    chat — no spinner, no fetch round-trip.
          try {
            const chatStore = useChatStore.getState();
            const existing = chatStore.messages[conversationId] || [];

            // Legacy rich payload carries a full `message` object; the
            // Worker carries only a trimmed `preview` string. Build a
            // ChatMessage either way, tagging the sender as 'peer' so the
            // bubble aligns left.
            const rich = payload.message && payload.message.id ? payload.message : null;
            const ts = String(payload.ts || rich?.createdAt || new Date().toISOString());
            // Stable id derived from conversation + ts so a later full
            // history load (real DB ids) doesn't duplicate this preview,
            // and so a redelivered ping is a no-op.
            const stableId = rich?.id ? String(rich.id) : `peer-${conversationId}-${ts}`;
            const previewText = String(rich?.text ?? payload.preview ?? '');

            // Parse the in-app image marker (`::img::url1|url2::text`) the
            // chat screen uses, so an image preview shows the thumbnail
            // instead of the raw marker text.
            let text = previewText;
            let imageUrls: string[] | undefined = Array.isArray(rich?.imageUrls)
              ? rich.imageUrls
              : undefined;
            if (!imageUrls && previewText.startsWith('::img::')) {
              const end = previewText.indexOf('::', 7);
              if (end !== -1) {
                const urls = previewText.slice(7, end).split('|').filter(Boolean);
                if (urls.length) imageUrls = urls;
                text = previewText.slice(end + 2);
              }
            }

            if (!existing.some((m: any) => m.id === stableId)) {
              chatStore.addMessage(conversationId, {
                id: stableId,
                conversationId,
                senderId: 'peer',
                text,
                createdAt: ts,
                isRead: false,
                imageUrls,
              } as any);
            }
          } catch {}

          // 3) Bump the unread notifications badge so the bell updates
          //    live even when the recipient isn't on the messages tab.
          try { useNotificationsBadge.getState().increment(1); } catch {}
          return;
        }

        // ── Activity pings (like / comment / follow) ───────────────────
        // The Worker publishes these from posts.ts / follows.ts. The
        // per-screen subscriptions (post:<id>, user:<id>:follows) carry the
        // actual state deltas; here we only bump the bell badge so it
        // updates live.
        if (name === 'notif.like' || name === 'notif.comment' || name === 'notif.follow') {
          try { useNotificationsBadge.getState().increment(1); } catch {}
        }
      };

      void notifChannel.subscribe(onNotif);
      cleanups.push(() => {
        try { notifChannel.unsubscribe(onNotif); } catch {}
      });

      // ─── profile edits (own user, multi-device sync) ────────────────
      const profileChannel = realtime.channels.get(userProfileChannelName(userId));
      const onProfile = (msg: { name?: string; data?: any }) => {
        const payload = msg?.data;
        if (msg.name !== 'profile.edit' || !payload || typeof payload !== 'object') return;

        // Map the Worker's snake_case delta to the auth store's
        // camelCase shape. We only touch fields actually present on
        // the payload so a banner edit doesn't blank the bio.
        try {
          const updates: Record<string, unknown> = {};
          if ('display_name' in payload) updates.displayName = payload.display_name;
          if ('emoji' in payload) updates.emoji = payload.emoji;
          if ('bio' in payload) updates.bio = payload.bio;
          if ('banner_url' in payload) updates.bannerUrl = payload.banner_url;
          if ('badge' in payload) updates.badge = payload.badge;
          if ('is_verified' in payload) updates.is_verified = !!payload.is_verified;
          if ('username' in payload) updates.username = payload.username;
          if ('links' in payload) updates.links = payload.links;
          if (Object.keys(updates).length > 0) {
            useAuthStore.getState().updateProfile(updates as any);
          }
        } catch {}

        // Mirror into the entity store so any avatar / username that
        // renders from the cached profile (post cards, comments)
        // updates without a refetch.
        try {
          const entity = useEntityStore.getState();
          const existing = entity.profiles[userId];
          if (existing) {
            const merged = {
              ...existing,
              display_name: payload.display_name ?? existing.display_name,
              username: payload.username ?? existing.username,
              emoji: payload.emoji ?? existing.emoji,
              bio: payload.bio ?? existing.bio,
              banner_url: payload.banner_url ?? existing.banner_url,
              badge: payload.badge ?? existing.badge,
              is_verified:
                'is_verified' in payload ? !!payload.is_verified : existing.is_verified,
            };
            entity.upsertProfile(merged as any);
          }
        } catch {}
      };
      void profileChannel.subscribe(onProfile);
      cleanups.push(() => {
        try { profileChannel.unsubscribe(onProfile); } catch {}
      });

      // ─── follow events (incoming + outgoing) ────────────────────────
      const followsChannel = realtime.channels.get(userFollowsChannelName(userId));
      const onFollow = (msg: { name?: string; data?: any }) => {
        const payload = msg?.data;
        if (!payload || typeof payload !== 'object') return;
        const followerId = String(payload.follower_id || '');
        const followingId = String(payload.following_id || '');
        if (!followerId || !followingId) return;

        try {
          const entity = useEntityStore.getState();
          if (msg.name === 'follow.added' || msg.name === 'follow.outgoing.added') {
            entity.setFollow(followerId, followingId);
          } else if (msg.name === 'follow.removed' || msg.name === 'follow.outgoing.removed') {
            entity.removeFollow(followerId, followingId);
          }
        } catch {}
      };
      void followsChannel.subscribe(onFollow);
      cleanups.push(() => {
        try { followsChannel.unsubscribe(onFollow); } catch {}
      });

      // ─── public feed firehose ───────────────────────────────────────
      // Hot — gets every public-feed event in the world. We bound
      // memory two ways:
      //   1) Skip self-authored events; the local optimistic path
      //      already added them.
      //   2) Only insert into stores when the feed cache is hot
      //      (entity store has been hydrated). Otherwise drop silently
      //      so a fresh device doesn't accumulate orphaned posts in
      //      memory.
      const feedChannel = realtime.channels.get(feedPublicChannelName());
      const onFeed = (msg: { name?: string; data?: any }) => {
        const payload = msg?.data;
        if (!payload || typeof payload !== 'object') return;

        if (msg.name === 'post.new') {
          const post = payload.post;
          if (!post || typeof post !== 'object') return;
          // Skip self — local optimistic add already covers it. We use
          // either the wrapped `author_id` or the embedded profile id
          // since the Worker shape varies slightly between create and
          // repost paths.
          const authorId = post.author_id || post.profiles?.id;
          if (authorId === userId) return;
          try {
            const entity = useEntityStore.getState();
            if (!entity.isHydrated) return;
            // Upsert author profile + post. `upsertPost` is a no-op
            // if we already have it (e.g. the message was redelivered).
            if (post.profiles && typeof post.profiles === 'object') {
              entity.upsertProfile(post.profiles as any);
            }
            entity.upsertPost(post as any);
            // Prepend the new id so it appears at the top of any
            // surface that reads from `getFeedPosts`.
            const ids = entity.feedIds;
            if (!ids.includes(post.id)) {
              entity.setFeedIds([post.id, ...ids].slice(0, 200));
            }

            // The home tab keeps its own `Post[]`-shaped state in the
            // feed store for compatibility with the local optimistic
            // add flow. Map the Worker's snake_case shape to the
            // app's Post shape and prepend so the UI updates without
            // a refetch.
            const mapped = mapWorkerPostToAppPost(post);
            if (mapped) {
              const feedState = useFeedStore.getState();
              if (!feedState.posts.some((p) => p.id === mapped.id)) {
                feedState.addPost(mapped);
              }
            }
          } catch {}
        } else if (msg.name === 'post.delete') {
          const id = String(payload.id || '');
          if (!id) return;
          try {
            useEntityStore.getState().removePost(id);
            useFeedStore.getState().removePost(id);
          } catch {}
        } else if (msg.name === 'post.edit') {
          const id = String(payload.id || '');
          if (!id) return;
          try {
            const entity = useEntityStore.getState();
            const existing = entity.posts[id];
            if (existing) {
              entity.upsertPost({
                ...existing,
                content: typeof payload.content === 'string' ? payload.content : existing.content,
                image_url:
                  payload.image_url === undefined
                    ? existing.image_url
                    : payload.image_url,
              } as any);
            }
            // Local optimistic mirror — only patch the fields the user
            // would notice change; preserve like / comment counts.
            const feedState = useFeedStore.getState();
            const partial: Partial<Post> = {};
            if (typeof payload.content === 'string') partial.content = payload.content;
            if (payload.image_url !== undefined) {
              partial.imageUrl = payload.image_url || undefined;
              partial.imageUrls = payload.image_url
                ? parseImageUrls(payload.image_url)
                : undefined;
              partial.isSpoilerImage = payload.image_url
                ? isImageSpoiler(payload.image_url)
                : false;
            }
            if (Object.keys(partial).length > 0) {
              feedState.updatePost(id, partial);
            }
          } catch {}
        }
      };
      void feedChannel.subscribe(onFeed);
      cleanups.push(() => {
        try { feedChannel.unsubscribe(onFeed); } catch {}
      });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const fn of cleanups) fn();
    };
  }, [userId]);

  return null;
}

// ─── helpers ─────────────────────────────────────────────────────────────

/**
 * Map a Worker-shaped post (snake_case + embedded profiles row) to the
 * camelCase `Post` shape the home-tab feed store consumes. Returns null
 * for malformed payloads so a corrupt realtime message can never crash
 * the bridge.
 */
function mapWorkerPostToAppPost(p: any): Post | null {
  if (!p || typeof p !== 'object' || !p.id) return null;
  const repostInfo = isRepost(p.content || '');
  const parsedImages = parseImageUrls(p.image_url);
  const spoiler = isImageSpoiler(p.image_url);
  const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
  const post: Post = {
    id: String(p.id),
    authorId: String(p.author_id || profile?.id || ''),
    authorName: profile?.display_name || 'User',
    authorUsername: profile?.username || 'user',
    authorEmoji: profile?.emoji || '😊',
    authorBadge: profile?.badge || undefined,
    authorVerified: !!profile?.is_verified,
    content: repostInfo.isRepost ? (repostInfo.comment || '') : (p.content || ''),
    imageUrl: parsedImages[0] || undefined,
    imageUrls: parsedImages.length > 0 ? parsedImages : undefined,
    isSpoilerImage: spoiler,
    likesCount: p.likes_count || 0,
    commentsCount: p.comments_count || 0,
    sharesCount: p.shares_count || 0,
    isLiked: false,
    isBookmarked: false,
    createdAt: String(p.created_at || new Date().toISOString()),
    isRepost: repostInfo.isRepost,
  };
  if (!post.content && !post.imageUrl && !post.isRepost) return null;
  return post;
}
