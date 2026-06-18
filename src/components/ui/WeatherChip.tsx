import React, { useEffect, useState, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { useSettingsStore } from '../../store/settingsStore';
import { useLiquidGlassActive, NativeGlassView } from './LiquidGlass';
import {
  getCurrentWeather,
  emojiForWeatherCode,
  WeatherSnapshot,
} from '../../services/weather/openMeteo';
import { triggerHaptic } from '../../utils/haptics';

// Small "🌤️ +12° Москва" chip rendered next to the messages-tab title when
// the user opted in to the optional weather feature. Tap → settings/weather.
//
// The chip is intentionally minimal:
//   - Only mounts when `weatherEnabled` AND a city has been picked. While the
//     feature is off (default) the component returns null and pays zero JS
//     cost — the parent tree doesn't even reach into useEffect.
//   - Fetches once on mount, then refreshes every 30 min via the underlying
//     30-min MMKV cache (so subsequent calls are local). No background timer
//     while the screen is unmounted.
//   - Hides itself silently on fetch failure rather than showing a spinner —
//     the user already opted in, so a chip that flickers in and out would be
//     more annoying than a brief absence on a flaky network.
export function WeatherChip() {
  const theme = useTheme();
  const enabled = useSettingsStore((s) => s.weatherEnabled);
  const cityName = useSettingsStore((s) => s.weatherCityName);
  const lat = useSettingsStore((s) => s.weatherLat);
  const lon = useSettingsStore((s) => s.weatherLon);
  // Native iOS-26 liquid glass for the chip surface. iOS-only + opt-in;
  // elsewhere the existing translucent fill renders unchanged.
  const glassActive = useLiquidGlassActive();

  const [snap, setSnap] = useState<WeatherSnapshot | null>(null);
  const lastSig = useRef<string>('');

  useEffect(() => {
    if (!enabled || lat == null || lon == null) {
      setSnap(null);
      lastSig.current = '';
      return;
    }
    // Re-fetch when (lat, lon) change — and only then. Identity stays stable
    // across unrelated re-renders so we don't spam Open-Meteo.
    const sig = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    let cancelled = false;
    void (async () => {
      const result = await getCurrentWeather(lat, lon);
      if (!cancelled) setSnap(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, lat, lon]);

  if (!enabled || !cityName || !snap) return null;

  const sign = snap.temperatureC >= 0 ? '+' : '';
  const label = `${emojiForWeatherCode(snap.weatherCode)} ${sign}${snap.temperatureC}° ${cityName}`;

  return (
    <Pressable
      onPress={() => {
        triggerHaptic('selection');
        router.push('/settings/weather' as any);
      }}
      hitSlop={6}
      style={glassActive ? { borderRadius: 14 } : undefined}
    >
      {glassActive ? (
        // Interactive liquid glass holding the weather label as a CHILD so the
        // widget morphs outward on touch (matches the rest of the chrome).
        <NativeGlassView
          glassStyle="regular"
          isInteractive
          colorScheme={theme.isDark ? 'dark' : 'light'}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 14,
          }}
        >
          <Text variant="caption" weight="medium" style={{ fontSize: 12 }}>
            {label}
          </Text>
        </NativeGlassView>
      ) : (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 14,
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
          }}
        >
          <Text variant="caption" weight="medium" style={{ fontSize: 12 }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
