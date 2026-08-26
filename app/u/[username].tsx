import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { emojiTextStyle } from '../../src/components/ui/emojiText';
import { Text as RNText } from 'react-native';
import { useT } from '../../src/i18n/store';

/**
 * Resolve an @mention to a profile, or say plainly that there is no such user.
 *
 * ── WHY A ROUTE AND NOT A HANDLER ─────────────────────────────────────────────
 *
 * Reported: writing `@someone` renders as a tappable mention everywhere — chat, comments, profile
 * bios — and tapping it does nothing. It should open that profile, and if the user does not exist it
 * should say so rather than failing silently.
 *
 * The mention was never wired. `FormattedText` has parsed mentions into their own span and painted
 * them accent-coloured and semibold for a long time, but its handler was literally
 * `onPress={() => { /* search user by username and navigate *\/ }}` — an empty body with a note
 * describing the work. So mentions LOOKED interactive and were decoration.
 *
 * Resolution lives in a route rather than in that handler for three reasons:
 *
 *   ONE PLACE. `FormattedText` backs chat, comments and bios, so a `router.push` there fixes every
 *   surface at once and none of them needs to know how a username becomes a profile.
 *
 *   IT NEEDS TO BE ASYNC AND VISIBLE. The lookup is a network call. Doing it inside a text press
 *   handler means either blocking with no feedback or a toast; a route can show a spinner and then
 *   the result, which is what the "no such user" screen is.
 *
 *   MENTIONS BECOME ADDRESSABLE. `/u/<username>` is a real location, so it works from a deep link
 *   and from anywhere else in the app for free.
 *
 * ── WHY `replace` AND NOT `push` ON SUCCESS ───────────────────────────────────
 *
 * This screen is a resolver, not a destination. Pushing the profile on top of it would leave it in
 * the stack, so backing out of a profile would land on a spinner that immediately resolves and pushes
 * the profile again — a loop the user cannot escape by going back. `replace` takes this screen's slot,
 * so back goes where the mention was tapped.
 */
export default function MentionResolverScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { username } = useLocalSearchParams<{ username: string }>();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handle = (async () => {
      const clean = (username || '').trim().replace(/^@+/, '');
      if (!clean) { if (!cancelled) setNotFound(true); return; }
      try {
        const { apiGet } = await import('../../src/services/apiClient');
        // The worker already exposes this lookup and documents its contract: a unique-indexed read
        // that returns the full profile row, or 200 + null when nothing matches. So "no such user" is
        // an ordinary successful response here, not an error to be caught.
        const { data } = await apiGet<{ id: string } | null>(
          `/v1/profiles/by-username/${encodeURIComponent(clean)}`,
        );
        if (cancelled) return;
        if (data?.id) {
          router.replace({ pathname: '/profile/[id]', params: { id: data.id } });
          return;
        }
        setNotFound(true);
      } catch {
        // A failed request is reported the same way as a missing user on purpose. The distinction is
        // real but not actionable for someone who tapped a name: either way the profile is not
        // reachable, and two near-identical screens would only make the copy vaguer.
        if (!cancelled) setNotFound(true);
      }
    })();
    return () => { cancelled = true; void handle; };
  }, [username]);

  if (!notFound) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background.primary }]}>
        <ActivityIndicator color={theme.colors.text.tertiary} />
      </View>
    );
  }

  return (
    <View style={[styles.center, { backgroundColor: theme.colors.background.primary }]}>
      {/* `emojiTextStyle` rather than a bare fontSize: an emoji at display size is exactly where
          Android clips the glyph, and that helper owns the four properties that fix it. */}
      <RNText style={emojiTextStyle(52)} allowFontScaling={false}>😵‍💫</RNText>
      <Text variant="subheading" weight="bold" align="center" style={styles.title}>
        {t('mention.not_found_title', 'Ой, похоже, такого пользователя нет')}
      </Text>
      <Text variant="caption" color={theme.colors.text.secondary} align="center" style={styles.body}>
        {t('mention.not_found_body', 'Проверьте имя пользователя — возможно, оно изменилось или профиль был удалён.')}
      </Text>
      {/* Back, not "try again". Retrying resolves the same username against the same index and gets
          the same answer, so offering it would be a button that does nothing twice. */}
      <Pressable
        onPress={() => router.back()}
        style={[styles.btn, { backgroundColor: theme.colors.accent.primary }]}
        accessibilityRole="button"
      >
        <Feather name="chevron-left" size={18} color="#FFFFFF" />
        <Text variant="body" weight="semibold" color="#FFFFFF">{t('common.back', 'Назад')}</Text>
      </Pressable>
      <View style={{ height: insets.bottom }} />
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
