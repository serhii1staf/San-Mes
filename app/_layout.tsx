import React, { useCallback, useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, Text as RNText, Image as RNImage, AppState, Pressable, InteractionManager, Platform, Dimensions, Keyboard } from 'react-native';
import { Stack, useRouter, useSegments, useNavigationContainerRef, usePathname } from 'expo-router';
import { consumeSkipSplashOnce } from '../src/services/launchFlags';
import { onFirstScreenPainted } from '../src/services/firstScreenPaint';
import { compareIso } from '../src/utils/compareIso';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Sentry from '@sentry/react-native';
import { ThemeProvider, useTheme } from '../src/theme';
import { QueryProvider } from '../src/lib/queryClient';
import { fontAssets } from '../src/theme/fonts';
import { useAuthStore } from '../src/store';
import { BrowserMiniBar } from '../src/components/ui/BrowserMiniBar';
import { BrowserBottomBand } from '../src/components/ui/BrowserBottomBand';
import { MusicBottomIndicator } from '../src/components/ui/MusicBottomIndicator';
import { MusicFullPlayer } from '../src/components/ui/MusicFullPlayer';
import { MiniAppHost } from '../src/components/ui/MiniAppHost';
import { Toast } from '../src/components/ui/Toast';
import { ShareSheetHost } from '../src/components/ui/ShareSheetHost';
import { initRateLimits } from '../src/services/rateLimit';
import { cacheCleanup } from '../src/services/cacheManager';
import { installImageMemoryManager } from '../src/services/imageMemoryManager';
import { installPowerMode } from '../src/services/powerMode';
import { useConnectivityStore } from '../src/services/connectivityMonitor';
import { useEntityStore } from '../src/services/entityStore';
import { setCacheAccount } from '../src/services/cacheService';
import { useChatUnread } from '../src/store/chatUnreadStore';
import { setThrottleAccount } from '../src/services/syncThrottle';
import { useT } from '../src/i18n/store';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { enableFreeze } from 'react-native-screens';
// `@gorhom/bottom-sheet`'s `BottomSheetModalProvider` used to be mounted here.
// It was removed along with the dependency: an audit found the provider was the
// ONLY reference to the library in the whole codebase — not a single
// `BottomSheetModal` was ever opened. Every draggable surface in this app
// (`PhotoPickerPanel`, `MediaPanel`, the selection bar) is hand-rolled on
// gesture-handler + Reanimated, which is the right tool for panels that dock into
// the keyboard's space rather than present as modals. The provider still mounted a
// portal host and a gesture wrapper at the root of every screen, so removing it
// takes real work off the tree in exchange for nothing.
import { PerfMonitorBubble } from '../src/components/dev/PerfMonitorBubble';
import { perfMonitor, installPerfErrorHooks } from '../src/services/perfMonitor';
import { installNotificationsBadgeForegroundRefresh } from '../src/store/notificationsBadgeStore';
import { InAppAlertHost } from '../src/components/ui/InAppAlertHost';
import { ChatPeekHost } from '../src/components/chat/ChatPeekMenu';
import { ProfileQrHost } from '../src/components/profile/ProfileQrHost';
import { RealtimeAccountBridge } from '../src/components/realtime/RealtimeAccountBridge';
import { NavigationBarController } from '../src/components/system/NavigationBarController';

// Install the global JS error / promise hooks once at module load so we
// capture every crash from the very first render onward (the bubble panel
// can then surface them with a copy button, which is what the user wants
// when they don't have direct Sentry access).
try { installPerfErrorHooks(); } catch {}

// Refresh the notification badge whenever the app returns to the foreground. Bound to the app rather
// than to a screen on purpose: the only caller used to be the bell's `useFocusEffect` on the HOME tab,
// so resuming into the chat list or the profile never refreshed it. See the long note in
// `notificationsBadgeStore.ts` for why the badge could be missing entirely after a push.
try { installNotificationsBadgeForegroundRefresh(); } catch {}

// Session revalidation (`/v1/auth/me`) cadence. It used to run on every return to the foreground,
// including iOS `inactive` blips; once per half hour still notices an expired session promptly.
const SESSION_RECHECK_MS = 30 * 60 * 1000;
let lastSessionCheckAt = 0;

// ── FREEZE BLURRED SCREENS (the single biggest app-wide lag lever) ───────────
//
// Without this, react-native-screens leaves every visited tab and every pushed
// screen MOUNTED and RE-RENDERING while it is off-screen. The measured symptom:
// the Messages tab re-ran its whole filter/sort/list reconcile on every store
// write while the user was on another tab, and the feed tab kept rebuilding in
// the background. `enableFreeze(true)` wraps a blurred screen in react-freeze's
// Suspense boundary so its React subtree stops re-rendering until it is focused
// again — native views persist, so there is no remount cost on return.
//
// Scope and limits, stated honestly:
//   • It freezes BLURRED navigator screens. The root-level hosts (music player,
//     realtime bridge, toasts, perf bubble) are siblings of the navigator, never
//     screens, so they keep running — which is what we want.
//   • On the New Architecture (Fabric), the native-stack screen DIRECTLY BELOW
//     the focused one is not frozen, so "Messages under an open chat" is NOT
//     covered by this flag alone; that case is handled separately by gating the
//     messages tab's heavy subscriptions on `useIsFocused`. This flag still wins
//     the common cases: the other tabs while you are on one, and any screen two
//     or more levels down the stack.
//   • Module scope + before first render, as react-native-screens requires.
try { enableFreeze(true); } catch {}

