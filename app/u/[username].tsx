import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator, Text as RNText } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { emojiTextStyle } from '../../src/components/ui/emojiText';
import { kvGetJSONSync, kvSetJSON } from '../../src/services/kvStore';
import { useT } from '../../src/i18n/store';

/**
 * Resolve an @mention to a profile, or say plainly that there is no such user.
 *
 * ── WHY A ROUTE AND NOT A PRESS HANDLER ───────────────────────────────────────
 *
 * `FormattedText` had parsed mentions into their own accent-coloured span for a long time while its
 * press handler was an empty body, so mentions looked interactive everywhere and did nothing. A
 * username is not an id, so something has to do a lookup; doing it inside a text press handler means
 * either blocking with no feedback or a toast. A route can show a spinner and then the result — and
 * "no such user" IS that result, not an error page. It also makes `/u/<name>` addressable, so a
 * mention works from a deep link for free.
 *
 * On success it REPLACES itself rather than pushing. This screen is a resolver, not a destination:
 * pushing the profile on top would leave it in the stack, so backing out of the profile would land on
 * a spinner that immediately resolves and pushes the profile again — a loop with no way back.
 */

/** username (lowercased) → profile id. Survives restarts; see the note on the cache below. */
const MENTION_CACHE_KEY = 'mention_ids';

type MentionCache = Record<string, string>;

/**
 * ── THE LOOKUP IS CACHED, BECAUSE TAPPING THE SAME NAME TWICE WAS A ROUND TRIP ──
 *
 * Reported: open a mention, the profile appears correctly, go back, tap the same mention again — and
 * it loads again, with an FPS dip.
 *
 * Going back POPS this resolver, so the second tap is a fresh mount, not a re-focus. The first
 * version had no cache at all, so every single tap paid a network request to
 * `/v1/profiles/by-username/...` before it could even start navigating. That request is the delay,
 * and it was entirely mine.
 *
 * Now the answer is remembered. A cache hit navigates on the FIRST render with no spinner and no
 * network — the resolver becomes invisible, which is what it should have been.
 *
 * Read synchronously via `kvGetJSONSync`, deliberately: an async read would put a spinner frame in
 * front of a value we already have, which is the whole problem being fixed. The chat's open path uses
 * the same synchronous-read reasoning.
 *
 * ── WHY THE STALE ENTRY IS USED ANYWAY, AND REVALIDATED BEHIND IT ─────────────
 *
 * A username can change hands. Rather than a TTL — which would reintroduce the spinner on a schedule
 * for no benefit the user can perceive — the cached id is used immediately and the lookup still runs
 * in the background to refresh the entry. If a name really did move, the NEXT tap goes to the new
 * owner. That is stale-while-revalidate, and it is the right trade here because the cost of being one
 * tap behind on a renamed account is far lower than the cost of a network wait on every tap.
 */
function readCache(): MentionCache {
  try {
    return kvGetJSONSync<MentionCache>(MENTION_CACHE_KEY, {}) || {};
  } catch {
    return {};
  }
}

function writeCache(name: string, id: string): void {
  try {
    const next = readCache();
    if (next[name] === id) return;
    next[name] = id;
    // Bounded so a long-lived install cannot grow this without limit. 300 distinct mentioned
    // usernames is far past any realistic session, and dropping the oldest keys is harmless — a
    // dropped entry costs exactly one lookup, which is what happened before the cache existed.
    const keys = Object.keys(next);
    if (keys.length > 300) {
      for (const k of keys.slice(0, keys.length - 300)) delete next[k];
    }
    kvSetJSON(MENTION_CACHE_KEY, next);
  } catch {
    // A cache write failing must never break navigation.
  }
}

