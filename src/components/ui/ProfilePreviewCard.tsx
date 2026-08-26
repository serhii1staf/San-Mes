import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { UserBadge } from './UserBadge';
import Skeleton from './Skeleton';
import { useEntityStore } from '../../services/entityStore';
import { useT } from '../../i18n/store';
import { kvGetJSONSync, kvSetJSON } from '../../services/kvStore';
import { triggerHaptic } from '../../utils/haptics';

/**
 * A shared profile, rendered as the person.
 *
 * The twin of `PostPreviewCard`, for the other link shape the share sheet mints
 * (`https://san-m-app.com/profile/<id>`, from `openProfileShareSheet`). Same three-tier resolve, same
 * reason for existing: a shared profile used to arrive as a grey `san-m-app.com` row whose tap opened a
 * WebView of our marketing page instead of the profile the reader could already see natively.
 *
 * Deliberately SHORTER than the post card. A profile has no body text worth two lines in a chat bubble
 * — a face, a name, a handle and a bio line is the whole of it, which is also what makes it read as
 * distinct from a post card at a glance rather than as the same card with different words in it.
 *
 * The lookup here has a nicety the post card cannot have: `entityStore.profiles` is populated by almost
 * every screen in the app (feeds, chat lists, comment threads all upsert authors), so tier 1 hits far
 * more often than not and most of these cards never touch the network at all.
 */

interface CachedProfile {
  id: string;
  displayName: string;
  username: string;
  emoji: string;
  bio: string;
  verified: boolean;
  badge: string | null;
}

interface CacheEnvelope {
  t: number;
  d: CachedProfile | null;
}

const CACHE_PREFIX = '@san:profile-preview:';
const TTL_MS = 24 * 60 * 60 * 1000;
const AVATAR = 44;

function cacheGet(id: string): CacheEnvelope | null {
  try {
    const entry = kvGetJSONSync<CacheEnvelope | null>(CACHE_PREFIX + id, null);
    if (!entry) return null;
    if (Date.now() - entry.t > TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

function cachePut(id: string, value: CachedProfile | null): void {
  try {
    kvSetJSON(CACHE_PREFIX + id, { t: Date.now(), d: value });
  } catch {
    // Never let a cache write break the card.
  }
}

function fromRow(row: any): CachedProfile | null {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    displayName: row.display_name || row.username || 'User',
    username: row.username || '',
    emoji: row.emoji || '😊',
    bio: typeof row.bio === 'string' ? row.bio : '',
    verified: !!row.is_verified,
    badge: row.badge ?? null,
  };
}

interface ProfilePreviewCardProps {
  profileId: string;
  textColor?: string;
  static?: boolean;
}

export const ProfilePreviewCard = React.memo(function ProfilePreviewCard({
  profileId,
  textColor,
  static: isStatic,
}: ProfilePreviewCardProps) {
  const theme = useTheme();
  const t = useT();

  // One narrow selector — see the note in `PostPreviewCard` on why this is not `s => s.profiles`.
  const storeProfile = useEntityStore((s) => s.profiles[profileId]);

  const fromStore = React.useMemo<CachedProfile | null>(
    () => (storeProfile ? fromRow(storeProfile) : null),
    [storeProfile],
  );

  const fromCacheRef = React.useRef<CachedProfile | null | undefined>(undefined);
  if (fromCacheRef.current === undefined) {
    fromCacheRef.current = fromStore ? null : (cacheGet(profileId)?.d ?? null);
  }

  const [resolved, setResolved] = useState<CachedProfile | null>(fromStore || fromCacheRef.current);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (fromStore) {
      setResolved(fromStore);
      setMissing(false);
    }
  }, [fromStore]);

  useEffect(() => {
    if (resolved) return;
    let cancelled = false;
    void (async () => {
      try {
        const { getProfile } = await import('../../lib/supabase');
        const { profile } = await getProfile(profileId);
        if (cancelled) return;
        const row = fromRow(profile);
        if (row) {
          setResolved(row);
          cachePut(profileId, row);
        } else {
          setMissing(true);
          cachePut(profileId, null);
        }
      } catch {
        if (!cancelled) setMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, resolved]);

  const accent = theme.colors.accent.primary;
  const titleColor = textColor || theme.colors.text.primary;
  const subColor = textColor || theme.colors.text.tertiary;
  const bg = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.025)';
  const railColor = textColor ? 'rgba(255,255,255,0.6)' : accent;

  const open = () => {
    if (isStatic) return;
    triggerHaptic('light');
    router.push({ pathname: '/profile/[id]', params: { id: profileId } });
  };

  if (!resolved && !missing) {
    return (
      <View style={[styles.row, { backgroundColor: bg, borderLeftColor: railColor }]}>
        <Skeleton width={AVATAR} height={AVATAR} radius={AVATAR / 2} />
        <View style={styles.body}>
          <ActivityIndicator size="small" color={accent} />
        </View>
      </View>
    );
  }

  if (missing || !resolved) {
    return (
      <View style={[styles.row, { backgroundColor: bg, borderLeftColor: railColor }]}>
        <View style={styles.missingIcon}>
          <Feather name="user-x" size={18} color={subColor} />
        </View>
        <View style={styles.body}>
          <Text variant="caption" color={subColor} numberOfLines={2} style={styles.missingText}>
            {t('profile.preview.unavailable', 'Профиль недоступен')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      onPress={open}
      style={[styles.row, { backgroundColor: bg, borderLeftColor: railColor }]}
      accessibilityRole="button"
      accessibilityLabel={t('profile.preview.open_a11y', 'Открыть профиль')}
    >
      <Avatar emoji={resolved.emoji} name={resolved.displayName} size="md" tint />
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text variant="caption" weight="semibold" color={titleColor} numberOfLines={1} style={styles.name}>
            {resolved.displayName}
          </Text>
          {resolved.verified ? <VerifiedBadge size={10} /> : null}
          {resolved.badge ? <UserBadge badge={resolved.badge} size="sm" /> : null}
        </View>
        {resolved.username ? (
          <Text variant="caption" color={subColor} numberOfLines={1} style={styles.handle}>
            @{resolved.username}
          </Text>
        ) : null}
        {resolved.bio ? (
          <Text variant="caption" color={subColor} numberOfLines={1} style={styles.bio}>
            {resolved.bio}
          </Text>
        ) : null}
      </View>
      <View style={[styles.openBtn, { backgroundColor: textColor ? 'rgba(255,255,255,0.22)' : accent }]}>
        <Text variant="caption" weight="semibold" color="#FFFFFF" style={styles.openLabel}>
          {t('profile.preview.open', 'Открыть')}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderLeftWidth: 2,
    paddingLeft: 10,
    paddingRight: 10,
    paddingVertical: 9,
    overflow: 'hidden',
  },
  body: { flex: 1, gap: 1 },
  missingIcon: { width: AVATAR, height: AVATAR, alignItems: 'center', justifyContent: 'center' },
  missingText: { fontSize: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { fontSize: 13, flexShrink: 1 },
  handle: { fontSize: 11 },
  bio: { fontSize: 11, lineHeight: 15 },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  openLabel: { fontSize: 12 },
});