// ── `runAfterInteractions` CONCENTRATES WORK. IT DOES NOT SPREAD IT. ─────────
//
// Fifteen call sites in this app defer work behind `InteractionManager.runAfterInteractions`, and every
// note attached to them says the same thing: this keeps the work off the transition frame. Read the
// RN 0.81 source and that is not what happens.
//
// `Libraries/Interaction/InteractionManager.js`:
//
//     let _deadline = -1;                                    // the default
//     ...
//     while (_taskQueue.hasTasksToProcess()) {
//       _taskQueue.processNext();
//       if (_deadline > 0 && BatchedBridge.getEventLoopRunningTime() >= _deadline) {
//         _scheduleUpdate();
//         break;                                             // <- unreachable by default
//       }
//     }
//
// `_deadline` is `-1`, so the guard is false, so the `break` is dead code and the whole queue drains in
// one uninterrupted `while` loop inside a single `setImmediate`. RN's own doc in that file states it
// plainly: "By default, queued tasks are executed together in a loop in one `setImmediate` batch. If
// `setDeadline` is called with a positive number, then tasks will only be executed until the deadline
// ... allowing events such as touches to start interactions and block queued tasks from executing,
// making apps more responsive."
//
// So the deferral does not fragment the work across frames. It COLLECTS every deferred callback for a
// screen open into one JS task that runs immediately after first paint. Measured on device: opening a
// chat produced two contiguous long tasks, 150 ms then 146 ms. The first is the screen's own
// render+commit; the second is this drain. Six callbacks arm on chat open — an MMKV write that re-sorts
// the still-mounted messages tab, a store seed that re-renders the transcript, a profile fetch, the
// history poll's first tick, an image warm and a stuck-photo scan — and they all ran in that one block,
// with no yield for a touch or a frame. That is the window the user describes as the chat struggling to
// open.
//
// WHY THE NUMBER BARELY MATTERS, AND WHY THIS IS SAFE
//
// `getEventLoopRunningTime()` is `Date.now() - _eventLoopStartTime`, and `_eventLoopStartTime` is only
// refreshed inside `MessageQueue.__callFunction` / `__invokeCallback` — the legacy bridge's native→JS
// entry points. This app runs `newArchEnabled: true`, i.e. bridgeless, where native calls JS over JSI
// rather than through those methods, so that timestamp stays at the value the MessageQueue constructor
// wrote at startup. Any positive deadline therefore trips after the FIRST task, and the queue becomes
// one task per `setTimeout(0)`.
//
// That is not a degenerate case, it is the behaviour RN itself considers equivalent: `InteractionManager`
// is marked `@deprecated` in 0.81, and `InteractionManagerStub` — the replacement behind
// `ReactNativeFeatureFlags.disableInteractionManager()` — schedules each task in its OWN `setImmediate`
// with no shared queue at all. If the bridge ever is driven, the deadline simply behaves as documented
// instead. Both outcomes are bounded and both are strictly better than never yielding.
//
// Two things this does NOT do, stated so nobody expects them. The check runs AFTER `processNext`, so it
// cannot bound a single expensive callback — it bounds how many stack up back to back. And it does not
// change ordering or cancellation: `processNext` still shifts from the same queue, and `handle.cancel()`
// still filters the same array.
//
// 16 rather than a larger figure because one frame is the unit that matters: the point is to let a frame
// be drawn and a touch be seen between deferred callbacks, not to fill a budget.
//
// The real fix is to stop routing work through a deprecated scheduler at all, which is a per-site
// decision and tracked separately. This is one line that helps every one of those fifteen sites today.
try { InteractionManager.setDeadline(16); } catch {}

SplashScreen.preventAutoHideAsync().catch(() => {});

// Sentry monitoring — initialize before any component renders so the SDK can
// catch the very first error if it happens during the initial JS bundle eval.
// The DSN is a public ingestion URL: it identifies the project but cannot be
// used to read events or modify settings, so it's safe to commit.
const navigationIntegration = Sentry.reactNavigationIntegration({
  // ── TIME TO INITIAL DISPLAY IS iOS-ONLY: ON ANDROID IT KEPT EVERY SCREEN ALIVE ────────────────
  //
  // With this on, the SDK calls `initNativeReactNavigationNewFrameTracking`, which on Android
  // registers a fragment-lifecycle tracer that puts sentry-android's `FirstDrawDoneListener` on every
  // pushed screen. In sentry-android 8.21.1 (the version this binary has, via @sentry/react-native
  // 7.2.0) that listener removes itself from a global-layout listener that is never removed in
  // turn, and that lambda holds the screen's root view. The root window's ViewTreeObserver therefore
  // kept every chat, profile and settings screen ever opened, with its whole view tree.
  //
  // Measured on the emulator (heap dump after a forced GC, open/close the long chat 4 times, no
  // scrolling): live Views 293 -> 393 -> 493 -> 593, exactly 100 more per visit, and 400 of the 411
  // detached ones held through that listener. sentry-java fixed it upstream (#5567, #6152), which
  // needs a new native build; turning the feature off on Android is the over-the-air fix. iOS
  // measures the same thing by swizzling `viewDidAppear` and keeps it. Android navigation spans are
  // still recorded, without the time-to-initial-display measurement.
  enableTimeToInitialDisplay: Platform.OS !== 'android',
});

// Wrap init in try/catch so that if anything goes wrong (e.g. the native
// module failed to load on a particular OTA payload, or a regression in the
// Sentry SDK trips an early error) we don't take the whole app down with us.
// Crash reporting is a nice-to-have, working app is critical.
try {
  Sentry.init({
    dsn: 'https://5cc37dc9e4220257f42fe51995c0dbae@o4511549943447552.ingest.de.sentry.io/4511550037229648',
    // Conservative sampling rates so Sentry never becomes a perf problem on
    // weak devices. We can raise these once we have a baseline of traffic.
    tracesSampleRate: 0.1,
    // profilesSampleRate intentionally omitted — the native profiler needs
    // additional setup that's easy to get wrong, and a misconfigured
    // profiler can crash the app at startup.
    enableAutoSessionTracking: true,
    // Don't ship default PII to keep us aligned with the Apple Developer
    // Program License Agreement (no covert collection of user data). We attach
    // user.id manually after auth via Sentry.setUser() if/when needed.
    sendDefaultPii: false,
    integrations: [navigationIntegration],
    // Filter local-dev noise. RELEASE_CHANNEL is set by EAS / expo-updates.
    enabled: !__DEV__,
  });
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('[Sentry.init] failed:', err);
}

