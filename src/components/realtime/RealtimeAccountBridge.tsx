import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { useEntityStore } from '../../services/entityStore';
import { useChatStore } from '../../store/chatStore';
import { useFeedStore } from '../../store/feedStore';
import { useNotificationsBadge } from '../../store/notificationsBadgeStore';
import { useChatUnread } from '../../store/chatUnreadStore';
import {
  feedPublicChannelName,
  getRealtime,
  disconnectRealtime,
  userFollowsChannelName,
  userNotificationsChannelName,
  userProfileChannelName,
} from '../../services/realtime/ably';
import { isRepost, parseImageUrls, isImageSpoiler } from '../../lib/supabase';
import { isActiveThread } from '../../services/activeThread';
import { useInAppAlert } from '../../store/inAppAlertStore';
import { isAlertCategoryEnabled } from '../../store/settingsStore';
import type { Post } from '../../types';

/**
 * Is this URL an animated image, so the alert can say "sent you a GIF" rather than "a photo"?
 *
 * Deliberately a local copy rather than an import. The equivalent helper lives inside
 * `app/chat/[id].tsx` as a module-private function, and importing from a screen into a shared component
 * would invert the dependency direction — components must not depend on routes. It is two host checks and
 * an extension test; duplicating that is cheaper than the coupling, and this copy only has to be good
 * enough to choose one word in an ambient alert.
 */
