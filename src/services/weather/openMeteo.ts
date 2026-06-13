// Open-Meteo weather + geocoding client.
//
// Open-Meteo is a free, no-key, no-auth public REST API. We use:
//   - https://geocoding-api.open-meteo.com/v1/search?name=...   (city picker)
//   - https://api.open-meteo.com/v1/forecast?latitude=&longitude=&current=…
//
// HTTPS-only, no PII sent (the user-typed city query goes only when the user
// is actively choosing a city in settings — never silently). Per Apple's
// privacy rules we never auto-pull device location; the user picks the city
// they want by name.

import { kvGetStringRawSync, kvSetStringRaw, isMMKVAvailable } from '../kvStore';

const FETCH_TIMEOUT_MS = 6000;
// 30-min weather cache per location, keyed on rounded lat/lon. Open-Meteo
// recommends not refetching faster than every 15 min for the same point;
// 30 min strikes a balance between fresh-enough and not chatty.
const CACHE_PREFIX = '@san:wx:';
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface GeoResult {
  id: number;
  name: string;
  country?: string;
  countryCode?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

export interface WeatherSnapshot {
  /** Temperature in °C (rounded to integer). */
  temperatureC: number;
  /** Open-Meteo WMO weather code — used to pick an emoji client-side. */
  weatherCode: number;
  /** Wind speed in km/h. */
  windKmh: number;
  /** ISO timestamp of the underlying observation. */
  observedAt: string;
}

interface CacheEntry {
  t: number;
  d: WeatherSnapshot;
}

function roundCoord(c: number): string {
  // 0.01° ≈ ~1 km — plenty granular for weather, and stable enough to make
  // the cache key actually hit when the user picks a city in settings.
  return c.toFixed(2);
}

function cacheKey(lat: number, lon: number): string {
  return `${CACHE_PREFIX}${roundCoord(lat)},${roundCoord(lon)}`;
}

function readCache(lat: number, lon: number): CacheEntry | null {
  if (!isMMKVAvailable()) return null;
  try {
    const raw = kvGetStringRawSync(cacheKey(lat, lon));
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(lat: number, lon: number, snap: WeatherSnapshot): void {
  if (!isMMKVAvailable()) return;
  try {
    kvSetStringRaw(cacheKey(lat, lon), JSON.stringify({ t: Date.now(), d: snap }));
  } catch {
    // best-effort
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch current weather at a point, with a 30-min MMKV cache. Returns null
 * on network or parse failure — callers should hide the chip when null.
 */
export async function getCurrentWeather(lat: number, lon: number): Promise<WeatherSnapshot | null> {
  const cached = readCache(lat, lon);
  if (cached && Date.now() - cached.t < CACHE_TTL_MS) {
    return cached.d;
  }
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`;
  const json = await fetchJson<{
    current?: {
      time?: string;
      temperature_2m?: number;
      weather_code?: number;
      wind_speed_10m?: number;
    };
  }>(url);
  const c = json?.current;
  if (!c || typeof c.temperature_2m !== 'number') return null;
  const snap: WeatherSnapshot = {
    temperatureC: Math.round(c.temperature_2m),
    weatherCode: typeof c.weather_code === 'number' ? c.weather_code : 0,
    windKmh: Math.round(c.wind_speed_10m ?? 0),
    observedAt: c.time || new Date().toISOString(),
  };
  writeCache(lat, lon, snap);
  return snap;
}

/**
 * Search for cities by name. Returns up to 10 results. Used by the settings
 * picker so the user can select where they want weather displayed for.
 */
export async function geocodeCity(query: string): Promise<GeoResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?count=10&format=json` +
    // language=ru gives Russian-localized city names where available, falling
    // back to the local name. The endpoint accepts UTF-8 directly.
    `&language=ru&name=${encodeURIComponent(q)}`;
  const json = await fetchJson<{ results?: any[] }>(url);
  const list = json?.results;
  if (!Array.isArray(list)) return [];
  const out: GeoResult[] = [];
  for (const r of list) {
    if (typeof r?.latitude === 'number' && typeof r?.longitude === 'number' && r?.name) {
      out.push({
        id: r.id ?? 0,
        name: String(r.name),
        country: r.country ? String(r.country) : undefined,
        countryCode: r.country_code ? String(r.country_code) : undefined,
        admin1: r.admin1 ? String(r.admin1) : undefined,
        latitude: r.latitude,
        longitude: r.longitude,
        timezone: r.timezone ? String(r.timezone) : undefined,
      });
    }
  }
  return out;
}

/**
 * Pick a representative emoji for a WMO weather code (Open-Meteo convention).
 * Used to render the home-tab chip without an icon font.
 */
export function emojiForWeatherCode(code: number): string {
  // https://open-meteo.com/en/docs#weathervariables — abridged groups.
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌧️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95 && code <= 99) return '⛈️';
  return '🌤️';
}
