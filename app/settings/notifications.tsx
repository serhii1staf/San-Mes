/**
 * Notification preferences — per-category alerts plus the master push switch.
 *
 * ── WHY TWO SECTIONS AND NOT ONE LIST OF FOUR TOGGLES ───────────────────────
 *
 * Because the two kinds of switch do genuinely different things, and merging them would make the
 * per-category ones a lie.
 *
 * The master switch is the only control that truthfully stops pushes: turning it off calls
 * `unregisterPush()`, which deletes the device's token row, and `sendPushToUser` in the Worker opens
 * with `if (!rows.length) return`. That is a real, server-side stop.
 *
 * The per-category switches are decided ON THE DEVICE, by `handleNotification` and the realtime
 * bridge. They fully control the in-app pill, the sound, the foreground banner and the Notification
 * Centre entry. They cannot stop the server sending a push, because there is nothing to tell it:
 * `sendPushToUser` takes no category argument and `push_tokens` has no preference column, so
 * server-side per-category muting needs a D1 migration and a deploy.
 *
 * So the copy says what each one does instead of implying they are the same. A toggle labelled "no
 * push notifications for likes" that still shows a lock-screen banner would be a setting that lies —
 * and for likes specifically it would be doubly wrong, since the like route sends no push at all and
 * publishes only a realtime event, which means this toggle IS the whole control there.
 *
 * When the Worker gains a preference column the same stored keys get POSTed with the token and start
 * suppressing delivery too, with no migration of the persisted value and no change to this screen
 * beyond its explanatory line.
 *
 * Compliance: no new permission and no new native module — push authorisation is already requested by
 * `requestPermissionsAsync()`. Nothing is collected or transmitted; the preferences are local.
 */
import React from 'react';
import { View, ScrollView, Pressable, Switch, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useT } from '../../src/i18n/store';
import { useSettingsStore } from '../../src/store/settingsStore';

/** The one pair of colours every Switch in this app uses. Matches settings/index and browser. */
const TRACK_ON = '#4CD964';
const THUMB = '#FFFFFF';

type CategoryKey = 'message' | 'comment' | 'follow' | 'like';

interface RowSpec {
  key: CategoryKey;
  icon: keyof typeof Feather.glyphMap;
  tint: string;
  labelKey: string;
  labelDefault: string;
}

/** Ordered by how often the event happens, so the most consequential switch is first. */
const CATEGORY_ROWS: readonly RowSpec[] = [
  { key: 'message', icon: 'message-circle', tint: '#0A84FF', labelKey: 'alerts.cat.messages', labelDefault: 'Messages' },
  { key: 'comment', icon: 'corner-up-left', tint: '#BF5AF2', labelKey: 'alerts.cat.comments', labelDefault: 'Comments' },
  { key: 'follow', icon: 'user-plus', tint: '#30D158', labelKey: 'alerts.cat.follows', labelDefault: 'New followers' },
  { key: 'like', icon: 'heart', tint: '#FF453A', labelKey: 'alerts.cat.likes', labelDefault: 'Likes' },
];

function ToggleRow({
  icon,
  tint,
  label,
  value,
  onValueChange,
  isLast,
}: {
  icon: keyof typeof Feather.glyphMap;
  tint: string;
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  isLast?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.row,
        { borderBottomWidth: isLast ? 0 : 0.5, borderBottomColor: theme.colors.border.light },
      ]}
    >
      <View style={[styles.iconTile, { backgroundColor: tint }]}>
        <Feather name={icon} size={17} color="#FFFFFF" />
      </View>
      <Text variant="body" style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: TRACK_ON, false: theme.colors.border.light }}
        thumbColor={THUMB}
      />
    </View>
  );
}

export default function NotificationSettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();

  // Field-level selectors, matching every other settings screen — pulling the whole store would
  // re-render this screen on any unrelated setting change.
  const pushEnabled = useSettingsStore((s) => s.pushNotificationsEnabled);
  const setPushEnabled = useSettingsStore((s) => s.setPushNotificationsEnabled);
  const categories = useSettingsStore((s) => s.notifyCategories);
  const setCategory = useSettingsStore((s) => s.setNotifyCategory);

  // Same handler shape as settings/index: flipping the master switch applies immediately, because a
  // preference that only takes effect on the next launch is indistinguishable from a broken one.
  const handleTogglePush = (v: boolean) => {
    setPushEnabled(v);
    import('../../src/services/pushNotifications')
      .then((m) => { if (v) m.registerForPush(); else m.unregisterPush(); })
      .catch(() => {});
  };

  const cardStyle = {
    backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF',
    borderRadius: 20,
    marginBottom: 12,
    overflow: 'hidden' as const,
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background.primary }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
        >
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="subheading" weight="bold" style={styles.headerTitle}>
          {t('alerts.title', 'Уведомления')}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Master switch ───────────────────────────────────────────────── */}
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={styles.sectionTitle}>
          {t('alerts.section.push', 'Push-уведомления')}
        </Text>
        <View style={cardStyle}>
          <ToggleRow
            icon="bell"
            tint="#FF66D9"
            label={t('alerts.push.enabled', 'Разрешить push-уведомления')}
            value={pushEnabled !== false}
            onValueChange={handleTogglePush}
            isLast
          />
        </View>
        <Text variant="caption" color={theme.colors.text.tertiary} style={styles.footnote}>
          {t(
            'alerts.push.hint',
            'Выключение полностью отключает push для этого устройства: токен удаляется, и сервер перестаёт их отправлять.',
          )}
        </Text>

        {/* ── Per-category ────────────────────────────────────────────────── */}
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={styles.sectionTitle}>
          {t('alerts.section.categories', 'Оповещения в приложении')}
        </Text>
        <View style={cardStyle}>
          {CATEGORY_ROWS.map((row, i) => (
            <ToggleRow
              key={row.key}
              icon={row.icon}
              tint={row.tint}
              label={t(row.labelKey, row.labelDefault)}
              value={categories?.[row.key] !== false}
              onValueChange={(v) => setCategory(row.key, v)}
              isLast={i === CATEGORY_ROWS.length - 1}
            />
          ))}
        </View>
        {/* States the boundary rather than hiding it — see the header note. */}
        <Text variant="caption" color={theme.colors.text.tertiary} style={styles.footnote}>
          {t(
            'alerts.categories.hint',
            'Управляет оповещениями, пока приложение открыто: плашкой сверху, звуком и записью в центре уведомлений. Пока приложение закрыто, показ баннера решает система — чтобы отключить и его, воспользуйтесь переключателем выше.',
          )}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  // Balances the 24pt back chevron so the title reads as centred without a second absolute layer.
  headerTitle: { flex: 1, textAlign: 'center', marginRight: 32 },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  sectionTitle: { marginBottom: 8, marginTop: 8, paddingHorizontal: 4 },
  footnote: { marginBottom: 12, paddingHorizontal: 4, lineHeight: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  rowLabel: { flex: 1 },
});