function looksAnimated(u: string): boolean {
  try {
    const s = u.toLowerCase();
    return s.includes('.gif') || s.includes('giphy.com') || s.includes('tenor.com');
  } catch {
    return false;
  }
}

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
    let activeCleanups: Array<() => void> = [];
    let bgTimer: ReturnType<typeof setTimeout> | null = null;
    let deferTimer: ReturnType<typeof setTimeout> | null = null;

    // Tear down any live channel subscriptions. Safe to call repeatedly;
    // it always leaves `activeCleanups` empty so a follow-up
    // buildAndSubscribe can never double-unsubscribe or double-subscribe.
    const teardownSubscriptions = () => {
      const fns = activeCleanups;
      activeCleanups = [];
      for (const fn of fns) {
        try { fn(); } catch {}
      }
    };

    // Build the Ably client + (re)subscribe every channel. Tears down any
    // previous subscriptions FIRST so a foreground re-run lands on a clean
    // slate (no duplicate handlers). Called from the initial deferred
    // mount and from the foreground (AppState 'active') handler.
    const buildAndSubscribe = () => {
      teardownSubscriptions();
      const realtime = getRealtime();
      if (!realtime) return; // No deviceKey or auth not ready — degrade silently.
      const cleanups: Array<() => void> = [];

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
              participantName: String(payload.senderName || payload.sender_name || ''),
              participantUsername: String(payload.senderUsername || payload.sender_username || ''),
              participantEmoji: String(payload.senderEmoji || payload.sender_emoji || '😊'),
              lastMessage,
              lastMessageAt,
              // Recorded so unread reconciliation can tell our own outgoing message from an incoming
              // one. It arrives on the same ping that sets `lastMessageAt`, so the two can never
              // disagree about which message the row is describing.
              lastSenderId: senderId || undefined,
            };
            if (idx >= 0) {
              const merged = [...existing];
              merged[idx] = { ...existing[idx], ...nextRow };
              store.setConversations(merged);
            } else {
              store.setConversations([nextRow, ...existing]);
            }
          } catch {}

          // 1b) Count it as unread for that conversation, which is what makes the badge on the
          //     chat-list row appear. The row's badge markup has existed all along; nothing ever
          //     supplied a non-zero count (the screen hardcodes `unreadCount: 0` and the Worker has
          //     no read-state concept), so the badge could never render. See chatUnreadStore.
          //
          //     `bump` itself skips the conversation currently on screen, using the same
          //     `isActiveThread` register that suppresses the push for it — reading a chat live must
          //     not accumulate a count, and that is the same judgement as "do not banner this".
          //
          //     Deliberately NOT inside the try above: a failure to upsert the row must not skip the
          //     count, and vice versa.
          // ── ONE AUTHORSHIP TEST, USED BY EVERY BADGE ──────────────────────
          //
          // Our own outgoing message echoes back on this channel, so anything that counts has to know
          // whether the ping came from somebody else. Requires POSITIVE evidence: a sender id that is
          // present AND different from mine. An unidentifiable ping is dropped rather than guessed at —
          // a missed badge is invisible, a wrong badge is a bug report.
          //
          // Computed ONCE, here, and read by both badge writers below. It used to be inline at the
          // unread counter only, which is how the notifications bell kept the bug after the counter was
          // fixed: two badges, two independent decisions, one of them never made.
          const myId = useAuthStore.getState().user?.id;
          const isFromOther = !!senderId && !!myId && senderId !== myId;

          try {
            if (isFromOther) useChatUnread.getState().bump(conversationId);
          } catch {}

          // ── THE IN-APP PILL IS PRODUCED HERE, NOT FROM THE PUSH HANDLER ──────
          //
          // Reported: a message from an Android device shows the pill on iPhone, but a message from an
          // iPhone shows nothing on Android. The pill was fed only from `handleNotification` in
          // pushNotifications.ts, so it inherited whatever the OS decides to do with a foreground push —
          // and that is not symmetric between the platforms.
          //
          // This bridge is the right producer for three independent reasons, and none of them require
          // diagnosing FCM:
          //   • it is platform-independent — the same Ably event arrives on both;
          //   • it carries RICHER data. The push payload has only `{ type, conversation_id, sender_id }`
          //     plus a title, whereas this event has the sender's emoji, name AND the preview text — so
          //     the pill can show the real avatar glyph and say "sent you a photo" rather than guessing;
          //   • it fires even when a push was never delivered at all (permission denied, throttled,
          //     token stale), which is precisely when an in-app alert matters most.
          //
          // `handleNotification` stays as a fallback and yields to this one — see the producer-precedence
          // note in inAppAlertStore. `isFromOther` gates it for the same reason the unread bump does: an
          // alert for your own outgoing message is never correct.
          //
          // No extra server or hosting cost, which was an explicit requirement: this is a message the
          // client already receives and already parses for the two writes above.
          try {
            // Category preference applies here too, and this is the surface where it fully bites:
            // the pill is produced from this event, so muting messages genuinely stops it appearing
            // while the app is open. The unread bump above is deliberately NOT gated — muting an
            // alert is a statement about being interrupted, not about the message being read, and
            // silently zeroing the counter would lose the message.
            if (isFromOther && isAlertCategoryEnabled('message') && !isActiveThread('chat', conversationId)) {
              const previewRaw = String(payload.lastMessage || payload.preview || '');
              const imgs = Array.isArray(payload.imageUrls) ? payload.imageUrls : [];
              const firstImg = typeof imgs[0] === 'string' ? imgs[0] : '';
              const media: 'photo' | 'gif' | 'text' = firstImg
                ? looksAnimated(firstImg)
                  ? 'gif'
                  : 'photo'
                : 'text';
              useInAppAlert.getState().push(
                {
                  kind: 'message',
                  emoji: String(payload.senderEmoji || payload.sender_emoji || '😊'),
                  name:
                    String(payload.senderName || payload.sender_name || '').trim() ||
                    String(payload.senderUsername || payload.sender_username || '').trim() ||
                    'Someone',
                  actorId: senderId || undefined,
                  targetId: conversationId || undefined,
                  media: previewRaw || firstImg ? media : undefined,
                },
                'bridge',
              );
            }
          } catch {
            // An ambient alert that cannot be queued must never break message delivery.
          }

          // 2) Drop the previewed message into this conversation's chat
          //    store so it's already on screen when the user opens the
          //    chat — no spinner, no fetch round-trip.
          try {
            const chatStore = useChatStore.getState();
            const existing = chatStore.messages[conversationId] || [];

            // Three payload shapes, in priority order:
            //   1) Worker `notif.message` (current): snake_case full message
            //      — `message_id`, `text`, `created_at` (+ `preview` badge).
            //   2) Legacy client `new_message`: an embedded `message` object.
            //   3) Worker preview-only (pre-backstop): just `preview` + `ts`.
            // Build a ChatMessage from whichever is present, tagging the
            // sender with the REAL author uuid (`senderId`, resolved above
            // from the notif payload) so ownership renders correctly on any
            // account — never the relative 'peer' sentinel.
            const rich = payload.message && payload.message.id ? payload.message : null;
            const ts = String(
              payload.created_at || payload.ts || rich?.createdAt || new Date().toISOString(),
            );
            // Stable id keyed off the REAL DB message id (`message_id` from the
            // Worker, or `message.id` from the legacy payload) so the full
            // history load — which carries the same DB id — dedupes against
            // this backstop instead of duplicating it. Only when neither is
            // present do we fall back to a conversation+ts synthetic id.
            const dbMessageId = rich?.id
              ? String(rich.id)
              : payload.message_id
                ? String(payload.message_id)
                : '';
            const stableId =
              dbMessageId ||
              `peer-${conversationId}-${ts}-${senderId || 'x'}-${Math.random().toString(36).slice(2, 8)}`;
            // Prefer the full `text` field; fall back to the legacy rich text,
            // then the trimmed preview for pre-backstop publishes.
            const previewText = String(rich?.text ?? payload.text ?? payload.preview ?? '');

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
                senderId: senderId || 'peer',
                text,
                createdAt: ts,
                isRead: false,
                imageUrls,
              } as any);
            }
          } catch {}

          // 3) Bump the unread notifications badge so the bell updates live even when the recipient
          //    isn't on the messages tab.
          //
          //    GUARDED BY AUTHORSHIP — this is the line that kept the reported bug alive.
          //
          //    "I send a message and the indicator appears on MY side for about a second, then
          //    disappears." That is this increment, exactly: it fired on EVERY `notif.message`,
          //    including the echo of our own send, so the bell jumped immediately. A second later
          //    `recompute()` derives the real count from the notifications cache — which does not
          //    contain our own outgoing message — and corrects it back to zero. Appear, then vanish.
          //
          //    Three previous fixes went to the per-conversation unread counter and left this one
          //    untouched, because they were two separate decisions about the same question. There is
          //    one decision now (`isFromOther` above).
          try { if (isFromOther) useNotificationsBadge.getState().increment(1); } catch {}
          return;
        }

        // ── Activity pings (like / comment / follow) ───────────────────
        // The Worker publishes these from posts.ts / follows.ts. The
        // per-screen subscriptions (post:<id>, user:<id>:follows) carry the
        // actual state deltas; here we only bump the bell badge so it
        // updates live.
        if (name === 'notif.like' || name === 'notif.comment' || name === 'notif.follow') {
          try { useNotificationsBadge.getState().increment(1); } catch {}
          // Same reasoning as the message branch above: produce the in-app pill from the
          // platform-independent event rather than from the OS push handler, so a like, comment or
          // follow announces itself identically on both platforms. The requested distinction between
          // "followed you" / "commented" / "liked" comes straight from the event name.
          try {
            const kind = name === 'notif.like' ? 'like' : name === 'notif.comment' ? 'comment' : 'follow';
            // Likes are the case where this toggle is the ONLY control that exists: the like route
            // publishes a realtime event and sends no push at all, so the pill and the bell badge are
            // the entire surface. Comments and follows do send pushes, which the handler gates
            // separately.
            if (!isAlertCategoryEnabled(kind)) return;
            const actorId = String(
              payload.actorId || payload.actor_id || payload.followerId || payload.follower_id || '',
            );
            const postId = String(payload.postId || payload.post_id || '');
            // A comment on the post already open on screen is visible without an alert, exactly as with
            // the chat check — the same judgement `shouldPresent` makes for the OS banner.
            if (!(kind === 'comment' && postId && isActiveThread('post', postId))) {
              useInAppAlert.getState().push(
                {
                  kind,
                  // Reported: a follow showed a different emoji than that person's own. The follow
                  // payload carries no emoji, so the generic glyph below was all there was. The peer's
                  // real emoji is usually already cached — `entityStore.profiles` is populated by any
                  // screen that has rendered them — so look there first and keep the kind glyph as the
                  // last resort. Local read only: no request, which the no-server-load requirement rules
                  // out anyway.
                  emoji:
                    String(payload.actorEmoji || payload.actor_emoji || payload.followerEmoji || '').trim() ||
                    (actorId ? String((useEntityStore.getState() as any).profiles?.[actorId]?.emoji || '').trim() : '') ||
                    (kind === 'follow' ? '👤' : kind === 'like' ? '❤️' : '💬'),
                  name:
                    String(
                      payload.actorName || payload.actor_name || payload.followerName || payload.follower_name || '',
                    ).trim() || 'Someone',
                  actorId: actorId || undefined,
                  targetId: postId || undefined,
                },
                'bridge',
              );
            }
          } catch {
            // Never let an ambient alert break the badge increment above.
          }
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
          if ('theme_id' in payload) updates.themeId = payload.theme_id;
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
              theme_id: payload.theme_id ?? existing.theme_id,
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

      activeCleanups = cleanups;
    };

    // Deferred (macrotask) subscribe. The 0 ms timeout pushes the Ably
    // client construction + channel.subscribes past the current commit +
    // RAF so the cold-open critical path is never blocked by the
    // WebSocket handshake. Reused verbatim for the foreground re-subscribe.
    const scheduleSubscribe = () => {
      if (deferTimer) clearTimeout(deferTimer);
      deferTimer = setTimeout(() => {
        deferTimer = null;
        if (cancelled) return;
        try { buildAndSubscribe(); } catch {}
      }, 0);
    };

    scheduleSubscribe();

    // ─── app-lifecycle handling ─────────────────────────────────────
    // Background message delivery is covered by Expo push notifications,
    // so holding the socket + 30s heartbeats open while backgrounded is
    // wasted battery/radio. Release the connection shortly after the app
    // is backgrounded and rebuild it on foreground. Fully guarded so a
    // lifecycle transition can never throw.
    const onAppStateChange = (next: AppStateStatus) => {
      try {
        if (next === 'active') {
          // Foregrounded. If a disconnect was pending but hadn't fired,
          // cancel it — a quick app-switch-and-return keeps the socket.
          if (bgTimer) { clearTimeout(bgTimer); bgTimer = null; }
          if (!userId) return;
          // Re-run the SAME subscription setup on a (possibly fresh)
          // connection. buildAndSubscribe tears down any previous subs
          // first, so this never double-subscribes.
          scheduleSubscribe();
        } else if (next === 'background') {
          // Grace delay (~10s) so a quick app-switch-and-return doesn't
          // churn the connection. When it fires, drop subscriptions and
          // close the socket via disconnectRealtime().
          if (bgTimer) clearTimeout(bgTimer);
          bgTimer = setTimeout(() => {
            bgTimer = null;
            try {
              teardownSubscriptions();
              disconnectRealtime();
            } catch {}
          }, 10000);
        }
        // 'inactive' (iOS app-switcher / transient) is intentionally
        // ignored to avoid churn — only a real 'background' disconnects.
      } catch {}
    };

    const appStateSub = AppState.addEventListener('change', onAppStateChange);

    return () => {
      cancelled = true;
      if (deferTimer) clearTimeout(deferTimer);
      if (bgTimer) clearTimeout(bgTimer);
      try { appStateSub.remove(); } catch {}
      teardownSubscriptions();
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
