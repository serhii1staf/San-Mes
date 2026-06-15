/**
 * Full perf monitor panel — opens when the user taps the floating bubble.
 *
 * Layout, top to bottom:
 *  1. Header (title + Snapshot button + Close)
 *  2. Live gauges row (JS FPS, UI FPS, pending image decodes, last long task)
 *  3. Filter chip row (NAV / MOUNT / INPUT / IMG / LONG / UI / MARK)
 *  4. Search box (debounced 200 ms, filters by event label)
 *  5. Settings toggles + clear button
 *  6. Errors section (always shown, separate from filtered events)
 *  7. Route-grouped event list — collapsible per route, current route is
 *     auto-expanded so the user lands on the most relevant data
 *
 * Designed to stay readable in both light + dark themes by using the app's
 * theme colours rather than hardcoded greys.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';
import { perfMonitor, type PerfEvent, type PerfEventKind, type PerfSnapshot, type RouteHotspot } from '../../services/perfMonitor';
import { useSettingsStore } from '../../store/settingsStore';
import { useT } from '../../i18n/store';

interface Props {
  onClose: () => void;
}

// Order in which the chip row renders. Mirrors the most-to-least useful
// kinds when triaging perceived lag.
const FILTER_KINDS: PerfEventKind[] = ['NAV', 'MOUNT', 'INPUT', 'IMG', 'LONG', 'UI', 'MARK'];

// Visual tint per kind. Kept small so the panel reads quickly at a glance.
function tintForKind(kind: PerfEventKind, theme: any): string {
  switch (kind) {
    case 'NAV':
      return '#3b82f6';
    case 'MOUNT':
      return '#a855f7';
    case 'INPUT':
      return '#06b6d4';
    case 'IMG':
      return '#10b981';
    case 'LONG':
      return '#ef4444';
    case 'UI':
      return '#f59e0b';
    case 'INTER':
      return '#8b5cf6';
    case 'ERROR':
      return '#ef4444';
    case 'MARK':
    default:
      return theme.colors.text.secondary;
  }
}

export function PerfMonitorPanel({ onClose }: Props) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [snap, setSnap] = useState<PerfSnapshot>(() => perfMonitor.snapshot());
  const enabled = useSettingsStore((s) => s.perfMonitorEnabled);
  const setEnabled = useSettingsStore((s) => s.setPerfMonitorEnabled);
  const filters = useSettingsStore((s) => s.perfMonitorFilters);
  const setFilter = useSettingsStore((s) => s.setPerfMonitorFilter);

  // Debounced search query. The raw input updates state on every keystroke
  // so the input feels native; the actual list filter reads `appliedQuery`
  // which lags the input by ~200 ms.
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setAppliedQuery(searchQuery.trim().toLowerCase()), 200);
    return () => clearTimeout(h);
  }, [searchQuery]);

  // Per-route collapse state. Keys are route strings; missing key = collapsed
  // for non-current routes. The current route is always expanded by default
  // (handled below).
  const [expandedRoutes, setExpandedRoutes] = useState<Record<string, boolean>>({});
  const toggleRoute = (route: string) =>
    setExpandedRoutes((prev) => ({ ...prev, [route]: !prev[route] }));

  // Set of long-task event timestamps the user has tapped to expand. Keyed
  // by ts since events are otherwise unidentified.
  const [expandedLong, setExpandedLong] = useState<Record<number, boolean>>({});
  const toggleLong = (ts: number) =>
    setExpandedLong((prev) => ({ ...prev, [ts]: !prev[ts] }));

  // Hotspot rows the user expanded for a detailed per-route breakdown.
  const [expandedHotspots, setExpandedHotspots] = useState<Record<string, boolean>>({});
  const toggleHotspot = (route: string) =>
    setExpandedHotspots((prev) => ({ ...prev, [route]: !prev[route] }));

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

  // Filtered, route-grouped events. Errors are split out and rendered above.
  const { errorEvents, groupedEvents } = useMemo(() => {
    const errs: PerfEvent[] = [];
    const groups: Record<string, PerfEvent[]> = {};
    const order: string[] = [];
    for (const ev of snap.events) {
      if (ev.kind === 'ERROR') {
        errs.push(ev);
        continue;
      }
      // Filter chips. Missing key = on (default-on behaviour).
      if (filters[ev.kind] === false) continue;
      if (
        appliedQuery &&
        !ev.label.toLowerCase().includes(appliedQuery) &&
        !(ev.route || '').toLowerCase().includes(appliedQuery)
      ) {
        continue;
      }
      const route = ev.route || '(unknown)';
      if (!groups[route]) {
        groups[route] = [];
        order.push(route);
      }
      groups[route].push(ev);
    }
    return { errorEvents: errs, groupedEvents: { groups, order } };
  }, [snap.events, filters, appliedQuery]);

  // Sort routes by most-recent event so the active route surfaces at top.
  const orderedRoutes = useMemo(() => {
    const { order, groups } = groupedEvents;
    return order.slice().sort((a, b) => {
      const aLast = groups[a][groups[a].length - 1]?.ts || 0;
      const bLast = groups[b][groups[b].length - 1]?.ts || 0;
      return bLast - aLast;
    });
  }, [groupedEvents]);

  const onSnapshot = async () => {
    try {
      const payload = {
        capturedAt: snap.capturedAt,
        currentRoute: snap.currentRoute,
        fps: { js: snap.jsFps, ui: snap.uiFps, jsP1Min: snap.jsP1Min, uiP1Min: snap.uiP1Min },
        pendingDecodes: snap.pendingDecodes,
        lastLongTaskMs: snap.lastLongTaskMs,
        hotspots: snap.hotspots,
        recentEvents: snap.events,
      };
      await Clipboard.setStringAsync(JSON.stringify(payload, null, 2));
      Alert.alert(
        t('perf.copied_title', 'Copied'),
        t('perf.snapshot_copied', 'Snapshot JSON copied to clipboard.'),
      );
    } catch {}
  };

  return (
    <View
      style={[styles.root, { backgroundColor: theme.colors.background.primary, paddingTop: insets.top + 4 }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.text.primary }]}>
          {t('perf.title', 'Performance monitor')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <TouchableOpacity onPress={onSnapshot} hitSlop={10}>
            <Text style={{ color: theme.colors.accent.primary, fontWeight: '600' }}>
              {t('perf.snapshot', 'Snapshot')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Text style={[styles.close, { color: theme.colors.text.secondary }]}>
              {t('common.close', 'Close')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        style={{ flex: 1 }}
      >
        {/* Live gauges */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text.tertiary }]}>
            {t('perf.live', 'Live')}
          </Text>
          <View style={styles.gaugeRow}>
            <View style={[styles.gaugeCell, { backgroundColor: theme.colors.background.secondary }]}>
              <Text style={[styles.gaugeLabel, { color: theme.colors.text.tertiary }]}>
                {t('perf.js_thread', 'JS')}
              </Text>
              <Text style={[styles.gaugeValue, { color: fpsColor(snap.jsFps) }]}>{snap.jsFps}</Text>
              <Text style={[styles.gaugeSub, { color: theme.colors.text.tertiary }]}>
                {t('perf.min_5s', 'min 5s')}: {snap.jsP1Min}
              </Text>
            </View>
            <View style={[styles.gaugeCell, { backgroundColor: theme.colors.background.secondary }]}>
              <Text style={[styles.gaugeLabel, { color: theme.colors.text.tertiary }]}>
                {t('perf.ui_thread', 'UI')}
              </Text>
              <Text style={[styles.gaugeValue, { color: fpsColor(snap.uiFps) }]}>{snap.uiFps}</Text>
              <Text style={[styles.gaugeSub, { color: theme.colors.text.tertiary }]}>
                {t('perf.min_5s', 'min 5s')}: {snap.uiP1Min}
              </Text>
            </View>
            <View style={[styles.gaugeCell, { backgroundColor: theme.colors.background.secondary }]}>
              <Text style={[styles.gaugeLabel, { color: theme.colors.text.tertiary }]}>
                {t('perf.pending_decodes', 'IMG')}
              </Text>
              <Text
                style={[
                  styles.gaugeValue,
                  { color: snap.pendingDecodes > 6 ? '#ef4444' : theme.colors.text.primary },
                ]}
              >
                {snap.pendingDecodes}
              </Text>
              <Text style={[styles.gaugeSub, { color: theme.colors.text.tertiary }]}>
                {t('perf.in_flight', 'in flight')}
              </Text>
            </View>
            <View style={[styles.gaugeCell, { backgroundColor: theme.colors.background.secondary }]}>
              <Text style={[styles.gaugeLabel, { color: theme.colors.text.tertiary }]}>
                {t('perf.last_long', 'LONG')}
              </Text>
              <Text
                style={[
                  styles.gaugeValue,
                  {
                    color:
                      snap.lastLongTaskMs > 300
                        ? '#ef4444'
                        : snap.lastLongTaskMs > 0
                        ? '#f59e0b'
                        : theme.colors.text.primary,
                  },
                ]}
              >
                {snap.lastLongTaskMs || 0}
              </Text>
              <Text style={[styles.gaugeSub, { color: theme.colors.text.tertiary }]}>
                {t('perf.ms_label', 'ms')}
              </Text>
            </View>
          </View>
          {snap.currentRoute ? (
            <Text style={{ color: theme.colors.text.tertiary, fontSize: 11, marginTop: 6, paddingHorizontal: 4 }}>
              {t('perf.current_route', 'Route')}: {snap.currentRoute}
            </Text>
          ) : null}
        </View>

        {/* Hotspots — the headline feature: a worst-first ranking of which
            SCREENS are janky, so the user knows exactly where to optimise
            instead of scrolling a raw event log. Each row tells the story
            in one line (long-tasks, worst fps, slow mounts); tap to expand
            the full breakdown. */}
        <View style={[styles.section, { marginTop: 14 }]}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 4,
              marginBottom: 8,
            }}
          >
            <Text style={[styles.sectionTitle, { color: theme.colors.text.tertiary, marginBottom: 0 }]}>
              {t('perf.hotspots', 'Hotspots — where it drops')}
            </Text>
            {snap.hotspots.length > 0 ? (
              <TouchableOpacity onPress={() => perfMonitor.clearEvents()} hitSlop={8}>
                <Text style={{ color: theme.colors.accent.primary, fontSize: 12, fontWeight: '600' }}>
                  {t('perf.reset', 'Reset')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {snap.hotspots.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: theme.colors.background.secondary }]}>
              <Text style={{ color: theme.colors.text.tertiary }}>
                {t('perf.no_hotspots', 'No jank recorded yet. Scroll around the app and the worst screens will surface here.')}
              </Text>
            </View>
          ) : (
            snap.hotspots
              .slice(0, 8)
              .map((h, idx) => (
                <HotspotRow
                  key={h.route}
                  hotspot={h}
                  rank={idx + 1}
                  isCurrent={h.route === snap.currentRoute}
                  isExpanded={!!expandedHotspots[h.route]}
                  onToggle={() => toggleHotspot(h.route)}
                />
              ))
          )}
        </View>

        {/* Filter chips */}
        <View style={[styles.section, { marginTop: 14 }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text.tertiary }]}>
            {t('perf.filters', 'Filters')}
          </Text>
          <View style={styles.chipRow}>
            {FILTER_KINDS.map((kind) => {
              const on = filters[kind] !== false;
              const tint = tintForKind(kind, theme);
              return (
                <TouchableOpacity
                  key={kind}
                  onPress={() => setFilter(kind, !on)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: on ? tint + '22' : theme.colors.background.secondary,
                      borderColor: on ? tint : theme.colors.border.light,
                    },
                  ]}
                >
                  <Text style={{ color: on ? tint : theme.colors.text.tertiary, fontSize: 12, fontWeight: '700' }}>
                    {kind}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Search */}
        <View style={[styles.section, { marginTop: 14 }]}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('perf.search_placeholder', 'Search events…')}
            placeholderTextColor={theme.colors.text.tertiary}
            style={[
              styles.search,
              {
                backgroundColor: theme.colors.background.secondary,
                color: theme.colors.text.primary,
                borderColor: theme.colors.border.light,
              },
            ]}
          />
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

        {/* Errors — split out separately and shown first because crashes
            are the highest-signal events when the user is debugging. The
            copy buttons let them paste the stack into a chat / email when
            they don't have direct Sentry dashboard access. */}
        {errorEvents.length > 0 ? (
          (() => {
            const reversed = errorEvents.slice().reverse();
            const allText = reversed.map((ev) => formatErrorForCopy(ev)).join('\n\n');
            return (
              <View style={styles.section}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 4,
                    marginBottom: 8,
                  }}
                >
                  <Text style={[styles.sectionTitle, { color: '#ef4444', marginBottom: 0 }]}>
                    {t('perf.errors', 'Errors')} · {errorEvents.length}
                  </Text>
                  <TouchableOpacity
                    onPress={async () => {
                      try {
                        await Clipboard.setStringAsync(allText);
                        Alert.alert(
                          t('perf.copied_title', 'Copied'),
                          t('perf.copied_all', 'All errors copied to clipboard.'),
                        );
                      } catch {}
                    }}
                  >
                    <Text style={{ color: theme.colors.accent.primary, fontSize: 13, fontWeight: '600' }}>
                      {t('perf.copy_all', 'Copy all')}
                    </Text>
                  </TouchableOpacity>
                </View>
                {reversed.map((ev, i) => (
                  <ErrorRow key={`${ev.ts}-${i}`} event={ev} />
                ))}
              </View>
            );
          })()
        ) : null}

        {/* Event list — grouped by route. Current route auto-expanded. */}
        <View style={styles.section}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 4,
              marginBottom: 8,
            }}
          >
            <Text style={[styles.sectionTitle, { color: theme.colors.text.tertiary, marginBottom: 0 }]}>
              {t('perf.events', 'Events')} · {snap.events.length}
            </Text>
            {snap.events.length > 0 && (
              <TouchableOpacity
                onPress={async () => {
                  try {
                    const reversed = snap.events.slice().reverse();
                    const text = reversed
                      .map((ev) => {
                        const ts = new Date(ev.ts).toISOString();
                        const dur = ev.durationMs != null ? ` ${ev.durationMs}ms` : '';
                        const route = ev.route ? ` [${ev.route}]` : '';
                        const stack = ev.stack ? `\n${ev.stack}` : '';
                        return `[${ts}] ${ev.kind}${route} ${ev.label}${dur}${stack}`;
                      })
                      .join('\n');
                    await Clipboard.setStringAsync(text);
                    Alert.alert(
                      t('perf.copied_title', 'Copied'),
                      t('perf.copied_log', 'Full log copied to clipboard.'),
                    );
                  } catch {}
                }}
              >
                <Text style={{ color: theme.colors.accent.primary, fontSize: 13, fontWeight: '600' }}>
                  {t('perf.copy_all', 'Copy all')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {orderedRoutes.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: theme.colors.background.secondary }]}>
              <Text style={{ color: theme.colors.text.tertiary }}>
                {t('perf.no_events', 'No events match the current filter.')}
              </Text>
            </View>
          ) : (
            orderedRoutes.map((route) => {
              const list = groupedEvents.groups[route];
              // Current route is auto-expanded unless the user explicitly
              // collapsed it; other routes default to collapsed.
              const isCurrent = route === snap.currentRoute;
              const explicit = expandedRoutes[route];
              const expanded =
                explicit === undefined ? isCurrent : explicit;
              return (
                <View
                  key={route}
                  style={[styles.routeGroup, { backgroundColor: theme.colors.background.secondary }]}
                >
                  <TouchableOpacity
                    onPress={() => toggleRoute(route)}
                    style={styles.routeHeader}
                  >
                    <Text
                      numberOfLines={1}
                      style={{ flex: 1, color: theme.colors.text.primary, fontWeight: '700', fontSize: 13 }}
                    >
                      {route}
                      {isCurrent ? '  ●' : ''}
                    </Text>
                    <Text style={{ color: theme.colors.text.tertiary, fontSize: 12, marginRight: 6 }}>
                      {list.length}
                    </Text>
                    <Text style={{ color: theme.colors.text.tertiary, fontSize: 14 }}>
                      {expanded ? '▾' : '▸'}
                    </Text>
                  </TouchableOpacity>
                  {expanded
                    ? list
                        .slice()
                        .reverse()
                        .map((ev, i) => (
                          <EventRow
                            key={`${ev.ts}-${i}`}
                            event={ev}
                            isExpanded={!!expandedLong[ev.ts]}
                            onToggleExpand={() => toggleLong(ev.ts)}
                          />
                        ))
                    : null}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/** Severity colour for a hotspot score. Tuned so a single visible freeze
 *  (one long task ≈ score 4-7) already reads amber, and a screen with
 *  repeated stalls reads red. */
function severityColor(score: number): string {
  if (score >= 12) return '#ef4444';
  if (score >= 5) return '#f59e0b';
  if (score > 0) return '#eab308';
  return '#22c55e';
}

function HotspotRow({
  hotspot,
  rank,
  isCurrent,
  isExpanded,
  onToggle,
}: {
  hotspot: RouteHotspot;
  rank: number;
  isCurrent: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const color = severityColor(hotspot.score);
  // One-line summary built from whichever signals actually fired, so the
  // row stays terse on screens with only one kind of problem.
  const bits: string[] = [];
  if (hotspot.longTaskCount > 0) {
    bits.push(`${hotspot.longTaskCount}× freeze (${hotspot.worstLongMs}ms)`);
  }
  if (hotspot.worstFps < 60) bits.push(`${hotspot.worstFps}fps min`);
  if (hotspot.jankCount > 0) bits.push(`${hotspot.jankCount}× <30fps`);
  if (hotspot.worstMountMs > 200) bits.push(`mount ${hotspot.worstMountMs}ms`);
  const summary = bits.length ? bits.join(' · ') : t('perf.smooth', 'smooth');
  return (
    <View style={[styles.hotspotCard, { backgroundColor: theme.colors.background.secondary }]}>
      <TouchableOpacity onPress={onToggle} style={styles.hotspotHeader} activeOpacity={0.7}>
        {/* Severity rail */}
        <View style={[styles.hotspotRail, { backgroundColor: color }]} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: theme.colors.text.primary, fontWeight: '700', fontSize: 13 }}>
            {rank}. {hotspot.route}
            {isCurrent ? '  ●' : ''}
          </Text>
          <Text numberOfLines={1} style={{ color: theme.colors.text.tertiary, fontSize: 11, marginTop: 2 }}>
            {summary}
          </Text>
        </View>
        <View style={[styles.scorePill, { backgroundColor: color + '22' }]}>
          <Text style={{ color, fontWeight: '800', fontSize: 13, fontVariant: ['tabular-nums'] }}>
            {hotspot.score}
          </Text>
        </View>
        <Text style={{ color: theme.colors.text.tertiary, fontSize: 14, marginLeft: 6 }}>
          {isExpanded ? '▾' : '▸'}
        </Text>
      </TouchableOpacity>
      {isExpanded ? (
        <View style={[styles.hotspotDetail, { borderColor: theme.colors.border.light }]}>
          <HotspotStat label={t('perf.hs_long', 'Freezes (long tasks)')} value={`${hotspot.longTaskCount}`} />
          <HotspotStat label={t('perf.hs_worst_long', 'Worst freeze')} value={`${hotspot.worstLongMs} ms`} danger={hotspot.worstLongMs > 300} />
          <HotspotStat label={t('perf.hs_avg_long', 'Avg freeze')} value={`${hotspot.avgLongMs} ms`} />
          <HotspotStat label={t('perf.hs_worst_fps', 'Worst FPS')} value={`${hotspot.worstFps}`} danger={hotspot.worstFps < 30} />
          <HotspotStat label={t('perf.hs_jank', 'Sub-30fps samples')} value={`${hotspot.jankCount}`} />
          <HotspotStat label={t('perf.hs_mounts', 'Mounts')} value={`${hotspot.mountCount}`} />
          <HotspotStat label={t('perf.hs_worst_mount', 'Worst mount')} value={`${hotspot.worstMountMs} ms`} danger={hotspot.worstMountMs > 400} />
          <HotspotStat label={t('perf.hs_imgs', 'Image decodes')} value={`${hotspot.imgCount}`} />
        </View>
      ) : null}
    </View>
  );
}

function HotspotStat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.hotspotStatRow}>
      <Text style={{ color: theme.colors.text.tertiary, fontSize: 12 }}>{label}</Text>
      <Text
        style={{
          color: danger ? '#ef4444' : theme.colors.text.primary,
          fontSize: 12,
          fontWeight: '600',
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function EventRow({
  event,
  isExpanded,
  onToggleExpand,
}: {
  event: PerfEvent;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const tint = tintForKind(event.kind, theme);
  const time = new Date(event.ts).toLocaleTimeString([], { hour12: false });
  // Long-task rows are tappable to reveal their captured context.
  const hasContext = event.kind === 'LONG' && !!event.context;
  return (
    <View>
      <TouchableOpacity
        disabled={!hasContext}
        onPress={onToggleExpand}
        activeOpacity={hasContext ? 0.7 : 1}
        style={[styles.eventRow, { backgroundColor: theme.colors.background.elevated || theme.colors.background.secondary }]}
      >
        <Text style={[styles.eventTs, { color: theme.colors.text.tertiary }]}>{time}</Text>
        <Text style={[styles.eventKind, { color: tint }]}>{event.kind}</Text>
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
        {hasContext ? (
          <Text style={{ color: theme.colors.text.tertiary, marginLeft: 6 }}>
            {isExpanded ? '▾' : '▸'}
          </Text>
        ) : null}
      </TouchableOpacity>
      {hasContext && isExpanded && event.context ? (
        <View style={[styles.contextBlock, { borderColor: theme.colors.border.light }]}>
          <Text style={{ color: theme.colors.text.secondary, fontSize: 11 }}>
            {t('perf.ctx_route', 'route')}: {event.context.route}
          </Text>
          <Text style={{ color: theme.colors.text.secondary, fontSize: 11 }}>
            {t('perf.ctx_pending', 'pending decodes')}: {event.context.pendingDecodes}
          </Text>
          <Text style={{ color: theme.colors.text.secondary, fontSize: 11 }}>
            {t('perf.ctx_since_nav', 'since nav')}: {event.context.msSinceNav}ms
          </Text>
          {event.context.recentMarks.length > 0 ? (
            <Text
              style={{ color: theme.colors.text.tertiary, fontSize: 11, marginTop: 4 }}
            >
              {t('perf.ctx_recent', 'recent')}:
            </Text>
          ) : null}
          {event.context.recentMarks.map((m, i) => (
            <Text
              key={i}
              numberOfLines={1}
              style={{ color: theme.colors.text.secondary, fontSize: 11, fontFamily: 'Courier' }}
            >
              · {m.kind} {m.label}
              {m.durationMs != null ? ` ${m.durationMs}ms` : ''} ({m.agoMs}ms ago)
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function formatErrorForCopy(ev: PerfEvent): string {
  const time = new Date(ev.ts).toISOString();
  const lines = [`[${time}] ${ev.label}`];
  if (ev.stack) lines.push(ev.stack);
  return lines.join('\n');
}

function ErrorRow({ event }: { event: PerfEvent }) {
  const theme = useTheme();
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const time = new Date(event.ts).toLocaleTimeString([], { hour12: false });
  return (
    <View
      style={[
        styles.errorRow,
        { backgroundColor: theme.colors.background.secondary, borderLeftColor: '#ef4444' },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.eventTs, { color: theme.colors.text.tertiary, width: 70 }]}>
          {time}
        </Text>
        <Text
          numberOfLines={expanded ? undefined : 2}
          style={{ flex: 1, color: theme.colors.text.primary, fontSize: 13 }}
        >
          {event.label}
        </Text>
      </View>
      {expanded && event.stack ? (
        <Text
          selectable
          style={{
            marginTop: 6,
            color: theme.colors.text.secondary,
            fontSize: 11,
            fontFamily: 'Courier',
          }}
        >
          {event.stack}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 6 }}>
        <TouchableOpacity onPress={() => setExpanded((v) => !v)}>
          <Text style={{ color: theme.colors.accent.primary, fontSize: 12, fontWeight: '600' }}>
            {expanded ? t('perf.collapse', 'Collapse') : t('perf.expand', 'Expand')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={async () => {
            try {
              await Clipboard.setStringAsync(formatErrorForCopy(event));
              Alert.alert(
                t('perf.copied_title', 'Copied'),
                t('perf.copied_one', 'Error copied to clipboard.'),
              );
            } catch {}
          }}
        >
          <Text style={{ color: theme.colors.accent.primary, fontSize: 12, fontWeight: '600' }}>
            {t('perf.copy', 'Copy')}
          </Text>
        </TouchableOpacity>
      </View>
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
  gaugeRow: { flexDirection: 'row', gap: 8 },
  gaugeCell: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minWidth: 64,
  },
  gaugeLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  gaugeValue: {
    fontSize: 24,
    fontWeight: '800',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  gaugeSub: { fontSize: 10, marginTop: 1, fontVariant: ['tabular-nums'] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  search: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
  },
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
  routeGroup: {
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  routeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 4,
    gap: 8,
  },
  eventTs: { width: 64, fontSize: 10, fontVariant: ['tabular-nums'] },
  eventKind: { width: 44, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  eventLabel: { flex: 1, fontSize: 12 },
  eventDur: { fontSize: 11, fontVariant: ['tabular-nums'] },
  contextBlock: {
    marginTop: 4,
    marginLeft: 8,
    marginBottom: 4,
    paddingLeft: 10,
    borderLeftWidth: 2,
  },
  errorRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 8,
    borderLeftWidth: 3,
  },
  hotspotCard: {
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  hotspotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingRight: 10,
  },
  hotspotRail: {
    width: 4,
    alignSelf: 'stretch',
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    marginRight: 10,
  },
  scorePill: {
    minWidth: 34,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hotspotDetail: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    paddingTop: 4,
    marginLeft: 14,
    borderLeftWidth: 1,
  },
  hotspotStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
});
