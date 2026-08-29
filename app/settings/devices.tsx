// Settings → Devices
//
// ── WHAT THIS SCREEN IS ALLOWED TO CLAIM ────────────────────────────────────
//
// Asked for: "в разделе устройства должно отображаться устройство, то есть все устройства, когда либо
// заходили на этот аккаунт... и кнопочка покинуть устройство... можно сделать такую же самую систему,
// как в Телеграме."
//
// What Telegram shows is a SESSION list, and this backend has no sessions. The auth token is a
// stateless JWT — there is no row to enumerate and nothing records a sign-in. The only per-install
// record that exists anywhere is `push_tokens (token, user_id, platform, created_at)`.
//
// So this screen shows what we actually have: the devices registered to receive notifications, with a
// revoke control. It says so, in both languages, in the subtitle AND in a footnote — because a list
// captioned "every device that ever signed in" which silently omits any device that declined the
// notification permission would be worse than no screen. The shape the user asked for, with an honest
// label instead of an invented one.
//
// Building the real thing means writing a row per sign-in with something that identifies the device.
// That is new device-data collection, which the compliance rules require consent for, and it must not
// derive a stable device identifier. This screen goes the other way: it exposes data we already hold,
// to the person it is about, and gives them a delete button for it.
//
// ── WHY THE ROWS ARE HAND-BUILT ─────────────────────────────────────────────
//
// `SettingsRow` lives inside `app/settings/index.tsx` and is not exported, so every sub-screen builds
// its own presentation (`device-key.tsx` does the same). The card styling here mirrors the root
// screen's `sectionCardStyle` so the two read as one settings surface.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useT, useI18nStore } from '../../src/i18n/store';
import { apiGet, apiPost } from '../../src/services/apiClient';
import { getRegisteredPushToken, unregisterPush } from '../../src/services/pushNotifications';
import { formatDaySeparator } from '../../src/utils/chatDaySeparators';
import { triggerHaptic } from '../../src/utils/haptics';
import { showToast } from '../../src/store/toastStore';

interface DeviceRow {
  token: string;
  platform: string | null;
  created_at: string | null;
}

/**
 * Last few characters of the push token, for telling two same-platform devices apart.
 *
 * The full token is never rendered. It is a value that lets anyone holding it push a notification to
 * that device, so it has no business being on screen or in a screenshot — but the user still needs
 * SOME way to distinguish "Android" from "Android". Six characters is enough to differ in practice
 * and useless on its own.
 *
 * The token is `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`, so the closing bracket is trimmed first.
 */
function tokenSuffix(token: string): string {
  const inner = token.replace(/\]$/, '');
  return inner.slice(-6).toUpperCase();
}