function AuthNavigationGuard({ children }: { children: React.ReactNode }) {
  // Subscribe to ONLY the two flags we actually care about. Pulling the whole
  // auth store re-renders the entire navigation stack on every profile field
  // update (badge, displayName, etc.) — that was a major source of jank.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const segments = useSegments();
  const router = useRouter();
  // Read by the notification tap handler, which lives in an effect and must not re-install on every
  // navigation just to see where the user is.
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const [showSplash, setShowSplash] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // Skipped once right after an account switch: the switch already showed a cover and the native
  // reload screen in the same colour, and a third full-screen beat on top of those is the flash.
  const [skipSplash] = useState(() => consumeSkipSplashOnce());

  useEffect(() => {
    // Minimum time the branded JS splash stays up. Trimmed 800 → 450 ms so the
    // app reaches the feed faster after the native launch screen hands off —
    // the user perceived the combined native+JS splash as too long.
    const minMs = skipSplash ? 0 : 450;
    const timer = setTimeout(() => setShowSplash(false), minMs);
    return () => clearTimeout(timer);
  }, [skipSplash]);

  // ── THE SPLASH IS DRAWN OVER THE APP NOW, NOT INSTEAD OF IT (Nov 2026) ────
  //
  // Reported: at launch the bottom navigation sometimes has no icons, "как будто прогружается после
  // экрана загрузки". The recording, frame by frame: the splash went, then ~85 ms of a bare tab bar
  // on an empty screen (a cold start lands on the hidden `index` route, which renders nothing and
  // redirects after its first commit), then the chat list, and only then the tab icons (their font
  // loaded lazily; preloaded now, see src/theme/fonts.ts).
  //
  // The splash used to REPLACE the app, so the app could only start mounting once the splash had
  // gone, and everything it does in its first frames was on screen. Now the app mounts under the
  // splash, during its minimum time, and the splash lifts (a short fade) once the first screen has
  // actually been drawn (`firstScreenPaint`), or after `COVER_CAP_MS` at the latest. Signed-out and
  // logging-out states still render the splash INSTEAD of the app, synchronously, exactly as before:
  // no protected screen may render with a null user for even one frame.
  const [coverLeaving, setCoverLeaving] = useState(false);
  const [coverGone, setCoverGone] = useState(skipSplash);
  // Not in the guard's first commit: that commit is what lets the native launch screen go (see
  // `SplashScreen.hideAsync` in RootLayout), and mounting the whole app in it would hold the launch
  // screen for the length of that mount and only then start the splash's minimum time. One frame
  // later, the app mounts under the splash while that time runs.
  const [appMountAllowed, setAppMountAllowed] = useState(skipSplash);
  useEffect(() => {
    if (appMountAllowed) return;
    const raf = requestAnimationFrame(() => setAppMountAllowed(true));
    return () => cancelAnimationFrame(raf);
  }, [appMountAllowed]);
  const inAuthGroupNow = segments[0] === '(auth)';
  const mountApp = appMountAllowed && hasHydrated && !isLoggingOut && (isAuthenticated || inAuthGroupNow);
  useEffect(() => {
    if (!mountApp || showSplash || coverGone || coverLeaving) return;
    // Signed out (welcome, login): those screens do not report their first paint and have nothing
    // that pops in, so the splash lifts after its minimum time, as it always did.
    if (!isAuthenticated) {
      setCoverLeaving(true);
      return;
    }
    let done = false;
    const leave = () => {
      if (done) return;
      done = true;
      setCoverLeaving(true);
    };
    const unsubscribe = onFirstScreenPainted(leave);
    const cap = setTimeout(leave, COVER_CAP_MS);
    return () => {
      unsubscribe();
      clearTimeout(cap);
    };
  }, [mountApp, showSplash, coverGone, coverLeaving, isAuthenticated]);
  const onCoverGone = useCallback(() => setCoverGone(true), []);

  useEffect(() => {
    if (!hasHydrated || showSplash) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuthGroup) {
      // Show blank screen immediately to prevent crashes from null user
      setIsLoggingOut(true);
      // Navigate after a frame to let components unmount
      setTimeout(() => {
        router.replace('/(auth)/welcome');
        setIsLoggingOut(false);
      }, 50);
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, segments, hasHydrated, showSplash]);

  // Register for push notifications once the user is authenticated and past the
  // splash. Deferred so the permission prompt + token fetch never block startup.
  // No-op on the current build (native module absent — guarded inside).
  useEffect(() => {
    if (!isAuthenticated || !hasHydrated) return;
    const tid = setTimeout(() => {
      import('../src/services/pushNotifications')
        .then((m) => m.registerForPush())
        .catch(() => {});
    }, 1500);
    // Every return to the foreground retries a registration that has not succeeded yet, without
    // asking for permission again; a no-op once it has. See `ensurePushRegistered`.
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      import('../src/services/pushNotifications')
        .then((m) => m.ensurePushRegistered())
        .catch(() => {});
    });
    return () => { clearTimeout(tid); sub.remove(); };
  }, [isAuthenticated, hasHydrated]);

  // Chats muted from the chat list are muted on the server too, so their pushes stop while the app
  // is closed; the local list alone only silenced the open app. Off the startup path, like the push
  // registration above. See src/services/muteSync.ts.
  useEffect(() => {
    if (!isAuthenticated || !hasHydrated) return;
    let stop: (() => void) | null = null;
    let gone = false;
    const tid = setTimeout(() => {
      import('../src/services/muteSync')
        .then((m) => { if (!gone) stop = m.startMuteSync(); })
        .catch(() => {});
    }, 3000);
    return () => {
      gone = true;
      clearTimeout(tid);
      stop?.();
    };
  }, [isAuthenticated, hasHydrated]);

  // ── RECORD THIS INSTALL SO THE OWNER CAN SEE IT AND REMOVE IT ─────────────
  //
  // This is what makes the Devices screen list every device that has signed in, rather than only the
  // ones that granted notification permission. The first version of that screen was backed by
  // `push_tokens`, and the report was exact: two people share the account and it showed one device.
  //
  // Deliberately NOT folded into the push effect above. That one is gated on the notification master
  // switch and bails when permission is denied, which is the precise condition that made the list
  // incomplete. Sharing its lifecycle would reproduce the bug.
  //
  // `force: true`, and only 300 ms out rather than 1500: the point of a sign-in heartbeat is that the
  // device appears in its owner's list straight away. The service throttles subsequent calls to ten
  // minutes on its own.
  //
  // Also runs on every return to the foreground, because that is when a revocation issued elsewhere
  // is discovered — the heartbeat's reply is the channel the server uses to tell a removed device to
  // sign itself out. See `deviceRegistry.ts` for why that is the enforcement point and what its
  // limits are.
  useEffect(() => {
    if (!isAuthenticated || !hasHydrated) return;
    let disposed = false;
    const beat = (force: boolean) => {
      import('../src/services/deviceRegistry')
        .then((m) => { if (!disposed) void m.heartbeatDevice({ force }); })
        .catch(() => {});
    };
    const tid = setTimeout(() => beat(true), 300);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') beat(false);
    });
    return () => {
      disposed = true;
      clearTimeout(tid);
      try { sub.remove(); } catch {}
    };
  }, [isAuthenticated, hasHydrated]);

  // ── Tapping a push must open the thread it came from ──────────────────────
  //
  // Installed here rather than inside `registerForPush` because it must exist even when
  // registration bails (push already registered, permission previously granted, master switch
  // off but a notification from before it was turned off is still in the tray). It also has to
  // survive independently of the 1500 ms deferral above: the cold-start path reads the response
  // that LAUNCHED the app, and that must not wait on a token round trip.
  //
  // Mounted inside the auth guard, so a tap can never navigate a signed-out user into a chat.
  //
  // Waits for the splash: until then the Stack is not mounted, and a push into a stack that does not
  // exist yet is either dropped or lands after the chat list has painted (list → chat slide-in, read
  // as a reload). Also skips a tap for the chat that is already on screen: `router.push` always adds
  // a route, so the same conversation would slide in again over itself and remount its transcript.
  useEffect(() => {
    if (!isAuthenticated || !hasHydrated || showSplash) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    import('../src/services/pushNotifications')
      .then((m) => {
        if (cancelled) return;
        // The foreground presentation policy (thread / mute / category / in-app pill) has to exist
        // from the first push of the session, not only after a successful registration.
        try { m.configureNotificationHandler(); } catch {}
        dispose = m.installNotificationTapHandler((path) => {
          try {
            const current = pathnameRef.current;
            // The pathname carries no query, and a chat route now does (`?participantId=`).
            const pathOnly = path.split('?')[0];
            let target = pathOnly;
            try { target = decodeURIComponent(pathOnly); } catch {}
            if (current === target) return;
            // Start the chat's history request now, so it runs during the slide instead of after
            // it. See src/services/chatHistorySync.ts.
            const chat = /^\/chat\/([^/?]+)$/.exec(target);
            if (chat) {
              try { require('../src/services/chatHistorySync').prefetchChatHistory(chat[1]); } catch {}
            }
            router.push(path as any);
          } catch {}
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      try { dispose?.(); } catch {}
    };
  }, [isAuthenticated, hasHydrated, showSplash, router]);

  // A push that arrives while the app is NOT in the foreground must always be presented, even
  // for the thread that was on screen when the user switched away — that banner is how they
  // come back. So the on-screen-thread register is dropped on background and the screen
  // re-registers on foreground (see the chat/comments screens' AppState wiring).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') return;
      import('../src/services/activeThread')
        .then((m) => m.suspendActiveThread())
        .catch(() => {});
    });
    return () => { try { sub.remove(); } catch {} };
  }, []);

  // Synchronous guard: until the auth store has hydrated, and the moment auth is cleared (logout /
  // delete account), the app is not mounted at all and only the splash is drawn, so no protected
  // screen re-renders with a null user for even a single frame (that race was crashing the app on
  // logout). Otherwise the app is mounted and the splash, while it is up, is drawn over it (see
  // "THE SPLASH IS DRAWN OVER THE APP NOW").
  //
  // The two children keep their positions, so the splash is the same element before and after the
  // app mounts under it and its entrance animation is not restarted.
  //
  // The whole tree is wrapped in a themed background so any 1-pixel layout
  // gap (e.g. between the Stack and the bottom-docked browser band when
  // its height animates) gets the app's real background colour rather than
  // whatever sits behind us (which can be the OS default white in some
  // edge cases — that was the "white seam" the user saw at the bottom of
  // the screen for a frame after dismissing the band).
  const coverVisible = !mountApp || !coverGone;
  return (
    <View style={styles.guardRoot}>
      {mountApp ? <ThemedShell>{children}</ThemedShell> : null}
      {coverVisible ? <CustomSplash leaving={mountApp && coverLeaving} onGone={onCoverGone} /> : null}
    </View>
  );
}

