import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Pressable, Switch, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useT } from '../../src/i18n/store';
import { triggerHaptic } from '../../src/utils/haptics';
import { geocodeCity, GeoResult } from '../../src/services/weather/openMeteo';

// Settings page for the optional weather chip rendered on the messages tab.
// Default state: feature off, no city picked. Per Apple privacy guidance the
// app never asks for device location; the user picks the city by name.

export default function WeatherSettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const enabled = useSettingsStore((s) => s.weatherEnabled);
  const setEnabled = useSettingsStore((s) => s.setWeatherEnabled);
  const cityName = useSettingsStore((s) => s.weatherCityName);
  const setCity = useSettingsStore((s) => s.setWeatherCity);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cardBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';

  // Debounced city search. The user types into the query field and we hit
  // the geocoding endpoint 250 ms after they stop. We keep the debounce
  // small (so suggestions feel live) but never less than 2 chars per
  // Open-Meteo's API guidance — 1-char queries return tens of thousands of
  // results and feel useless on mobile.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const list = await geocodeCity(q);
      setResults(list);
      setSearching(false);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const choose = useCallback(
    (r: GeoResult) => {
      triggerHaptic('selection');
      setCity({ name: r.name, lat: r.latitude, lon: r.longitude });
      setQuery('');
      setResults([]);
    },
    [setCity],
  );

  const clearCity = useCallback(() => {
    triggerHaptic('selection');
    setCity(null);
  }, [setCity]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: insets.top + 8,
          paddingBottom: 12,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="body" weight="bold" style={{ flex: 1, textAlign: 'center', marginRight: 32 }}>
          {t('weather_settings.title')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        {/* Enable toggle */}
        <View style={{ backgroundColor: cardBg, borderRadius: 14, marginBottom: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingVertical: 14,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                backgroundColor: 'rgba(255,159,10,0.16)',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 14,
              }}
            >
              <Feather name="cloud" size={17} color="#FF9F0A" />
            </View>
            <Text variant="body" style={{ flex: 1 }}>{t('weather_settings.show_label')}</Text>
            <Switch
              value={enabled}
              onValueChange={(v) => {
                triggerHaptic('selection');
                setEnabled(v);
              }}
              trackColor={{ true: '#4CD964', false: theme.colors.border.light }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        <Text
          variant="caption"
          weight="semibold"
          color={theme.colors.text.secondary}
          style={{ marginLeft: 4, marginBottom: 8, textTransform: 'uppercase', fontSize: 11 }}
        >
          {t('weather_settings.city_label')}
        </Text>

        {/* Selected city row — only when a city is set. Provides a way to
            clear the selection without making the user pick a new one first. */}
        {cityName ? (
          <View
            style={{
              backgroundColor: cardBg,
              borderRadius: 14,
              padding: 14,
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <Feather name="map-pin" size={16} color={theme.colors.accent.primary} />
            <Text variant="body" weight="medium" style={{ flex: 1, marginLeft: 10 }}>{cityName}</Text>
            <Pressable onPress={clearCity} hitSlop={10}>
              <Feather name="x-circle" size={18} color={theme.colors.text.tertiary} />
            </Pressable>
          </View>
        ) : null}

        {/* Search input */}
        <View
          style={{
            backgroundColor: cardBg,
            borderRadius: 14,
            paddingHorizontal: 14,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Feather name="search" size={16} color={theme.colors.text.tertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('weather_settings.search_placeholder')}
            placeholderTextColor={theme.colors.text.tertiary}
            style={{
              flex: 1,
              marginLeft: 10,
              paddingVertical: 12,
              fontSize: 15,
              color: theme.colors.text.primary,
            }}
          />
          {searching ? <ActivityIndicator size="small" color={theme.colors.text.tertiary} /> : null}
        </View>

        {/* Result list */}
        {results.length > 0 ? (
          <View style={{ backgroundColor: cardBg, borderRadius: 14, overflow: 'hidden' }}>
            {results.map((r, i) => (
              <Pressable
                key={`${r.id}-${i}`}
                onPress={() => choose(r)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderBottomWidth: i === results.length - 1 ? 0 : 0.5,
                  borderBottomColor: theme.colors.border.light,
                }}
              >
                <Text variant="body" weight="medium">{r.name}</Text>
                {r.country || r.admin1 ? (
                  <Text variant="caption" color={theme.colors.text.tertiary}>
                    {[r.admin1, r.country].filter(Boolean).join(', ')}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text variant="caption" color={theme.colors.text.tertiary} style={{ paddingHorizontal: 4, marginTop: 16 }}>
          {t('weather_settings.hint')}
        </Text>
      </ScrollView>
    </View>
  );
}
