/**
 * Full perf monitor panel — opens when the user taps the floating bubble.
 *
 * Shows:
 * - Live JS / UI FPS values + worst-of-last-5-seconds
 * - A scrollable log of recent navigation transitions, slow-frame markers,
 *   and any custom marks recorded via `perfMonitor.mark(...)`
 * - Toggle to enable/disable the bubble itself
 * - Clear-events button
 *
 * Designed to stay readable in both light + dark themes by using the app's
 * theme colours rather than hardcoded greys.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';
import { perfMonitor, type PerfEvent, type PerfSnapshot } from '../../services/perfMonitor';
import { useSettingsStore } from '../../store/settingsStore';
import { useT } from '../../i18n/store';

interface Props {
  onClose: () => void;
}

export function PerfMonitorPanel({ onClose }: Props) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [snap, setSnap] = useState<PerfSnapshot>(() => perfMonitor.snapshot());
  const enabled = useSettingsStore((s) => s.perfMonitorEnabled);
  const setEnabled = useSettingsStore((s) => s.setPerfMonitorEnabled);

  useEffect(() => {
    let last = 0;
    const unsub = perfMonitor.subscribe((s) => {
      const now = Date.now();
      if (now - last < 480) return;
      last = now;
      setSnap(s);
    });
    return unsub;
  }, []);

  const fpsColor = (fps: number) =>
    fps >= 50 ? '#22c55e' : fps >= 30 ? '#f59e0b' : '#ef4444';

  return (
    <View
      style={[styles.root, { backgroundColor: theme.colors.background.primary, paddingTop: insets.top + 4 }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.text.primary }]}>
          {t('perf.title', 'Performance monitor')}
        </Text>
        <TouchableOpacity onPress={onClose} hitSlop={10}>
          <Text style={[styles.close, { color: theme.colors.text.secondary }]}>
            {t('common.close', 'Close')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        style={{ flex: 1 }}
      >
        {/* Live FPS */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text.tertiary }]}>
            {t('perf.live', 'Live')}
          </Text>
          <View style={styles.fpsRow}>
            <View style={[styles.fpsCell, { backgroundColor: theme.colors.background.secondary }]}>
              <Text style={[styles.fpsLabel, { color: theme.colors.text.tertiary }]}>
                {t('perf.js_thread', 'JS thread')}
              </Text>
              <Text style={[styles.fpsValue, { color: fpsColor(snap.jsFps) }]}>{snap.jsFps}</Text>
              <Text style={[styles.fpsSub, { color: theme.colors.text.tertiary }]}>
                {t('perf.min_5s', 'min 5s')}: {snap.jsP1Min}
              </Text>
            </View>
            <View style={[styles.fpsCell, { backgroundColor: theme.colors.background.secondary }]}>
              <Text style={[styles.fpsLabel, { color: theme.colors.text.tertiary }]}>
                {t('perf.ui_thread', 'UI thread')}
              </Text>
              <Text style={[styles.fpsValue, { color: fpsColor(snap.uiFps) }]}>{snap.uiFps}</Text>
              <Text style={[styles.fpsSub, { color: theme.colors.text.tertiary }]}>
                {t('perf.min_5s', 'min 5s')}: {snap.uiP1Min}
              </Text>
            </View>
          </View>
        </View>

        {/* Settings */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text.tertiary }]}>
            {t('perf.settings', 'Settings')}
          </Text>
          <View style={[styles.row, { backgroundColor: theme.colors.background.secondary }]}>
            <Text style={[styles.rowLabel, { color: theme.colors.text.primary }]}>
              {t('perf.bubble_enabled', 'Show bubble')}
            </Text>
            <Switch value={enabled} onValueChange={setEnabled} />
          </View>
          <TouchableOpacity
            style={[styles.row, { backgroundColor: theme.colors.background.secondary }]}
            onPress={() => perfMonitor.clearEvents()}
          >
            <Text style={[styles.rowLabel, { color: theme.colors.text.primary }]}>
              {t('perf.clear_log', 'Clear log')}
            </Text>
            <Text style={{ color: theme.colors.text.tertiary }}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Event log */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text.tertiary }]}>
            {t('perf.events', 'Events')} · {snap.events.length}
          </Text>
          {snap.events.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: theme.colors.background.secondary }]}>
              <Text style={{ color: theme.colors.text.tertiary }}>
                {t('perf.no_events', 'No events yet — navigate around the app to see metrics.')}
              </Text>
            </View>
          ) : (
            // Newest first so the user sees the freshest activity at the top.
            snap.events
              .slice()
              .reverse()
              .map((ev, i) => <EventRow key={`${ev.ts}-${i}`} event={ev} />)
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function EventRow({ event }: { event: PerfEvent }) {
  const theme = useTheme();
  const tint =
    event.type === 'slow' ? '#ef4444' : event.type === 'nav' ? '#3b82f6' : theme.colors.text.secondary;
  const time = new Date(event.ts).toLocaleTimeString([], { hour12: false });
  return (
    <View style={[styles.eventRow, { backgroundColor: theme.colors.background.secondary }]}>
      <Text style={[styles.eventTs, { color: theme.colors.text.tertiary }]}>{time}</Text>
      <Text style={[styles.eventType, { color: tint }]}>{event.type}</Text>
      <Text
        numberOfLines={1}
        style={[styles.eventLabel, { color: theme.colors.text.primary }]}
      >
        {event.label}
      </Text>
      {event.durationMs != null && (
        <Text
          style={[
            styles.eventDur,
            { color: event.durationMs > 300 ? '#ef4444' : theme.colors.text.tertiary },
          ]}
        >
          {event.durationMs}ms
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 17, fontWeight: '700' },
  close: { fontSize: 15 },
  section: { paddingHorizontal: 16, marginTop: 16 },
  sectionTitle: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  fpsRow: { flexDirection: 'row', gap: 12 },
  fpsCell: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  fpsLabel: { fontSize: 12 },
  fpsValue: {
    fontSize: 36,
    fontWeight: '800',
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  fpsSub: { fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  rowLabel: { fontSize: 15 },
  empty: {
    padding: 16,
    borderRadius: 12,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 6,
    gap: 8,
  },
  eventTs: { width: 70, fontSize: 11, fontVariant: ['tabular-nums'] },
  eventType: { width: 44, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  eventLabel: { flex: 1, fontSize: 13 },
  eventDur: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