/** The splash lifts by this long after its minimum time even if no screen reports being drawn. */
const COVER_CAP_MS = 1500;

function ThemedShell({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>{children}</View>;
}

// Themed fallback shown by ErrorBoundary when the screen tree throws during
// render. Lives BELOW the theme/i18n providers (the boundary wraps the screen
// tree, not the providers) so it can read the active theme + locale. Kept
// dependency-free: just View/Text/Pressable + theme tokens.
function ErrorBoundaryFallback({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={[styles.errorContainer, { backgroundColor: theme.colors.background.primary }]}>
      <RNText style={{ fontSize: 44, marginBottom: 16 }}>😵‍💫</RNText>
      <RNText style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text.primary, textAlign: 'center', marginBottom: 8 }}>
        {t('errors.boundary_title', 'Что-то пошло не так')}
      </RNText>
      <RNText style={{ fontSize: 14, color: theme.colors.text.secondary, textAlign: 'center', marginBottom: 24, paddingHorizontal: 8 }}>
        {t('errors.boundary_body', 'Произошла непредвиденная ошибка. Попробуйте ещё раз.')}
      </RNText>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={({ pressed }) => ({
          backgroundColor: theme.colors.accent.primary,
          paddingHorizontal: 28,
          paddingVertical: 12,
          borderRadius: 12,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <RNText style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>
          {t('errors.boundary_retry', 'Попробовать снова')}
        </RNText>
      </Pressable>
    </View>
  );
}

// App-wide React error boundary. Catches render-time errors in the screen tree
// (e.g. one bad cached record blowing up a list) and shows the themed fallback
// above with a "try again" action that resets the boundary so the tree
// re-renders — instead of a blank/crashed screen with no recovery. Reports to
// Sentry when available (best-effort, never throws from the handler). It wraps
// ONLY the screen tree; the theme/i18n providers stay outside so the fallback
// stays themed.
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    try {
      Sentry.captureException(error, {
        extra: { componentStack: info?.componentStack },
      });
    } catch {
      // Reporting is best-effort — never let it throw out of the boundary.
    }
  }

  reset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return <ErrorBoundaryFallback onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

function CustomSplash({ leaving = false, onGone }: { leaving?: boolean; onGone?: () => void }) {
  const t = useT();
  // Splash only needs the display name — subscribe to that field, not the
  // whole user object, so unrelated profile updates don't re-trigger the
  // mount animation.
  const displayName = useAuthStore((s) => s.user?.displayName);
  const logoAnim = useRef(new Animated.Value(-40)).current;
  const textAnim = useRef(new Animated.Value(40)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  // The whole splash, for lifting it off the app underneath (see AuthNavigationGuard).
  const coverAnim = useRef(new Animated.Value(1)).current;
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(logoAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
      Animated.timing(textAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (!leaving) {
      coverAnim.setValue(1);
      return;
    }
    Animated.timing(coverAnim, { toValue: 0, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) onGoneRef.current?.();
      },
    );
  }, [leaving, coverAnim]);

  // Layout: ORIGINAL side-by-side branding (logo slides in from the left,
  // "San" + greeting from the right). The only thing kept from the splash
  // rework is the fixed dark #141414 background + light text, which matches
  // the NATIVE launch screen (app.json expo-splash-screen) so the
  // native→JS hand-off doesn't flash dark→light. The centered layout was a
  // misstep and is reverted here.
  return (
    <Animated.View
      style={[styles.loadingContainer, { backgroundColor: '#141414', opacity: coverAnim }]}
      // Taps on a splash that is lifting go to the app under it.
      pointerEvents={leaving ? 'none' : 'auto'}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 32, maxWidth: '90%' }}>
        <Animated.View style={{ transform: [{ translateX: logoAnim }], opacity: opacityAnim }}>
          <RNImage source={require('../assets/icon.png')} style={{ width: 44, height: 44, borderRadius: 12 }} />
        </Animated.View>
        <Animated.View style={{ transform: [{ translateX: textAnim }], opacity: opacityAnim, flexShrink: 1 }}>
          <RNText style={{ fontSize: 28, fontWeight: '700', color: '#FFFFFF' }}>San</RNText>
          {displayName && (
            <RNText numberOfLines={1} style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
              {t('splash.greeting', undefined, { name: displayName })}
            </RNText>
          )}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const [fontTimeout, setFontTimeout] = useState(false);
  const navigationRef = useNavigationContainerRef();
  const segments = useSegments();
  const lastSegmentRef = useRef<string>('');

  // Hand the navigation container to Sentry so it can track screen
  // transitions as transactions (no PII; it only logs route names).
  useEffect(() => {
    if (navigationRef?.current) {
      navigationIntegration.registerNavigationContainer(navigationRef);
    }
  }, [navigationRef]);

  // Feed navigation transitions into the in-app perf monitor so the user
  // sees which screen change is slow when they're chasing jank. We record
  // the duration as the time from the segment change until two paint
  // frames later — by then most of the new screen's first render work has
  // landed, so the number is a reasonable proxy for "how long did the
  // transition feel". Wrapped defensively — a regression here must not
  // bring down the whole app.
  useEffect(() => {
    try {
      const route = segments.join('/') || '(root)';
      if (route === lastSegmentRef.current) return;
      lastSegmentRef.current = route;
      const startedAt = Date.now();
      // ── STAMP THE ROUTE NOW, TIME THE TRANSITION LATER ────────────────────
      //
      // These were one call, and that made every screen-mount mark land on the wrong route. React
      // flushes effects child-first, so a screen's mount effect runs before this one — and this one
      // then waited two more frames before advancing the perf monitor's notion of "current route".
      // So `MOUNT (tabs)/messages 413` was filed under `(tabs)/profile`, and the panel pointed at a
      // screen that had done none of the work. See the note on `setRoute`.
      perfMonitor.setRoute(route);
      // Two RAFs ≈ first paint after layout. We avoid heavier hooks like
      // setTimeout(0) because they add their own scheduling jitter.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            perfMonitor.recordNavigation(route, Date.now() - startedAt);
          } catch {}
        });
      });
    } catch {}
  }, [segments]);

  useEffect(() => {
    const timer = setTimeout(() => setFontTimeout(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Install the global image-memory pressure handler ONCE for the whole
  // session. On an OS low-memory warning (or a sustained background) it drops
  // expo-image's decoded-bitmap memory cache so an image-heavy marathon
  // session can't grow native memory into an OOM-kill — disk bytes are kept,
  // so visible images repaint instantly from local cache. Best-effort + guarded.
  // Start watching Low Power Mode. Until this ran, the app had no idea the state
  // existed and kept requesting full-cost frames while the OS had halved the
  // budget — the direct cause of "it lags when the battery is low".
  //
  // Resolves to `unknown` (= behave exactly as today) on any binary that does not
  // contain the expo-battery native module, which is every build currently
  // installed. It activates with the next native build, never over OTA.
  useEffect(() => {
    const dispose = installPowerMode();
    return dispose;
  }, []);

  useEffect(() => {
    const dispose = installImageMemoryManager();
    return dispose;
  }, []);

  const ready = fontsLoaded || fontError !== null || fontTimeout;

  useEffect(() => {
    if (!ready) return;

    SplashScreen.hideAsync().catch(() => {});

    // Phase 1 — must run before any feed/conversation hydration so each
    // account loads its own slice of the cache (Telegram-style isolation).
    // These are pure synchronous setters, not network calls.
    const currentUser = useAuthStore.getState().user;
    setCacheAccount(currentUser?.id);
    setThrottleAccount(currentUser?.id);
    // ── RE-READ UNREAD STATE NOW THAT THE NAMESPACE IS CORRECT ────────────────
    //
    // `chatUnreadStore` is imported statically by CustomTabBar, RealtimeAccountBridge,
    // messages.tsx and chatStore, so its body ran during module evaluation — before this
    // effect, and therefore under `activeAccountId === 'anon'`. Both of its maps hydrated
    // empty, and `reconcile` running against empty maps set every conversation to 1 and
    // then persisted that (plus an empty readAt) over the real data. Every cold start.
    //
    // The store now self-heals inside its own mutators, so this call is not what makes it
    // correct — it is what makes the OS icon badge correct promptly, instead of after the
    // first message or the first chat open.
    try { useChatUnread.getState().rehydrate(); } catch {}

    // Phase 2 — hydrate cached data so screens have content on first paint.
    useEntityStore.getState().hydrate();

    // Phase 3 — non-critical setup. Defer to the next idle frame so the
    // first render lands without competing for the JS thread. On weak
    // devices this is the difference between "tap profile and freeze for
    // a frame" and "instant transition".
    const idle = setTimeout(() => {
      initRateLimits();
      cacheCleanup();
      useConnectivityStore.getState().start();
      // Pull the remembered image dimensions into memory HERE, on the idle frame,
      // rather than lazily on whichever frame first renders a photo.
      //
      // `getImageDims` is called from render paths (chat photo bubbles sizing their box,
      // the feed hero/carousel aspect seeding). Its backing map loads lazily, so the first
      // call in a session did a synchronous MMKV read + JSON.parse of up to 600 entries —
      // and it landed on a chat-open or feed-open frame, which is already carrying a
      // navigation transition. Warming it here means every render-path read is a plain
      // object lookup, which is what the cache was designed to be.
      import('../src/services/imageDimsCache')
        .then(({ warmImageDims }) => warmImageDims())
        .catch(() => {});
      // Proactively cap expo-image's unbounded on-disk cache so a long-running
      // image-heavy session can't grow it into storage-exhaustion / crash
      // territory. Dynamically imported + fully guarded so it never blocks
      // startup and degrades gracefully on an older binary. Internally
      // throttled to once per session and best-effort (clears only when over
      // the cap; images re-download cheaply via the CDN proxy).
      import('../src/services/imageDiskCacheGuard')
        .then(({ enforceImageDiskCacheCap }) => enforceImageDiskCacheCap())
        .catch(() => {});
      // (The boot-time `syncFollows` was removed with followers: nothing reads
      // the follow graph any more, so it was a request per launch for nothing.)

      // Revalidate the persisted session once, AFTER first paint is unblocked.
      // restoreSession() validates the stored JWT via /v1/auth/me and silently
      // clears auth if it's dead — so a session that expired while the app sat
      // unused for weeks gets confirmed or cleanly cleared here, instead of
      // letting the first authed request 401 mid-use (the "open after weeks →
      // see feed → get kicked to login" bug). Fire-and-forget + guarded; this
      // sits in the deferred idle phase so it never blocks splash/first paint.
      // No new logout path — restoreSession already owns the dead-token wipe.
      if (useAuthStore.getState().user?.id) {
        lastSessionCheckAt = Date.now();
        try {
          useAuthStore.getState().restoreSession().catch(() => {});
        } catch {}
      }

      // Hydrate the blocked-user set from the server's authoritative list
      // (GET /v1/blocks) once on boot, AFTER first paint is unblocked. This
      // merges blocks made on ANOTHER device into this device's local set —
      // without it, a block created elsewhere wouldn't take effect here until
      // the next manual block action. Lazy-imported (the store may already be
      // imported elsewhere; a dynamic import here keeps boot order safe) and
      // fully guarded fire-and-forget so it never blocks splash/first paint.
      // Guarded on a logged-in user — there's nothing to reconcile when signed out.
      if (useAuthStore.getState().user?.id) {
        import('../src/store/blockedUsersStore')
          .then(({ useBlockedUsersStore }) => useBlockedUsersStore.getState().hydrateFromServer())
          .catch(() => {});
      }
    }, 0);

    // Phase 4 — boot-time image warming. Deferred well past first paint so it
    // NEVER competes with the cold-start frame, then warms the on-disk image
    // cache for the surface the user opens first: the recent media of the top
    // conversations, so re-entering a chat shows images instantly even on a
    // cold launch instead of paying a weserv round-trip on first mount.
    // (The feed-hero half was removed with the feed.) Capped at ≤12 URIs and
    // routed through expo-image's deduping prefetcher. Fully guarded.
    const warm = setTimeout(() => {
      // Your own profile banner, decoded into MEMORY (not just disk) at the exact width the profile
      // requests, so opening the profile after a cold start paints it in the first frame instead of
      // reading it from disk and popping it in. One image; the decode happens off the main thread.
      try {
        const rawBanner = (useAuthStore.getState().user as any)?.bannerUrl as string | undefined;
        if (rawBanner) {
          Promise.all([import('../src/utils/bannerTransform'), import('../src/components/ui/CachedImage')])
            .then(([{ stripBannerTransform }, { warmIntoMemory }]) => {
              const url = stripBannerTransform(rawBanner);
              if (url) warmIntoMemory([url], Math.round(Dimensions.get('window').width));
            })
            .catch(() => {});
        }
      } catch {}
      // The thumbnails of your own first few posts, the same way and at the widths the profile cards
      // request (100 for a single photo, 49 for a tile; see ProfilePostCard). Reported: after a cold
      // start, opening your profile showed your posts "loading again". They were on disk; the fade a
      // first appearance gets is what read as loading. GIFs are left out: decoding an animation
      // ahead of time is the cost the chat's decode gate exists to avoid.
      try {
        const myId = useAuthStore.getState().user?.id;
        if (myId) {
          Promise.all([import('../src/services/profilePosts'), import('../src/components/ui/CachedImage'), import('../src/lib/supabase')])
            .then(([{ peekCachedProfilePosts }, { warmIntoMemory }, { parseImageUrls }]) => {
              const isAnimated = (u: string) => /\.gif(\?|$)/i.test(u) || /giphy\.com|tenor\.com/i.test(u);
              const singles: string[] = [];
              const tiles: string[] = [];
              for (const post of peekCachedProfilePosts(myId).slice(0, 4)) {
                // The card's layout depends on how many images there are in all, GIFs included.
                const all = parseImageUrls(post.image_url);
                const stills = all.slice(0, 4).filter((u) => !isAnimated(u));
                if (all.length === 1) singles.push(...stills);
                else tiles.push(...stills);
              }
              warmIntoMemory(singles, 100);
              warmIntoMemory(tiles, 49);
            })
            .catch(() => {});
        }
      } catch {}
      try {
        // Recent chat media for the most-active conversations (already capped
        // + chunked inside the helper). entityStore was hydrated in Phase 2,
        // so the conversation list is available here.
        const convos = (useEntityStore.getState().conversations || []) as Array<{ id: string; lastMessageAt?: string }>;
        if (convos.length > 0) {
          const ids = [...convos]
            .sort((a, b) => compareIso(b.lastMessageAt || '', a.lastMessageAt || ''))
            .slice(0, 8)
            .map((c) => c.id);
          import('../src/services/messagesPrefetch')
            .then(({ prefetchRecentChatMedia }) => prefetchRecentChatMedia({ conversationIds: ids, budgetUris: 12 }))
            .catch(() => {});
        }
      } catch {
        // Warming is best-effort; never let it affect launch.
      }
    }, 1200);

    // Phase 5 — the first chat open's one-time costs, paid while the app is idle.
    //
    // Reported: right after a cold start, the first chat opened "feels bad". A Hermes CPU profile of
    // that open (production bundle) showed costs that every later open skips: running the chat
    // screen's module graph for the first time (a route module and everything it imports execute on
    // first require), and building the first date formatters, the very first of which also loads the
    // locale data. They run here instead, a few seconds after launch and in separate turns, so none
    // of them is one long task. Each is a no-op the second time.
    const prewarmTimers: ReturnType<typeof setTimeout>[] = [];
    prewarmTimers.push(setTimeout(() => {
      Promise.all([
        import('../src/i18n/store'),
        import('../src/utils/mockData'),
        import('../src/utils/shortAgo'),
        import('../src/utils/chatDaySeparators'),
      ])
        .then(([{ useI18nStore }, { formatMessageTime }, { prewarmShortAgo }, { prewarmDaySeparators }]) => {
          const locale = useI18nStore.getState().locale;
          formatMessageTime(new Date().toISOString());
          prewarmShortAgo(locale);
          prewarmDaySeparators(locale);
        })
        .catch(() => {});
    }, 2500));
    prewarmTimers.push(setTimeout(() => {
      import('./chat/[id]').catch(() => {});
    }, 3200));

    return () => {
      clearTimeout(idle);
      clearTimeout(warm);
      for (const timer of prewarmTimers) clearTimeout(timer);
    };
  }, [ready]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!useAuthStore.getState().hasHydrated) {
        useAuthStore.setState({ hasHydrated: true });
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // App foreground/background lifecycle. Single AppState listener for the whole
  // session, cleaned up on unmount. Event-driven (never on the first-render
  // path) and fully guarded so it can never throw:
  //   • → 'active'  (returning from background, possibly after days): resume the
  //                 connectivity poll (start() is idempotent-guarded), force an
  //                 immediate connectivity re-check, and — if a user is logged
  //                 in — silently revalidate the session via the EXISTING
  //                 restoreSession (confirms or cleanly clears a stale token).
  //   • → 'background': pause the 20s connectivity poll so we don't burn cycles
  //                 / battery while the app isn't visible.
  // All calls are fire-and-forget; none block anything.
  //
  // Request budget: `start()` already re-checks on a real return (the separate `checkNow()` that
  // used to follow it doubled every probe), and the session check is `/v1/auth/me` on the Worker,
  // so it runs at most every SESSION_RECHECK_MS. Revocation does not depend on it: the device
  // heartbeat above is the channel for that.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      try {
        if (next === 'active') {
          try { useConnectivityStore.getState().start(); } catch {}
          if (useAuthStore.getState().user?.id && Date.now() - lastSessionCheckAt >= SESSION_RECHECK_MS) {
            lastSessionCheckAt = Date.now();
            try { useAuthStore.getState().restoreSession().catch(() => {}); } catch {}
          }
        } else if (next === 'background') {
          try { useConnectivityStore.getState().stop(); } catch {}
        }
      } catch {
        // Never let a lifecycle transition throw.
      }
    });
    return () => {
      try { sub.remove(); } catch {}
    };
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
    {/* Server-state layer. OUTSIDE ThemeProvider on purpose: queries are data, not
        presentation, and a theme flip must never be able to remount the cache
        provider — `PersistQueryClientProvider` re-reads persisted state when its
        options identity changes, and remounting it mid-session would re-hydrate
        the whole cache. Inert until screens are migrated (nothing calls useQuery
        yet); see the long note in src/lib/queryClient.tsx. */}
    <QueryProvider>
    <KeyboardProvider>
    <ThemeProvider>
      <NavigationBarController />
      <ErrorBoundary>
      <AuthNavigationGuard>
        <BrowserMiniBar />
        <MusicBottomIndicator />
        <MusicFullPlayer />
        <Toast />
        {/* The app's one share sheet. Every "send this to someone" action anywhere routes here through
            `openShareSheet` — see `src/store/shareSheetStore.ts` for why this is a store and not a prop.
            Renders literally nothing until the first time it is opened. */}
        <ShareSheetHost />
        {/* The Stack and the minimized-session bar share one flex column: while the bar shows, a
            spacer of its height sits under the Stack, so the tab bar and every composer sit ON the
            bar instead of behind it ("I can't see what I'm tapping" was a bar that reserved no
            space). The bar itself is drawn over the bottom of this column and moves only by
            transform; the spacer changes once when it appears and once when it goes. Never animate
            the spacer's height: that re-laid out this whole tree ~23 times per transition. See
            BrowserBottomBand. */}
        <View style={styles.rootColumn}>
          <View style={styles.stackWrapper}>
            <AppStack />
          </View>
          <BrowserBottomBand />
        </View>
        {/* Floating performance monitor — sits above everything else so it
            stays visible on every screen. Defaults to ON; users can hide it
            from the panel that opens when they tap the bubble. */}
        <PerfMonitorBubble />
        {/* Persistent mini-app host — owns the mini-app WebView so collapsing
            then reopening resumes the same page (no reload). Renders only when
            a mini-app is open/minimized; nothing otherwise. */}
        <MiniAppHost />
        {/* The chat list's long-press peek menu. Drawn here, above the navigator, instead of as a
            Modal inside the held row — see src/store/chatPeekStore.ts. Renders null while closed. */}
        <ChatPeekHost />
        {/* The profile QR screen, own and anyone else's, opened through `openProfileQr`. Drawn here
            over the navigator rather than as a Modal (see src/store/profileQrStore.ts). Renders null
            while closed, and loads the screen's code the first time it opens. */}
        <ProfileQrHost />
        {/* App-wide realtime bridge — opens ONE Ably connection for the
            logged-in user, subscribes to the personal notifications
            channel so new conversations / messages show up the instant
            another user sends them. Effects-only, no rendered output.
            Connection is dropped by switchAccount() on logout / switch. */}
        <RealtimeAccountBridge />
        {/* In-app activity pill. Replaces the OS banner while the app is in the foreground: the
            actor's emoji arrives as a circle, then the glass capsule expands outward with the
            action text. Renders null when nothing is queued, so it costs nothing at idle, and the
            whole morph runs on the UI thread via Reanimated shared values — which is what keeps it
            smooth while a transcript is committing 4-12 bubbles at ~22 ms each. zIndex 900, below
            `DynamicOverlayHost`, so the two can never contend for the notch region. */}
        <InAppAlertHost />
      </AuthNavigationGuard>
      </ErrorBoundary>
    </ThemeProvider>
    </KeyboardProvider>
    </QueryProvider>
    </GestureHandlerRootView>
  );
}

