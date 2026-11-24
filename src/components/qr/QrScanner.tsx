/**
 * Full-screen QR scanner: the camera, a dimmed frame with a clear window, a hint, and a back button.
 *
 * ── ONLY ON BINARIES THAT HAVE THE CAMERA ───────────────────────────────────
 *
 * expo-camera is a native module, added in Nov 2026 for the profile QR screen's "Сканировать" button.
 * An over-the-air update can reach a binary built before it, where importing `expo-camera` throws at
 * module evaluation (`requireNativeModule('ExpoCamera')`). So nothing imports it statically:
 * `QR_SCANNER_AVAILABLE` asks for the module without throwing, the button is hidden when it is
 * missing, and the package is required lazily inside this component.
 *
 * ── PRIVACY ──────────────────────────────────────────────────────────────────
 *
 * The camera runs only while this view is on screen, frames are read on the device to find a code
 * (AVFoundation on iOS, ML Kit on Android), and nothing is recorded, stored or sent. The permission is
 * asked the first time the scanner opens, with the reason in `NSCameraUsageDescription`. A denial is
 * respected: the scanner says so and offers the system settings, and nothing else in the app changes.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../ui/Text';
import { useT } from '../../i18n/store';
import { triggerHaptic } from '../../utils/haptics';

/** Whether this binary has expo-camera. Stable for the session. */
export const QR_SCANNER_AVAILABLE: boolean = (() => {
  try {
    return !!requireOptionalNativeModule('ExpoCamera');
  } catch {
    return false;
  }
})();

type CameraModule = typeof import('expo-camera');

function loadCamera(): CameraModule | null {
  if (!QR_SCANNER_AVAILABLE) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-camera') as CameraModule;
  } catch {
    return null;
  }
}

type Permission = 'asking' | 'granted' | 'denied' | 'blocked';

/** The dim with a rounded clear window, and white corner brackets around the window. */
function Viewfinder({ width, height, side, top }: { width: number; height: number; side: number; top: number }) {
  const left = (width - side) / 2;
  const r = 28;
  const hole =
    `M${left + r} ${top}H${left + side - r}A${r} ${r} 0 0 1 ${left + side} ${top + r}` +
    `V${top + side - r}A${r} ${r} 0 0 1 ${left + side - r} ${top + side}` +
    `H${left + r}A${r} ${r} 0 0 1 ${left} ${top + side - r}V${top + r}A${r} ${r} 0 0 1 ${left + r} ${top}Z`;
  const dim = `M0 0H${width}V${height}H0Z${hole}`;
  const arm = 34;
  const o = 4;
  const L = left - o;
  const T = top - o;
  const R = left + side + o;
  const B = top + side + o;
  const rr = r + o;
  const brackets =
    `M${L} ${T + arm}V${T + rr}A${rr} ${rr} 0 0 1 ${L + rr} ${T}H${L + arm}` +
    `M${R - arm} ${T}H${R - rr}A${rr} ${rr} 0 0 1 ${R} ${T + rr}V${T + arm}` +
    `M${R} ${B - arm}V${B - rr}A${rr} ${rr} 0 0 1 ${R - rr} ${B}H${R - arm}` +
    `M${L + arm} ${B}H${L + rr}A${rr} ${rr} 0 0 1 ${L} ${B - rr}V${B - arm}`;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={dim} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
      <Path d={brackets} stroke="#FFFFFF" strokeWidth={4} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function QrScanner({
  onClose,
  onCode,
}: {
  onClose: () => void;
  /** A code was read. Call `resume` to scan again (after a code that did not lead anywhere). */
  onCode: (data: string, resume: () => void) => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const camera = useMemo(loadCamera, []);
  const [permission, setPermission] = useState<Permission>('asking');
  // One code per open: the camera reports the same code many times a second.
  const handled = useRef(false);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [fade]);

  useEffect(() => {
    let cancelled = false;
    if (!camera) {
      setPermission('blocked');
      return;
    }
    (async () => {
      try {
        const res = await camera.Camera.requestCameraPermissionsAsync();
        if (cancelled) return;
        setPermission(res.granted ? 'granted' : res.canAskAgain ? 'denied' : 'blocked');
      } catch {
        if (!cancelled) setPermission('blocked');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [camera]);

  const askAgain = useCallback(async () => {
    if (!camera) return;
    try {
      const res = await camera.Camera.requestCameraPermissionsAsync();
      setPermission(res.granted ? 'granted' : res.canAskAgain ? 'denied' : 'blocked');
    } catch {}
  }, [camera]);

  const onBarcodeScanned = useCallback(
    (result: { data?: string }) => {
      if (handled.current) return;
      const data = typeof result?.data === 'string' ? result.data.trim() : '';
      if (!data) return;
      handled.current = true;
      triggerHaptic('medium');
      onCode(data, () => {
        handled.current = false;
      });
    },
    [onCode],
  );

  const side = Math.min(width - 96, 280);
  const frameTop = Math.max(insets.top + 96, (height - side) / 2 - 40);
  const CameraView = camera?.CameraView;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]}>
      {permission === 'granted' && CameraView ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onBarcodeScanned}
        />
      ) : null}
      <Viewfinder width={width} height={height} side={side} top={frameTop} />

      <View style={[styles.hintWrap, { top: frameTop + side + 28 }]} pointerEvents="box-none">
        {permission === 'granted' || permission === 'asking' ? (
          <Text variant="body" weight="semibold" color="#FFFFFF" align="center">
            {t('qr.scan_hint', 'Наведите камеру на QR-код')}
          </Text>
        ) : (
          <>
            <Text variant="body" color="#FFFFFF" align="center" style={styles.deniedText}>
              {t('qr.camera_denied', 'Нет доступа к камере. Разрешите его, чтобы сканировать QR-коды.')}
            </Text>
            <Pressable
              onPress={permission === 'denied' ? askAgain : () => { void Linking.openSettings(); }}
              style={styles.settingsBtn}
              accessibilityRole="button"
            >
              <Text variant="body" weight="semibold" color="#000000">
                {permission === 'denied' ? t('qr.camera_allow', 'Разрешить') : t('qr.open_settings', 'Открыть настройки')}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      <Pressable
        onPress={onClose}
        hitSlop={10}
        style={[styles.back, { top: insets.top + 10 }]}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
      >
        <Feather name="chevron-left" size={26} color="#FFFFFF" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#000000' },
  hintWrap: { position: 'absolute', left: 32, right: 32, alignItems: 'center' },
  deniedText: { lineHeight: 22 },
  settingsBtn: {
    marginTop: 16,
    paddingHorizontal: 22,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: {
    position: 'absolute',
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
