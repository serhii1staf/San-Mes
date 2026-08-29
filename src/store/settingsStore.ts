import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const appStorage: StateStorage = {
  setItem: async (name: string, value: string) => { await AsyncStorage.setItem(name, value); },
  getItem: async (name: string) => { return await AsyncStorage.getItem(name); },
  removeItem: async (name: string) => { await AsyncStorage.removeItem(name); },
};

interface SettingsState {
  hapticEnabled: boolean;
  useInAppBrowser: boolean;
  // Where the minimized browser/mini-app pill appears. "top" floats it under
  // the status bar (default), "bottom" docks it above the tab bar with the
  // same rounded glass styling — the rest of the UI keeps full reach without
  // the pill cutting into the safe-area indicator at the top of the screen.
  browserWidgetPosition: 'top' | 'bottom';
  // In-app perf monitor — small draggable bubble that shows live JS/UI FPS
  // and opens a panel with recent navigation/timing events. Default ON so
  // QA / the dev can spot jank in the wild without a separate debug build.
  perfMonitorEnabled: boolean;
  perfMonitorPosX: number; // last drop position in px (top-left origin)
  perfMonitorPosY: number;
  // Filter chip selection persisted across panel re-opens. Keys mirror the
  // PerfEventKind values the panel filters on (NAV, MOUNT, INPUT, IMG, LONG,
  // UI, MARK). Missing key = filter on (default-on behaviour).
  perfMonitorFilters: Record<string, boolean>;
  // Decorative pixel-icon next to the "San" title on the home feed
  // header. Stable registry id (e.g. `pack-1/01_ghost_king`) or `null`
  // when the user hasn't picked one — the title then stays bare.
  // Picked via the existing pixel-icons screen launched with
  // `?purpose=home-header` from a long-press on the title.
  homeHeaderIcon: string | null;
  // Background image rendered full-bleed inside `MiniAppPreviewCard`.
  // Stable registry id from `mini-app-previews/registry.ts` (e.g.
  // `preview_3`) or `null` when the card stays transparent (default).
  // Picked from `app/settings/mini-app-preview.tsx`.
  miniAppPreviewBg: string | null;
  // Long-press customization for the OWN-profile category tabs (Posts /
  // Replies / Media / Likes). Keyed by tab key; missing key = use the
  // default i18n label and no emoji prefix. Read by both `(tabs)/profile`
  // and `profile/[id]` (the latter only when the displayed profile id
  // matches the current user). Other-user profiles always render defaults.
  profileTabsCustom: Record<string, { label?: string; emoji?: string }>;
  // Native iOS-26 liquid glass (expo-glass-effect). Only has any effect on
  // iOS 26+ devices where the effect is actually available — everywhere else
  // it's a no-op and the settings toggle is hidden. Default ON so capable
  // devices get the look out of the box; flipping it OFF fully unmounts every
  // GlassView (no residual layer).
  liquidGlassEnabled: boolean;
  /**
   * Real blur on ANDROID (`expo-blur`'s `experimentalBlurMethod: 'dimezisBlurView'`).
   *
   * ── WHY THIS FIELD HAD TO EXIST ───────────────────────────────────────────
   *
   * `AppBlurView` used to gate the Android blur path on `liquidGlassEnabled` above, on the reasoning
   * that it was "a switch the user already has and which is currently inert on their platform".
   *
   * That flag defaults to TRUE, and the comment on it says the effect is "a no-op everywhere else" —
   * which stopped being true the moment it acquired a second meaning. So every Android install was
   * running `dimezisBlurView` on every piece of chrome, which the Expo docs describe as experimental
   * and liable to decrease performance, and the settings row that would switch it off is hidden on
   * Android because it is gated on `isNativeGlassCapable()` (iOS-only). No Android user could turn it
   * off, and nothing in the UI said it was on.
   *
   * Measured on the emulator with `dumpsys gfxinfo`, eight identical swipes on the profile screen:
   * 36.84% janky frames, a 42 ms median frame time, 91 of 91 janky frames flagged `Slow UI thread`,
   * and 56 frames blocked on `Slow bitmap uploads` — a counter the earlier documented baseline for
   * this app recorded as ZERO. dimezis blur works by snapshotting the view hierarchy beneath it and
   * blurring it, which is UI-thread work producing a bitmap upload, per frame, behind chrome that
   * sits over a scrolling list.
   *
   * Default FALSE, and deliberately its OWN field rather than a condition added to the existing one:
   * the failure was a shared flag quietly growing a second meaning, so giving Android its own switch
   * is the fix and not just a different default. Android's default surface stays the tonal fill, which
   * is what Material specifies for an elevated surface anyway.
   */
  androidBlurEnabled: boolean;
  // Push notifications master switch. Default ON (the app registers a token
  // after login). Flipping it OFF unregisters the device token from the
  // backend so the server stops fanning pushes to this device, and prevents
  // re-registration on next launch until turned back on. Local in-app badges
  // are unaffected — this only governs off-screen Expo/APNs/FCM pushes.
  pushNotificationsEnabled: boolean;
  /**
   * Per-category alert preferences: messages / comments / follows / likes.
   *
   * ── WHAT THESE HONESTLY CONTROL, AND WHAT THEY DO NOT ─────────────────────
   *
   * They control everything the app decides: the in-app glass pill, the sound, the banner while the
   * app is in the FOREGROUND, and the Notification Centre entry. They do NOT stop the server sending
   * a push, because they cannot — `sendPushToUser` in the Worker reads only "does this user have a
   * token row", there is no category parameter and `push_tokens` has no preference column, so
   * per-category muting server-side needs a D1 migration plus a deploy.
   *
   * That boundary is stated in the UI rather than hidden: the screen labels this section as in-app
   * alerts and keeps `pushNotificationsEnabled` as the only switch that truthfully claims "no
   * pushes at all" (it deletes the token, which makes the Worker's `if (!rows.length) return` the
   * real stop). Shipping a per-category toggle that silently still shows a lock-screen banner would
   * be a setting that lies.
   *
   * The shape is deliberately forward-compatible: when the Worker gains a preference column, the
   * same keys get POSTed alongside the token and start suppressing delivery too, with no migration
   * of this stored value.
   *
   * `likes` is included even though likes send no push today (the like route only publishes a
   * realtime `notif.like`), because the pill and the bell badge ARE fed from that event — so the
   * toggle does something real immediately.
   *
   * No `version` bump needed: zustand's default `merge` layers the persisted object over current
   * defaults, so existing installs simply take the default for a newly-added key.
   */
  notifyCategories: { message: boolean; comment: boolean; follow: boolean; like: boolean };
  // Custom outgoing message color/style: { colors:[c] solid | [c1,c2] gradient,
  // opacity } OR null to follow the theme accent (default). App-wide. The chat
  // screen picks a contrast-aware text color so any style stays readable.
  chatBubble: import('../constants/bubbleColors').BubbleStyle | null;
  // Same, but for INCOMING (received) messages. null = the default neutral
  // surface (theme tertiary). Lets users recolor the other person's bubbles too.
  chatBubbleIn: import('../constants/bubbleColors').BubbleStyle | null;
  setHaptic: (enabled: boolean) => void;
  setInAppBrowser: (enabled: boolean) => void;
  setBrowserWidgetPosition: (position: 'top' | 'bottom') => void;
  setPerfMonitorEnabled: (enabled: boolean) => void;
  setPerfMonitorPosition: (x: number, y: number) => void;
  setPerfMonitorFilter: (kind: string, on: boolean) => void;
  setHomeHeaderIcon: (id: string | null) => void;
  setMiniAppPreviewBg: (id: string | null) => void;

