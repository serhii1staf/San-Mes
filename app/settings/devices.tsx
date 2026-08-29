// Settings → Devices
//
// ── WHAT CHANGED, AND WHY THE FIRST VERSION WAS NOT ACCEPTABLE ──────────────
//
// This screen used to list rows from `push_tokens`, and its subtitle carefully explained that it
// therefore showed only devices that had granted notification permission. Reported:
//
//   "я знаю, что на одном аккаунте может пользоваться и я, и мой друг... Но всё равно я смотрю
//    в настройках, и показывается, что только я, то есть моё устройство. Хотя это не так."
//
// Two people share the account and the screen showed one device. A carefully-worded subtitle does not
// make that a working feature — a Devices screen that cannot show the other person on your account
// has failed at the only thing it exists for. Documenting the limitation instead of removing it was
// the wrong call.
//
// It now reads `GET /v1/devices`, backed by the `devices` table (migration 0007), which records a row
// at SIGN-IN. Every install that has signed into the account appears, whatever it decided about
// notifications.
//
// ── WHAT "DISCONNECT" ACTUALLY DOES, STATED PRECISELY ──────────────────────
//
// Two effects with two different timings, and the copy says so rather than implying one:
//
//   immediately        the device's push token row is deleted, so the notification fan-out stops
//                      reaching it. This does not depend on that device doing anything.
//   next time it runs  it heartbeats, the server answers `revoked: true`, and it signs itself out.
//
// The reason sign-out is not instant is structural: token verification in the Worker is pure HMAC
// with zero database reads per request, so enforcing revocation on the request path would add a D1
// read to every call in the app. The heartbeat already talks to the database, so that is where the
// news is delivered. A device that never reaches the network keeps what it has cached until it does —
// which is true of every token-based session, and is why the footnote says it out loud.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useT, useI18nStore } from '../../src/i18n/store';
import { apiGet, apiPost } from '../../src/services/apiClient';
import { getInstallId } from '../../src/services/installId';
import { formatDaySeparator } from '../../src/utils/chatDaySeparators';
import { triggerHaptic } from '../../src/utils/haptics';
import { showToast } from '../../src/store/toastStore';

interface DeviceRow {
  install_id: string;
  platform: string | null;
  model: string | null;
  os_version: string | null;
  app_version: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export default function DevicesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // The date formatter is locale-aware, so labels follow the APP language rather than the OS one —
  // the user reads the app in English on a Russian phone.
  const locale = useI18nStore((s) => s.locale);

  const [rows, setRows] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Read once per mount: it is a synchronous MMKV read and cannot change while this screen is open.
  // Unlike the push token this used to compare against, it is ALWAYS present — which is what lets the
  // "this device" marker be reliable instead of silently absent whenever notifications were declined.
  const [myInstallId] = useState(() => getInstallId());

  const load = useCallback(async () => {
    setError(false);
    setRows(null);
    const { data, error: err } = await apiGet<DeviceRow[]>('/v1/devices');
    // `apiGet` resolves with an error string rather than throwing, so this is the whole failure
    // surface. An empty array is a legitimate success and must not read as an error — hence a separate
    // flag rather than treating `!data` as failure.
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

  /** Platform + model, falling back through what the row actually has. */
  const deviceTitle = useCallback(
    (row: DeviceRow): string => {
      if (row.model) return row.model;
      if (row.platform === 'ios') return t('devices.platform_ios');
      if (row.platform === 'android') return t('devices.platform_android');
      return t('devices.platform_unknown');
    },
    [t],
  );

  const dateLabel = useCallback(
    (iso: string | null): string | null => {
      if (!iso) return null;
      // Returns null for an unparseable timestamp, which the caller renders as nothing rather than as
      // a broken date.
      return formatDaySeparator(iso, Date.now(), locale, t);
    },
    [locale, t],
  );

  const revoke = useCallback(
    (row: DeviceRow) => {
      const isCurrent = row.install_id === myInstallId;
      triggerHaptic('medium');
      Alert.alert(
        t('devices.revoke_title'),
        // Two messages, because the consequence genuinely differs. Removing another device signs that
        // person out; removing THIS one signs you out of the app you are holding, and a confirmation
        // that did not say so would be a trap.
        isCurrent ? t('devices.revoke_current_msg') : t('devices.revoke_msg'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('devices.revoke_action'),
            style: 'destructive',
            onPress: async () => {
              setBusyId(row.install_id);
              await apiPost('/v1/devices/revoke', { installId: row.install_id });
              setBusyId(null);
              if (isCurrent) {
                // Do not wait for our own heartbeat to tell us what we just did. Same teardown the
                // heartbeat performs, so there is one path rather than two.
                try {
                  const { heartbeatDevice } = await import('../../src/services/deviceRegistry');
                  await heartbeatDevice({ force: true });
                } catch {}
                return;
              }
              // Optimistic removal. The endpoint is idempotent and scoped by `user_id`, so if the call
              // failed the row reappears on the next open — a truthful outcome, and better than
              // blocking the list behind a spinner.
              setRows((prev) => (prev ? prev.filter((r) => r.install_id !== row.install_id) : prev));
              showToast(t('devices.revoked'), 'trash-2');
            },
          },
        ],
      );
    },
    [myInstallId, t],
  );

  const containerStyle: ViewStyle = { flex: 1, backgroundColor: theme.colors.background.primary };
  const cardStyle: ViewStyle = {
    backgroundColor: theme.colors.background.elevated,
    borderRadius: 24,
    overflow: 'hidden',
  };

  return (
    <View style={containerStyle}>
      {/* Header — same geometry as device-key.tsx, plus a refresh affordance. */}
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
              const isCurrent = row.install_id === myInstallId;
              const isBusy = busyId === row.install_id;
              // Platform accent rather than one shared colour, so two rows are distinguishable before
              // reading either label.
              const tint = row.platform === 'ios' ? '#0A84FF' : row.platform === 'android' ? '#30D158' : '#8E8E93';
              const seen = dateLabel(row.last_seen_at);
              const added = dateLabel(row.first_seen_at);
              return (
                <View
                  key={row.install_id}
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
                        {deviceTitle(row)}
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
                    {/* Last active is the line that answers "is someone else on my account RIGHT
                        NOW", which is the question this screen is opened to answer. "Added" is
                        secondary and only shown when it differs, so a device that signed in today
                        does not print the same date twice. */}
                    <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>
                      {seen ? t('devices.last_active', undefined, { date: seen }) : t('devices.registered_unknown')}
                      {added && added !== seen ? ` · ${t('devices.registered', undefined, { date: added })}` : ''}
                    </Text>
                    {row.os_version || row.app_version ? (
                      <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 10 }}>
                        {[row.os_version, row.app_version ? `v${row.app_version}` : null].filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
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
                      <Feather name="log-out" size={17} color={theme.colors.status.error} />
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* The footnote about timing. Below the list rather than in the subtitle, because it is the
            thing someone wants to read at the moment they have just tapped disconnect and are
            wondering whether it worked. */}
        {rows !== null && !error && rows.length > 0 ? (
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