// Navigator extracted into its own component so it can read the active theme
// (RootLayout sits ABOVE ThemeProvider and can't call useTheme). The key bit
// is `contentStyle`: it paints every native-stack scene on the theme
// background, which kills the white sliver/flash that showed during screen
// transitions and modal dismissals (e.g. closing a mini-app) when the OS color
// scheme didn't match the app's dark theme.
// ── PUSH TRANSITIONS ─────────────────────────────────────────────────────────
//
// Android: `ios_from_right` — the new screen slides in from the right while the previous one
// shifts left underneath, the same push Telegram uses on both platforms. It is a native fragment
// animation inside react-native-screens 4.16 (FragmentTransactionKt.kt), so it runs on the UI
// thread and is not slowed by a busy JS thread. iOS keeps UIKit's own push ('default').
//
// iOS full-screen back swipe (`fullScreenGestureEnabled`) only on screens that are plain vertical
// lists: anywhere on the screen, not just the edge, like Telegram. Deliberately NOT global: on a
// screen with a horizontal scroller or a horizontal gesture (the chat's swipe-to-reply) the two
// pans compete, and that needs a device test before it ships. RNS 4.16 disables iOS 26's own
// content pop recogniser and uses its RNSPanGestureRecognizer for this, gated per screen.
const SWIPE_BACK_ANYWHERE = { fullScreenGestureEnabled: true } as const;