export default function MentionResolverScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { username } = useLocalSearchParams<{ username: string }>();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const clean = (username || '').trim().replace(/^@+/, '').toLowerCase();
      if (!clean) { if (!cancelled) setNotFound(true); return; }

      // Cache hit → navigate on this render. No spinner, no request.
      const cachedId = readCache()[clean];
      if (cachedId) {
        router.replace({ pathname: '/profile/[id]', params: { id: cachedId } });
        // Deliberately NOT returning: the lookup below still runs to refresh the entry, so a username
        // that changed owner corrects itself for the next tap. Nothing on screen depends on it.
      }

      try {
        const { apiGet } = await import('../../src/services/apiClient');
        // The worker already exposes this lookup and documents its contract: a unique-indexed read
        // returning the full profile row, or 200 + null when nothing matches. So "no such user" is an
        // ordinary successful response here, not an error to catch.
        const { data } = await apiGet<{ id: string } | null>(
          `/v1/profiles/by-username/${encodeURIComponent(clean)}`,
        );
        if (cancelled) return;
        if (data?.id) {
          writeCache(clean, data.id);
          // Only navigate if the cache did not already do it, otherwise this would push a second copy
          // of the profile on top of the one the user is already looking at.
          if (!cachedId) router.replace({ pathname: '/profile/[id]', params: { id: data.id } });
          return;
        }
        if (!cachedId) setNotFound(true);
      } catch {
        // A failed request reports the same screen as a missing user, on purpose. The distinction is
        // real but not actionable for someone who tapped a name, and two near-identical screens would
        // only make the copy vaguer. Suppressed entirely on a cache hit — the user is already on the
        // profile, and a background refresh failing is not their problem.
        if (!cancelled && !cachedId) setNotFound(true);
      }
    })();
    return () => { cancelled = true; };
  }, [username]);

  if (!notFound) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background.primary }]}>
        <ActivityIndicator color={theme.colors.text.tertiary} />
      </View>
    );
  }

  return <NotFound theme={theme} t={t} bottomInset={insets.bottom} />;
}

/**
 * ── THE EMOJI MOVES, WITHOUT SHIPPING AN ANIMATION ASSET ──────────────────────
 *
 * Asked: could the dizzy face be animated — the eyes spinning, the mouth shifting.
 *
 * A real animated emoji means a Lottie asset. `lottie-react-native` IS available and `LottieSticker`
 * already uses it, but only for stickers fetched by URL; there is no bundled animation here to point
 * it at, and importing a third-party Lottie of an Apple emoji is exactly what
 * `.kiro/steering/apple-compliance.md` forbids without ownership or a licence, on top of Apple's own
 * emoji artwork not being ours to redraw.
 *
 * So the glyph itself is animated instead: a slow wobble paired with a gentle breath. It cannot spin
 * the eyes — those pixels belong to the font — but it makes the face feel unsteady, which is the same
 * thing the dizzy emoji is already saying. Two transforms on one node, on the UI thread, and no new
 * files or rights questions.
 *
 * `withRepeat(..., -1, true)` reverses on each cycle, so the sequence never snaps back to its start.
 */
function NotFound({ theme, t, bottomInset }: { theme: any; t: any; bottomInset: number }) {
  const wobble = useSharedValue(0);

  useEffect(() => {
    wobble.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        withTiming(-1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );
  }, [wobble]);

  const emojiStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${wobble.value * 9}deg` },
      { scale: 1 + Math.abs(wobble.value) * 0.05 },
    ],
  }));

  return (
    <View style={[styles.center, { backgroundColor: theme.colors.background.primary }]}>
      <Reanimated.View style={emojiStyle}>
        {/* `emojiTextStyle` rather than a bare fontSize: display-size emoji is exactly where Android
            clips the glyph, and that helper owns the four properties that fix it. */}
        <RNText style={emojiTextStyle(52)} allowFontScaling={false}>😵‍💫</RNText>
      </Reanimated.View>
      <Text variant="subheading" weight="bold" align="center" style={styles.title}>
        {t('mention.not_found_title', 'Ой, похоже, такого пользователя нет')}
      </Text>
      {/* No dash in this copy. It read as a stray stroke on device, so the sentence is split into two
          instead of being joined by punctuation that looks like debris at caption size. */}
      <Text variant="caption" color={theme.colors.text.secondary} align="center" style={styles.body}>
        {t('mention.not_found_body', 'Проверьте имя пользователя. Возможно, оно изменилось или профиль был удалён.')}
      </Text>
      {/* Back, not "try again". Retrying resolves the same username against the same unique index and
          gets the same answer, so it would be a button that does nothing twice. */}
      <Pressable
        onPress={() => router.back()}
        style={[styles.btn, { backgroundColor: theme.colors.accent.primary }]}
        accessibilityRole="button"
      >
        <Feather name="chevron-left" size={18} color="#FFFFFF" />
        <Text variant="body" weight="semibold" color="#FFFFFF">{t('common.back', 'Назад')}</Text>
      </Pressable>
      <View style={{ height: bottomInset }} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  title: { marginTop: 10 },
  body: { lineHeight: 19 },
  btn: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 14,
    paddingRight: 20,
    height: 46,
    borderRadius: 23,
  },
});
