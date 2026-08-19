import { Platform } from 'react-native';
import * as Device from 'expo-device';

/**
 * Privacy-safe weak-device heuristic (Apple §3.3.3 compliant).
 *
 * This module classifies the running device into a coarse "weak" / "not weak"
 * bucket so the Seasonal Profile Themes feature can disable ambient animations
 * and shed work on low-end hardware (Req 7.1, 7.5 — the primary test device is
 * a weak Android 10).
 *
 * COMPLIANCE — what this DOES NOT do:
 *   - NO fingerprinting. We never combine device characteristics into a stable
 *     per-device identifier, and we never persist or transmit any of the values
 *     read here.
 *   - NO new permissions. Every input comes from `expo-device`'s already-bundled,
 *     non-identifying device-class info (year class, total memory, OS API level)
 *     and the existing liquid-glass capability check — none require a prompt.
 *   - The output is a single coarse boolean about rendering headroom, derived
 *     fresh each session and used only locally to gate animations.
 *
 * The thresholds below are deliberately coarse device-class buckets, not
 * precise measurements.
 */

/**
 * Devices whose Facebook "year class" is older than this are treated as weak.
 * 2014 keeps the well-known weak Android 10 test devices (typically year class
 * 2013 or earlier) on the weak path while leaving recent hardware untouched.
 */
const MIN_DEVICE_YEAR_CLASS = 2014;

/**
 * Devices reporting less than ~3 GB of total RAM are treated as weak. Low-end
 * Android 10 handsets commonly ship with 2–3 GB; flagship/modern devices report
 * well above this. Expressed in bytes.
 */
const MIN_TOTAL_MEMORY_BYTES = 3 * 1024 * 1024 * 1024;

/**
 * Android API level at or below this (Android 11 and older) is treated as weak.
 * The primary weak test device runs Android 10 (API 29). iOS reports no API
 * level here, so this check only ever affects Android.
 */
const MAX_WEAK_ANDROID_API_LEVEL = 30;

/**
 * iOS year-class floor.
 *
 * Separate from (and higher than) the Android floor because the two platforms'
 * supported-hardware ranges are nothing alike: an Android device still on the
 * shelf can be year class 2013, whereas the OLDEST iPhone that runs a current iOS
 * is only a few generations back. 2020 puts the A13-and-older end of the
 * supported range (iPhone 11 / SE 2nd gen and earlier) on the weak path and
 * leaves A14+ (iPhone 12 and newer) alone — the generation where Apple moved to
 * 5 nm and GPU headroom jumped.
 *
 * WHY THIS EXISTS AT ALL: this module used to return `false` outright for any iOS
 * device that could render native liquid glass, on the reasoning that such a
 * device "has ample rendering headroom". That is wrong — glass capability is an
 * OS-VERSION test, not a silicon test. An iPhone 11 updated to iOS 26 passed that
 * check and therefore never had a single ambient animation gated, on precisely
 * the hardware that most needs the relief. The early return is gone; iOS is now
 * classified from the same coarse device-class inputs as everything else.
 */
const MIN_IOS_DEVICE_YEAR_CLASS = 2020;

/** Memoized per-session result; computed once on first read. */
let cachedIsWeak: boolean | null = null;

/**
 * Compute the coarse weak-device classification. Pure with respect to the
 * device-class inputs available this session — extracted so the memoized
 * `isWeakDevice()` stays a thin cache wrapper.
 */
function computeIsWeakDevice(): boolean {
  // Coarse, already-available device-class info only — no new inputs, nothing
  // persisted, nothing transmitted.
  const yearClass = Device.deviceYearClass;
  const yearFloor = Platform.OS === 'ios' ? MIN_IOS_DEVICE_YEAR_CLASS : MIN_DEVICE_YEAR_CLASS;
  if (typeof yearClass === 'number' && yearClass < yearFloor) {
    return true;
  }

  const totalMemory = Device.totalMemory;
  if (typeof totalMemory === 'number' && totalMemory > 0 && totalMemory < MIN_TOTAL_MEMORY_BYTES) {
    return true;
  }

  if (Platform.OS === 'android') {
    const apiLevel = Device.platformApiLevel;
    if (typeof apiLevel === 'number' && apiLevel <= MAX_WEAK_ANDROID_API_LEVEL) {
      return true;
    }
  }

  return false;
}

/**
 * Returns the coarse weak-device classification, computed once per session and
 * memoized. Safe to call from anywhere (non-React contexts included).
 */
export function isWeakDevice(): boolean {
  if (cachedIsWeak === null) {
    cachedIsWeak = computeIsWeakDevice();
  }
  return cachedIsWeak;
}

/**
 * React hook returning whether the current device is classified as weak. The
 * value is stable for the whole session (computed once, memoized), so this is
 * effectively a constant after first render — no subscription needed.
 */
export function useWeakDevice(): boolean {
  return isWeakDevice();
}