// ── THE KEYBOARD GOES DOWN AS SOON AS A SCREEN STARTS TO LEAVE ───────────────
//
// Reported: with the keyboard up in a chat, starting the swipe back and moving the finger up and
// down made the input bar follow the finger while the keyboard itself stayed put. In Telegram the
// keyboard drops the moment the swipe begins.
//
// UIKit calls `viewWillDisappear` when the interactive pop STARTS, which native-stack emits as
// `transitionStart` with `closing: true` (NativeStackView.native.js). The same event fires on a
// screen that is being covered by a push, where putting the keyboard away is right too. One listener
// on the root stack covers every screen; if the swipe is cancelled the keyboard simply stays down.
const DISMISS_KEYBOARD_ON_LEAVE = {
  transitionStart: (e: { data?: { closing?: boolean } }) => {
    if (e?.data?.closing) Keyboard.dismiss();
  },
};

function AppStack() {
  const theme = useTheme();
  const screenOptions = React.useMemo(
    () => ({
      headerShown: false,
      contentStyle: { backgroundColor: theme.colors.background.primary },
      animation: Platform.OS === 'android' ? ('ios_from_right' as const) : ('default' as const),
    }),
    [theme.colors.background.primary],
  );
  return (
    <Stack screenOptions={screenOptions} screenListeners={DISMISS_KEYBOARD_ON_LEAVE as any}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="chat/[id]" />
      <Stack.Screen name="chat/ai" />
      <Stack.Screen name="chat/music" />
      {/* A normal pushed screen, like Telegram's profile editor, not a sheet sliding up from the
          bottom. Swipe back from anywhere, same as the profiles it is opened from. */}
      <Stack.Screen name="profile/edit" options={SWIPE_BACK_ANYWHERE} />
      {/* New post, opened from «Публикации» on your own profile. */}
      <Stack.Screen name="post/new" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="profile/[id]" options={SWIPE_BACK_ANYWHERE} />
      {/* @mention resolver. A username is not an id, so tapping a mention lands here, the lookup
          runs, and it either `replace`s itself with the profile or shows "no such user". */}
      <Stack.Screen name="u/[username]" options={SWIPE_BACK_ANYWHERE} />
      <Stack.Screen name="comments/[id]" />
      <Stack.Screen name="browser" options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
      <Stack.Screen name="mini-app" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="mini/[id]" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="m/[short]" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="settings/index" options={SWIPE_BACK_ANYWHERE} />
      <Stack.Screen name="settings/appearance" />
      <Stack.Screen name="settings/profile-theme" />
      <Stack.Screen name="settings/widget" />
      <Stack.Screen name="settings/storage" />
      <Stack.Screen name="settings/device-key" />
      {/* `settings/privacy` was removed with its screen: it rendered the privacy POLICY a second
          time (nine sections, EN/RU toggle), duplicating the Legal section's hosted link, and its
          copy had gone stale — still naming Supabase and Vercel as the backend after the move to
          Cloudflare Workers + D1. Two copies of a legal document means one of them drifts. */}
      <Stack.Screen name="settings/devices" />
      <Stack.Screen name="settings/admin" />
      <Stack.Screen name="settings/fonts" />
      <Stack.Screen name="settings/fonts-size" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/fonts-family" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/mini-apps" />
      <Stack.Screen name="settings/chat-settings" />
      <Stack.Screen name="settings/chat-background" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/chat-text-size" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/chat-bubble-radius" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/chat-bubble-color" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/chat-font" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/browser" />
      <Stack.Screen name="settings/language" />
      <Stack.Screen name="settings/pixel-icons" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/mini-app-preview" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  // Over the app (see AuthNavigationGuard): above the navigator and every host in the guard's tree.
  loadingContainer: { ...StyleSheet.absoluteFillObject, zIndex: 5000, elevation: 50, justifyContent: 'center', alignItems: 'center', backgroundColor: '#141414' },
  guardRoot: { flex: 1 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  rootColumn: { flex: 1 },
  stackWrapper: { flex: 1 },
  gestureRoot: { flex: 1 },
});

// Wrap with Sentry.wrap so the root component is included in the
// performance + error reporting envelope. This is the recommended way to
// register the entry component per Sentry React Native docs.
//
// `maxComponentTreeSize: 0` turns off touch breadcrumbs. On every touch start, `TouchEventBoundary`
// walks the fiber tree from the touched view toward the root looking for 20 named components, then
// sends a breadcrumb to the native SDK. This app has no component-name annotation, so few fibers are
// named and the walk runs most of the way up. In the emulator profile of fast-scrolling a long chat
// that was 117 ms of JS time over about 20 flings, each one at the start of a gesture. Navigation and
// console breadcrumbs, errors and traces are unaffected. Interaction spans were already off
// (`enableUserInteractionTracing` is not set).
export default Sentry.wrap(RootLayout, { touchEventBoundaryProps: { maxComponentTreeSize: 0 } });