  // Apply / clear a single tab's customization. `value` carries an optional
  // `label` (empty string treated as cleared) and optional `emoji` prefix;
  // `clearProfileTabCustom` removes the key entirely so the default returns.
  setProfileTabCustom: (key: string, value: { label?: string; emoji?: string }) => void;
  clearProfileTabCustom: (key: string) => void;
  setLiquidGlassEnabled: (enabled: boolean) => void;
  setAndroidBlurEnabled: (enabled: boolean) => void;
  setPushNotificationsEnabled: (enabled: boolean) => void;
  setNotifyCategory: (kind: 'message' | 'comment' | 'follow' | 'like', enabled: boolean) => void;
  setChatBubble: (style: import('../constants/bubbleColors').BubbleStyle | null) => void;
  setChatBubbleIn: (style: import('../constants/bubbleColors').BubbleStyle | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      hapticEnabled: true,
      useInAppBrowser: true,
      browserWidgetPosition: 'top',
      // ── PERF MONITOR DEFAULTS OFF ─────────────────────────────────────────
      //
      // This used to default ON, with the reasoning "so QA / the dev can spot
      // jank in the wild without a separate debug build". The instrument turned
      // out to be a measurable part of the jank it was reporting, on every
      // screen, for every user:
      //   - `PerfMonitorBubble` arms a `useFrameCallback` worklet, which is an
      //     unconditional per-frame callback on the UI thread. It is mounted
      //     globally from `app/_layout.tsx`, so no screen escapes it.
      //   - `ProfilePostCard` and `UserProfilePostCard` each take a Zustand
      //     SUBSCRIPTION to this very flag — per list row — and call `Date.now()`
      //     in the render body when it is on.
      //   - `CachedImage` does a store read on every image load and decode.
      //   - `chat/[id]` wraps real work in `perfSpan()`.
      // Device measurement (adb gfxinfo, which is outside the app and therefore
      // unaffected by this flag) put switch-tab at 60% of frames over budget and
      // caught single frames spending 270 ms inside animation callbacks.
      //
      // A profiler that is on by default is not a free safety net; it is a tax
      // on the exact code path it claims to measure. It stays one tap away in
      // Settings → Monitor производительности for whenever it is actually
      // wanted, and `perfMonitor` is local-only (nothing is transmitted), so
      // this changes no data flow and no privacy disclosure.
      //
      // Position/filters below are untouched — they only matter once enabled.
      // Negative positions act as "unset"; the bubble computes its initial
      // position on mount when it sees -1.
      perfMonitorEnabled: false,
      perfMonitorPosX: -1,
      perfMonitorPosY: -1,
      // Default: every chip on, so first-time openers see all events.
      perfMonitorFilters: {
        NAV: true,
        MOUNT: true,
        INPUT: true,
        IMG: true,
        LONG: true,
        UI: true,
        MARK: true,
      },
      // No icon by default — the "San" title stands alone unless the
      // user explicitly picks one from the pixel-icons picker.
      homeHeaderIcon: null,
      // No preview-card background by default — `MiniAppPreviewCard`
      // keeps its current transparent look until the user picks one.
      miniAppPreviewBg: null,

      // No tab customizations until the user long-presses a tab and applies
      // one. Empty record reads as "every tab uses its default i18n label".
      profileTabsCustom: {},
      // Liquid glass ON by default. Reaches the screen only on iOS 26+, where the effect exists:
      // `useLiquidGlassActive()` requires `NATIVE_GLASS_CAPABLE`, which is false off iOS by
      // construction. It no longer means anything on Android — see `androidBlurEnabled` for the
      // damage done while it did.
      liquidGlassEnabled: true,
      // Android real blur OFF by default. See the long note on the field: gating it on the flag above
      // silently enabled an experimental, UI-thread-bound blur for every Android install, with no
      // reachable way to switch it off.
      androidBlurEnabled: false,
      // Push notifications ON by default — matches the existing behaviour
      // where the app registers a push token after login.
      pushNotificationsEnabled: true,
      // All categories on, matching today's behaviour exactly — so this field changes nothing until
      // the user turns something off.
      notifyCategories: { message: true, comment: true, follow: true, like: true },
      // Null = follow the theme accent (current behaviour).
      chatBubble: null,
      chatBubbleIn: null,
      setHaptic: (hapticEnabled) => set({ hapticEnabled }),
      setInAppBrowser: (useInAppBrowser) => set({ useInAppBrowser }),
      setBrowserWidgetPosition: (browserWidgetPosition) => set({ browserWidgetPosition }),
      setPerfMonitorEnabled: (perfMonitorEnabled) => set({ perfMonitorEnabled }),
      setPerfMonitorPosition: (perfMonitorPosX, perfMonitorPosY) =>
        set({ perfMonitorPosX, perfMonitorPosY }),
      setPerfMonitorFilter: (kind, on) =>
        set((s) => ({ perfMonitorFilters: { ...s.perfMonitorFilters, [kind]: on } })),
      setHomeHeaderIcon: (homeHeaderIcon) => set({ homeHeaderIcon }),
      setMiniAppPreviewBg: (miniAppPreviewBg) => set({ miniAppPreviewBg }),
      // Tab-customization setters. Apply normalises the input: an empty
      // label string AND no emoji collapses to a clear (no point storing
      // an entry that has no effect). Anything else merges into the
      // existing record so other tabs' customizations survive untouched.
      setProfileTabCustom: (key, value) =>
        set((s) => {
          const label = value.label?.trim() || undefined;
          const emoji = value.emoji || undefined;
          if (!label && !emoji) {
            // Treat as a clear — drop the key entirely.
            const next = { ...s.profileTabsCustom };
            delete next[key];
            return { profileTabsCustom: next };
          }
          return {
            profileTabsCustom: {
              ...s.profileTabsCustom,
              [key]: { label, emoji },
            },
          };
        }),
      clearProfileTabCustom: (key) =>
        set((s) => {
          if (!s.profileTabsCustom[key]) return s;
          const next = { ...s.profileTabsCustom };
          delete next[key];
          return { profileTabsCustom: next };
        }),
      setLiquidGlassEnabled: (liquidGlassEnabled) => set({ liquidGlassEnabled }),
      setAndroidBlurEnabled: (androidBlurEnabled) => set({ androidBlurEnabled }),
      setPushNotificationsEnabled: (pushNotificationsEnabled) => set({ pushNotificationsEnabled }),
      setNotifyCategory: (kind, enabled) =>
        set((s) => ({ notifyCategories: { ...s.notifyCategories, [kind]: enabled } })),
      setChatBubble: (chatBubble) => set({ chatBubble }),
      setChatBubbleIn: (chatBubbleIn) => set({ chatBubbleIn }),
    }),
    {
      name: 'app-settings',
      storage: createJSONStorage(() => appStorage),
      // ── WHY A VERSION BUMP IS REQUIRED, NOT JUST A NEW DEFAULT ──────────────
      //
      // Flipping `perfMonitorEnabled` to `false` above only affects FRESH
      // installs. Zustand's persist middleware merges with a shallow spread in
      // which the persisted value wins (`{ ...currentState, ...persistedState }`
      // is the documented default `merge`), so every device that has already run
      // the app — which is every existing user, and the dev's own phone — would
      // read its stored `true` straight back over the new default and keep the
      // per-frame worklet forever.
      //
      // Per the persist docs, `version` defaults to 0 and `migrate` runs when the
      // version stored alongside the data does not match the version in code.
      // There was no `version` before, so all existing data reads as 0 and this
      // migration runs exactly once per install.
      //
      // The migration is deliberately narrow: it forces this ONE field and
      // passes everything else through untouched. It is not a reset — haptics,
      // theme, bubble styles, tab customizations, browser prefs and push opt-in
      // all survive. Returning `migrate`'s result unmerged for unknown future
      // versions is fine because `merge` still layers it over the current
      // defaults, so a field added later simply takes its default.
      version: 1,
      migrate: (persistedState, version) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState as SettingsState;
        }
        if (version < 1) {
          return {
            ...(persistedState as Partial<SettingsState>),
            perfMonitorEnabled: false,
          } as SettingsState;
        }
        return persistedState as SettingsState;
      },
    }
  )
);

/**
 * Is this alert category enabled?
 *
 * A plain function rather than a hook, because both callers are outside React:
 * `handleNotification` in pushNotifications.ts is a native callback, and the realtime bridge's
 * handlers are Ably subscriptions. Reads through `getState()` so it always sees the current value
 * without subscribing anything.
 *
 * Fails OPEN on any unexpected shape. An unreadable preference must not silently swallow a
 * notification — the same rule `shouldPresent` already follows for an unrecognised payload type,
 * and for the same reason: showing one alert too many is a far smaller failure than never telling
 * the user something happened.
 */
export function isAlertCategoryEnabled(kind: 'message' | 'comment' | 'follow' | 'like'): boolean {
  try {
    const cats = useSettingsStore.getState().notifyCategories;
    if (!cats || typeof cats !== 'object') return true;
    return cats[kind] !== false;
  } catch {
    return true;
  }
}