export default function DevicesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // The absolute-date formatter is locale-aware, so the label follows the app language rather than the
  // OS one — the user can read the app in English on a Russian phone.
  const locale = useI18nStore((s) => s.locale);

  const [rows, setRows] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState(false);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  // Read once per mount rather than per render: it is a synchronous MMKV read, and the value cannot
  // change while this screen is open (registration happens at app start).
  const [myToken] = useState(() => getRegisteredPushToken());

  const load = useCallback(async () => {
    setError(false);
    setRows(null);
    const { data, error: err } = await apiGet<DeviceRow[]>('/v1/push/devices');
    // `apiGet` resolves with an error string rather than throwing, so this is the whole failure
    // surface. An empty array is a legitimate success (no device has registered yet) and must not be
    // shown as an error — hence the separate `error` flag rather than treating `!data` as failure.
    if (err) {
      setError(true);
      setRows([]);
      return;
    }
    setRows(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const platformLabel = useCallback(
    (p: string | null): string => {
      if (p === 'ios') return t('devices.platform_ios');
      if (p === 'android') return t('devices.platform_android');
      return t('devices.platform_unknown');
    },
    [t],
  );

  const dateLabel = useCallback(
    (iso: string | null): string => {
      if (!iso) return t('devices.registered_unknown');
      const day = formatDaySeparator(iso, Date.now(), locale, t);
      // `formatDaySeparator` returns null for an unparseable timestamp, which is exactly the
      // "we do not know" case the dedicated string covers.
      if (!day) return t('devices.registered_unknown');
      return t('devices.registered', undefined, { date: day });
    },
    [locale, t],
  );

  const revoke = useCallback(
    (row: DeviceRow) => {
      const isCurrent = !!myToken && row.token === myToken;
      triggerHaptic('medium');
      Alert.alert(
        t('devices.revoke_title'),
        // Two different messages, because the consequence is genuinely different. Revoking another
        // device is remote housekeeping; revoking THIS one silently turns your own notifications off,
        // and a confirmation that did not say so would be a trap.
        isCurrent ? t('devices.revoke_current_msg') : t('devices.revoke_msg'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('devices.revoke_action'),
            style: 'destructive',
            onPress: async () => {
              setBusyToken(row.token);
              // ── THE CURRENT DEVICE GOES THROUGH `unregisterPush`, NOT A RAW POST ──
              //
              // Both paths hit the same endpoint, but `unregisterPush` ALSO clears the local
              // "token already sent" marker in MMKV. Without that clear, `registerForPush` on the
              // next launch compares the live Expo token against the stored one, finds them equal,
              // and returns before re-registering — so this device would stay silently unregistered
              // for ever, with nothing in the UI to explain why notifications stopped. Deleting the
              // server row without forgetting the client marker is a one-way door.
              //
              // For any OTHER device the marker is irrelevant (it belongs to that install), so the
              // plain call is correct there.
              if (isCurrent) {
                await unregisterPush();
              } else {
                await apiPost('/v1/push/unregister', { token: row.token });
              }
              setBusyToken(null);
              // Optimistic removal. The endpoint is idempotent and scoped by `user_id`, so a failed
              // call leaves the row on the server and the next open of this screen shows it again —
              // which is a truthful outcome, and better than blocking the list on a spinner.
              setRows((prev) => (prev ? prev.filter((r) => r.token !== row.token) : prev));
              showToast(t('devices.revoked'), 'trash-2');
            },
          },
        ],
      );
    },
    [myToken, t],
  );

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const cardStyle: ViewStyle = {
    backgroundColor: theme.colors.background.elevated,
    borderRadius: 24,
    overflow: 'hidden',
  };

  return (
    <View style={containerStyle}>
      {/* Header — same geometry as device-key.tsx, plus a refresh affordance on the right. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          paddingTop: insets.top + 8,
          paddingBottom: 16,
          position: 'relative',
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{ position: 'absolute', left: 24, top: insets.top + 8 }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="subheading" weight="bold">{t('settings.devices')}</Text>
        <Pressable
          onPress={() => { triggerHaptic('light'); void load(); }}
          style={{ position: 'absolute', right: 24, top: insets.top + 8 }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.retry')}
        >
          <Feather name="refresh-cw" size={19} color={theme.colors.text.secondary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 48 }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="caption" color={theme.colors.text.secondary} style={{ marginBottom: 16 }}>
          {t('devices.subtitle')}
        </Text>

        {rows === null ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.accent.primary} />
        ) : error ? (
          <View style={{ alignItems: 'center', marginTop: 40, gap: 12 }}>
            <Feather name="wifi-off" size={28} color={theme.colors.text.tertiary} />
            <Text variant="caption" color={theme.colors.text.tertiary} align="center">
              {t('devices.error')}
            </Text>
            <Pressable
              onPress={() => { triggerHaptic('light'); void load(); }}
              style={{
                backgroundColor: theme.colors.accent.primary,
                borderRadius: 14,
                paddingVertical: 12,
                paddingHorizontal: 28,
                marginTop: 4,
              }}
            >
              <Text variant="body" weight="semibold" color={theme.colors.text.inverse}>
                {t('common.retry')}
              </Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 40, gap: 8 }}>
            <Feather name="smartphone" size={28} color={theme.colors.text.tertiary} />
            <Text variant="body" weight="semibold" align="center">{t('devices.empty')}</Text>
            <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ paddingHorizontal: 16 }}>
              {t('devices.empty_hint')}
            </Text>
          </View>
        ) : (
          <View style={cardStyle}>
            {rows.map((row, i) => {
              const isCurrent = !!myToken && row.token === myToken;
              const isBusy = busyToken === row.token;
              // iOS and Android get the platform's own accent rather than one shared colour, so two
              // rows are distinguishable at a glance before reading either label.
              const tint = row.platform === 'ios' ? '#0A84FF' : row.platform === 'android' ? '#30D158' : '#8E8E93';
              return (
                <View
                  key={row.token}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 14,
                    paddingHorizontal: 16,
                    borderBottomWidth: i === rows.length - 1 ? 0 : 0.5,
                    borderBottomColor: theme.colors.border.light,
                  }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 12,
                      backgroundColor: tint,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 14,
                    }}
                  >
                    <Feather name="smartphone" size={17} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text variant="body" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {platformLabel(row.platform)}
                      </Text>
                      {isCurrent ? (
                        <View
                          style={{
                            paddingHorizontal: 7,
                            paddingVertical: 2,
                            borderRadius: 8,
                            backgroundColor: theme.colors.accent.primary + '26',
                          }}
                        >
                          <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} style={{ fontSize: 10 }}>
                            {t('devices.this_device')}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>
                      {dateLabel(row.created_at)} · {tokenSuffix(row.token)}
                    </Text>
                  </View>
                  {isBusy ? (
                    <ActivityIndicator size="small" color={theme.colors.text.tertiary} />
                  ) : (
                    <Pressable
                      onPress={() => revoke(row)}
                      hitSlop={8}
                      style={{ padding: 6 }}
                      accessibilityRole="button"
                      accessibilityLabel={t('devices.revoke_action')}
                    >
                      <Feather name="trash-2" size={17} color={theme.colors.status.error} />
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* The honesty footnote. Deliberately below the list rather than in the subtitle only: someone
            who scrolls looking for a device that is not here needs the explanation at the point they
            notice it is missing. */}
        {rows !== null && !error ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, paddingHorizontal: 4 }}>
            <Feather name="info" size={14} color={theme.colors.text.tertiary} style={{ marginTop: 2 }} />
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ flex: 1 }}>
              {t('devices.note')}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
