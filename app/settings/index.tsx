import React, { useState, useEffect } from 'react';
import { View, ScrollView, Pressable, Switch, ViewStyle, Alert, StyleSheet, Linking, InteractionManager, Platform } from 'react-native';
/**
 * ── WHY MaterialIcons AND NOT Feather FOR THE SETTINGS TILES ───────────────────
 *
 * Asked, twice, with a Telegram screenshot: the icons look thin, and Telegram's look "professional"
 * and somehow bigger without actually being bigger.
 *
 * That is a stroke-vs-fill difference, not a size one. Feather is an OUTLINE set drawn with a uniform
 * 2 px stroke and no fill — every glyph is a hollow line drawing, which is exactly what "thin" means
 * here. Telegram's settings icons are not from a public icon font at all; they are drawn, solid
 * shapes. The closest thing available without adding a dependency is MaterialIcons, which is filled
 * by default and ships inside `@expo/vector-icons` alongside Feather.
 *
 * A previous round declined to import it, on the grounds that a second icon FONT was a bad trade for
 * four glyphs. That reasoning was right for four glyphs and wrong for nineteen: the whole tile set
 * moves here, so Feather is no longer paying for itself on this screen at all.
 *
 * The mapping also gets more literal in the places Feather had no honest glyph, which was the earlier
 * complaint about meaning rather than weight:
 *
 *   haptics       activity   -> vibration      a phone emitting vibration, not a pulse standing in
 *   appearance    sun        -> palette        a theme is a palette; `sun` meant brightness
 *   liquid glass  droplet    -> blur-on        the effect itself, rather than a pun on "liquid"
 *   storage       hard-drive -> storage        MaterialIcons names the concept directly
 *   perf monitor  bar-chart-2-> insights
 *   fonts         type       -> text-fields
 *   widget        layout     -> widgets
 *   devices       smartphone -> devices        plural, which is what the row lists
 *
 * `Feather` is still imported: the chevron, the back arrow and the rest of this screen's chrome use
 * it, and those ARE line icons by design. Only the tiles changed.
 */
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { useSettingsStore } from '../../src/store/settingsStore';
import { isNativeGlassCapable } from '../../src/components/ui/LiquidGlass';
import { useT } from '../../src/i18n/store';
import { PROFILE_THEMES_ENABLED } from '../../src/theme/profileThemes';
import { bottomScrimColors, headerScrimHeights, SCRIM_LOCATIONS, topScrimColors } from '../../src/theme/scrim';

// Per-row tint pairs (icon color + soft tile bg) — picked to be readable in
// both light and dark mode without being eye-piercing. Same hue family as
// system iOS Settings but desaturated.
/**
 * ── SOLID TILES WITH A WHITE GLYPH, PER THE REFERENCE SCREENSHOT ──────────────
 *
 * Asked, with a Telegram settings screenshot attached: can the icons look like that.
 *
 * The shape was already right — a 32 pt rounded square, radius 12 — so the difference was entirely
 * the FILL. Ours drew the tint at 16 % alpha behind a glyph in the same colour, which reads as a
 * pale wash with a coloured symbol on it. The reference draws the tint at FULL saturation with the
 * glyph knocked out in white, which is what gives those rows their weight and makes each icon read
 * as an object rather than as tinted text.
 *
 * So `bg` is gone and `fg` is now the fill. `on` is the glyph colour, white everywhere except
 * yellow: white on #FFD60A is roughly a 1.3:1 contrast ratio and effectively unreadable, so that one
 * takes a near-black glyph. Same reason the reference has no white-on-yellow tile either.
 */
/**
 * ── WHY THESE GLYPHS, AND WHY NO SECOND ICON FONT ─────────────────────────────
 *
 * Reported: several icons did not mean anything close to their row — a paper plane for push
 * notifications, a lightning bolt for haptics, a droplet for Appearance.
 *
 * All true. The temptation was to pull in MaterialIcons (which has literal `vibration`, `palette`,
 * `blur_on`) — it ships inside `@expo/vector-icons`, so it costs no new dependency. It does cost a
 * second icon FONT in the bundle, and for four glyphs that is a bad trade.
 *
 * All four turned out to be solvable inside Feather, once two rows that were HOARDING the right
 * glyph gave it up:
 *
 *   Push notifications   send -> bell           a bell is the notification icon; `send` meant "send
 *                                               a message", which is a different feature entirely.
 *   Notifications feed   bell -> inbox          this row opens a LIST of received notifications, so
 *                                               it is an inbox. Giving up `bell` is what freed it.
 *   Haptics              zap -> activity        a pulse waveform. `zap` is energy/power, not touch.
 *   Perf monitor         activity -> bar-chart-2  it renders FPS charts, so this is more literal than
 *                                               the pulse was — and it released `activity`.
 *   Appearance           droplet -> sun         the conventional light/dark theme glyph.
 *   Liquid glass         aperture -> droplet    liquid, literally. Freed by Appearance above.
 *
 * The pattern worth keeping: two of these were not missing glyphs, they were glyphs assigned to the
 * wrong row. Reassigning beat importing.
 */
const ICON_TINTS = {
  blue:    { fg: '#0A84FF', on: '#FFFFFF' },
  red:     { fg: '#FF453A', on: '#FFFFFF' },
  orange:  { fg: '#FF9F0A', on: '#FFFFFF' },
  yellow:  { fg: '#FFD60A', on: '#1C1C1E' },
  green:   { fg: '#30D158', on: '#FFFFFF' },
  teal:    { fg: '#40C8E0', on: '#FFFFFF' },
  cyan:    { fg: '#64D2FF', on: '#1C1C1E' },
  indigo:  { fg: '#5E5CE6', on: '#FFFFFF' },
  purple:  { fg: '#BF5AF2', on: '#FFFFFF' },
  pink:    { fg: '#FF66D9', on: '#FFFFFF' },
  gray:    { fg: '#8E8E93', on: '#FFFFFF' },
} as const;
type IconTint = keyof typeof ICON_TINTS;

function SettingsRow({
  icon,
  iconTint,
  label,
  value,
  onPress,
  showChevron = true,
  rightElement,
  isLast,
  destructive,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  iconTint: IconTint;
  label: string;
  value?: string;
  onPress?: () => void;
  showChevron?: boolean;
  rightElement?: React.ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
  /**
   * Tints the LABEL with the error colour. For the two irreversible account
   * actions, which used to be hand-built Pressables outside any card.
   *
   * A flag on the shared row rather than a bespoke component: the whole point of
   * moving them in here is that they get the same height, the same icon tile, the
   * same separators and the same press feedback as every other row. Re-styling
   * them at the call site would have reintroduced exactly the inconsistency that
   * made the old pair look out of place.
   */
  destructive?: boolean;
}) {
  const theme = useTheme();
  const tint = ICON_TINTS[iconTint];
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: theme.colors.border.light,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          // Round-rectangle iOS-Settings-style tile. Bumped 9 -> 12 (~37%
          // radius) per the follow-up UX request to soften the corners a bit
          // more (squircle-leaning) while keeping the silhouette square rather
          // than fully circular.
          borderRadius: 12,
          // Full-saturation fill, not a 16 % wash — see the note on ICON_TINTS.
          backgroundColor: tint.fg,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 14,
        }}
      >
        {/* 19, up from 16. A FILLED glyph reads smaller than an outline of the same nominal size,
            because an outline's stroke sits on the outside of its silhouette while a filled shape is
            the silhouette. Keeping 16 here is what would make these look like small icons on big
            tiles — which is the opposite of the "they look bigger" quality being asked for. */}
        <MaterialIcons name={icon} size={19} color={tint.on} />
      </View>
      <Text
        variant="body"
        color={destructive ? theme.colors.status.error : undefined}
        style={{ flex: 1 }}
      >
        {label}
      </Text>
      {value && (
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginRight: 8 }}>
          {value}
        </Text>
      )}
      {rightElement}
      {showChevron && !rightElement && (
        <Feather name="chevron-right" size={18} color={theme.colors.text.tertiary} />
      )}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Field-level selector — destructuring the whole auth store re-rendered
  // this screen on every unrelated auth-state change.
  const logout = useAuthStore((s) => s.logout);
  // Field-level selectors — pulling the whole settings store re-rendered
  // the screen on every unrelated state change.
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const useInAppBrowser = useSettingsStore((s) => s.useInAppBrowser);
  const perfMonitorEnabled = useSettingsStore((s) => s.perfMonitorEnabled);
  const setHaptic = useSettingsStore((s) => s.setHaptic);
  const setInAppBrowser = useSettingsStore((s) => s.setInAppBrowser);
  const setPerfMonitorEnabled = useSettingsStore((s) => s.setPerfMonitorEnabled);
  const pushNotificationsEnabled = useSettingsStore((s) => s.pushNotificationsEnabled);

  const liquidGlassEnabled = useSettingsStore((s) => s.liquidGlassEnabled);
  const setLiquidGlassEnabled = useSettingsStore((s) => s.setLiquidGlassEnabled);
  // The liquid-glass toggle is only meaningful on iOS 26+ devices where the
  // effect can actually render. Hide it everywhere else — a toggle that does
  // nothing is worse than no toggle. Computed once (capability is static).
  const glassCapable = isNativeGlassCapable();
  const [iconModalVisible, setIconModalVisible] = useState(false);
  // App version + AppIconModal are deferred past the navigation transition.
  // - `expo-alternate-app-icons` (imported inside AppIconModal) is a native
  //   module touched ONLY on this screen, so a static import resolves on the
  //   first push to /settings — landing on the same JS frame as the open
  //   animation and producing `SLOW long task @ settings` (~150 ms).
  // - `expo-constants` is also settings-only here and reading
  //   `Constants.expoConfig?.version` first-time can warm a sizeable JSON.
  // Lazy-require both after `runAfterInteractions` and gate the modal's
  // mount on the resolved component. The "App icon" row stays tappable —
  // the modal becomes visible once the component is loaded (effectively
  // one frame later on weak devices, instant on warm devices).
  const [appVersion, setAppVersion] = useState('1.0.0');
  // Module-scope would be nicer, but this file's imports are already ordered around the lazy requires
  // below; a const here is evaluated once per mount and `Platform.OS` is a static string.
  const IS_IOS = Platform.OS === 'ios';
  const [AppIconModalLazy, setAppIconModalLazy] = useState<null | React.ComponentType<{ visible: boolean; onClose: () => void }>>(null);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ExpoConstants = require('expo-constants').default;
        setAppVersion(ExpoConstants?.expoConfig?.version || '1.0.0');
      } catch {}
      // Skipped entirely on Android: the row that opens this modal is iOS-only now (see the note at
      // the rows), and `AppIconModal` pulls in `expo-alternate-app-icons`, an iOS-only native module.
      // Requiring it on Android resolved a module that can never do anything and mounted a component
      // nothing could reach.
      // Read `Platform.OS` directly rather than closing over `IS_IOS`, so the effect's empty dep list
      // stays honest instead of depending on a value recomputed every render.
      if (Platform.OS === 'ios') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mod = require('../../src/components/ui/AppIconModal');
          // Pass the component via the function-form setter so React doesn't
          // try to call it as a state updater.
          setAppIconModalLazy(() => mod.AppIconModal);
        } catch {}
      }
    });
    return () => handle.cancel();
  }, []);

  // Hidden admin access: tap the "Безопасность" section title 6 times quickly.
  const adminTapCount = React.useRef(0);
  const adminLastTap = React.useRef(0);
  const handleAdminTap = () => {
    const now = Date.now();
    if (now - adminLastTap.current > 2000) adminTapCount.current = 0;
    adminLastTap.current = now;
    adminTapCount.current++;
    if (adminTapCount.current >= 6) {
      adminTapCount.current = 0;
      router.push('/settings/admin' as any);
    }
  };

  // `handleTogglePush` lived here and now lives in `app/settings/notifications.tsx`, next to the
  // switch it drives. Deliberately MOVED rather than copied: two places calling
  // `registerForPush`/`unregisterPush` on the same flag is how they drift, and the flag is still read
  // here only to show On/Off as the row's value.

  const handleLogout = () => {
    Alert.alert(t('settings.logout_title'), t('settings.logout_msg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.logout_action'),
        style: 'destructive',
        onPress: () => {
          // Flush this account's in-memory data and re-scope cache to anon so the
          // next account never sees the previous one's feed/chats/profile.
          try { require('../../src/services/accountSwitch').switchAccount(null); } catch {}
          logout();
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t('settings.delete_account_title'),
      t('settings.delete_account_msg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.delete_forever'),
          style: 'destructive',
          onPress: async () => {
            const uid = useAuthStore.getState().user?.id;
            if (!uid) return;
            try {
              const { deleteAccount } = await import('../../src/lib/supabase');
              const { error } = await deleteAccount(uid);
              if (error) {
                Alert.alert(t('common.error'), error);
                return;
              }
              // Wipe ALL on-device data so nothing about the user remains locally
              // (App Store / Google Play data-deletion requirement).
              try {
                const { kvClearAll } = await import('../../src/services/kvStore');
                await kvClearAll();
              } catch {}
            } catch (e: any) {
              Alert.alert(t('common.error'), e?.message || t('settings.delete_failed'));
              return;
            }
            // Guard handles the redirect synchronously once auth clears.
            logout();
          },
        },
      ]
    );
  };

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';
  const { content: headerContentHeight, gradient: headerGradientHeight } = headerScrimHeights(insets.top);

  const sectionCardStyle: ViewStyle = {
    backgroundColor: theme.colors.background.elevated,
    borderRadius: 24,
    marginBottom: 24,
    overflow: 'hidden',
  };

  const sectionTitleStyle: ViewStyle = {
    marginBottom: 8,
    paddingHorizontal: 4,
  };

  return (
    <View style={containerStyle}>
      {/* Gradient fade header */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, height: headerGradientHeight }} pointerEvents="box-none">
        <LinearGradient
          colors={topScrimColors(theme.isDark, bgColor)}
          locations={SCRIM_LOCATIONS}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: theme.spacing.lg,
            paddingTop: insets.top + 8,
            paddingBottom: 8,
            position: 'relative',
          }}
          pointerEvents="auto"
        >
          <Pressable
            onPress={() => router.back()}
            style={{ position: 'absolute', left: theme.spacing.lg, top: insets.top + 8 }}
          >
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="subheading" weight="bold">{t('settings.title')}</Text>
        </View>
      </View>

      {/* Scrollable Content */}
      <ScrollView contentContainerStyle={{ paddingBottom: 100, paddingHorizontal: theme.spacing.lg, paddingTop: headerContentHeight }} showsVerticalScrollIndicator={false}>
        {/* General */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.section.general')}
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="person"
            iconTint="blue"
            label={t('settings.profile')}
            onPress={() => router.push('/profile/edit')}
            isFirst
          />
          <SettingsRow
            icon="inbox"
            iconTint="red"
            label={t('settings.notifications')}
            onPress={() => router.push('/notifications')}
          />
          {/* ── PUSH IS A SUB-SCREEN NOW, NOT AN INLINE SWITCH ──────────────────
              It grew a second dimension. There are per-category preferences (messages / comments /
              follows / likes) alongside the master switch, and four more toggles inlined here would
              have made this the longest card on the screen while burying the one switch that
              actually stops delivery. The row shows the master state as its value so the
              information is not lost by moving. */}
          <SettingsRow
            icon="notifications-active"
            iconTint="pink"
            label={t('settings.push_notifications', 'Push-уведомления')}
            value={pushNotificationsEnabled !== false ? t('common.on', 'Вкл.') : t('common.off', 'Выкл.')}
            onPress={() => router.push('/settings/notifications' as any)}
            isLast
          />
        </View>

        {/* ── Chats ────────────────────────────────────────────────────────────
            NEW SECTION, and its absence was the clearest gap in this screen: this is a messenger
            whose settings root had nothing about chats. Both destinations already existed and were
            simply unreachable from here — `chat-settings.tsx` and `stickers.tsx` were only ever
            opened from inside a conversation, so app-wide defaults could not be found at all. */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.section.chats', 'Чаты')}
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="chat-bubble"
            iconTint="blue"
            label={t('settings.chat_settings', 'Настройки чатов')}
            onPress={() => router.push('/settings/chat-settings' as any)}
            isFirst
          />
          <SettingsRow
            icon="emoji-emotions"
            iconTint="yellow"
            label={t('settings.stickers', 'Стикеры')}
            onPress={() => router.push('/settings/stickers' as any)}
            isLast
          />
        </View>

        {/* ── Data ─────────────────────────────────────────────────────────────
            Storage, the browser choice and haptics were mixed into "General" alongside the profile
            and notifications. They are all device-behaviour settings, so they group. */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.section.data', 'Данные и устройство')}
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="storage"
            iconTint="green"
            label={t('settings.data_storage')}
            onPress={() => router.push('/settings/storage')}
            isFirst
          />
          <SettingsRow
            icon="public"
            iconTint="cyan"
            label={t('settings.browser')}
            value={useInAppBrowser ? t('settings.browser.in_app') : t('settings.browser.external')}
            onPress={() => router.push('/settings/browser')}
          />
          <SettingsRow
            icon="vibration"
            iconTint="orange"
            label={t('settings.haptic')}
            showChevron={false}
            rightElement={
              <Switch
                value={hapticEnabled}
                onValueChange={setHaptic}
                trackColor={{ true: '#4CD964', false: theme.colors.border.light }}
                thumbColor="#FFFFFF"
              />
            }
            isLast
          />
        </View>

        {/* Appearance */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.section.appearance')}
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="palette"
            iconTint="purple"
            label={t('settings.appearance')}
            onPress={() => router.push('/settings/appearance')}
            isFirst
          />
          {PROFILE_THEMES_ENABLED && (
            <SettingsRow
              icon="wallpaper"
              iconTint="pink"
              label={t('settings.profile_theme', 'Тема профиля')}
              onPress={() => router.push('/settings/profile-theme' as any)}
            />
          )}
          <SettingsRow
            icon="text-fields"
            iconTint="indigo"
            label={t('settings.fonts')}
            onPress={() => router.push('/settings/fonts' as any)}
          />
          <SettingsRow
            icon="language"
            iconTint="teal"
            label={t('settings.language')}
            onPress={() => router.push('/settings/language' as any)}
          />
          {/* ── ONE iOS-ONLY ROW LEFT, AND THE WIDGET ROW IS GONE ─────────────────
              App icon is `expo-alternate-app-icons`, which is iOS-only — Android has no runtime
              icon-switching API, so on Android the row opened a modal that could not do anything.

              The WIDGET row was here too and has been removed outright, on iOS as well: asked for
              directly, the settings entry is surplus. The widget itself is untouched — it is an
              `@bacons/apple-targets` WidgetKit extension and it keeps working exactly as before.
              This deletes the settings ROW, not the feature. `app/settings/widget.tsx` is left in
              place and simply unreachable from here, so restoring the entry is one row of JSX if it
              is ever wanted back.

              `isLast` moves with it: it marks the row that draws no bottom separator, and it used to
              sit on the widget row. Without that adjustment the list would end on a row still
              drawing a separator into empty space. It is computed from what is actually rendered. */}
          {IS_IOS ? (
            <SettingsRow
              icon="apps"
              iconTint="pink"
              label={t('settings.app_icon')}
              onPress={() => setIconModalVisible(true)}
            />
          ) : null}
          <SettingsRow
            icon="grid-view"
            iconTint="orange"
            label="Pixel icons"
            onPress={() => router.push('/settings/pixel-icons' as any)}
          />
          {/* Concept screen, not a setting: shows Liquid Glass beside Material 3 Expressive so the
              two platform philosophies can be compared on one device. Changes nothing about the real
              UI — see the header note in that file. */}
          <SettingsRow
            icon="auto-awesome"
            iconTint="indigo"
            label={t('settings.platform_design', 'Материал платформы')}
            onPress={() => router.push('/settings/platform-design' as any)}
          />
          <SettingsRow
            icon="web-asset"
            iconTint="pink"
            label={t('settings.mini_app_preview')}
            onPress={() => router.push('/settings/mini-app-preview' as any)}
            isLast={!glassCapable}
          />
          {glassCapable && (
            <SettingsRow
              icon="blur-on"
              iconTint="cyan"
              label={t('settings.liquid_glass', 'Жидкое стекло')}
              showChevron={false}
              rightElement={
                <Switch
                  value={liquidGlassEnabled}
                  onValueChange={setLiquidGlassEnabled}
                  trackColor={{ true: '#4CD964', false: theme.colors.border.light }}
                  thumbColor="#FFFFFF"
                />
              }
              isLast
            />
          )}
        </View>

        {/* Security */}
        <Pressable onPress={handleAdminTap} style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.section.security')}
          </Text>
        </Pressable>
        <View style={sectionCardStyle}>
          {/* In-app privacy controls. `privacy.tsx` existed with NO entry point anywhere in the
              settings root, while the root instead linked out to the hosted privacy POLICY — two
              different things, and only the document was reachable. */}
          <SettingsRow
            icon="shield"
            iconTint="indigo"
            label={t('settings.privacy', 'Приватность')}
            onPress={() => router.push('/settings/privacy' as any)}
            isFirst
          />
          {/* ── THE DEVICE LIST NOW EXISTS, SO THIS ROW IS BACK ───────────────────
              History, because it matters for what the label is allowed to say. This row once read
              `settings.devices` but pushed `/settings/device-key`, a screen showing ONE value — this
              install's key, with a copy button. The label promised a session list and delivered a
              string, which is why it read as broken rather than as a different feature. It was
              relabelled to `settings.device_key` as an honest stopgap, with a note that the missing
              piece was a LIST endpoint over `push_tokens` that could not be deployed at the time.

              That endpoint exists now (`GET /v1/push/devices`), so the two concerns are two rows:

                Devices    — who receives notifications for this account, with a revoke control.
                Device key — the string you type to sign in somewhere new.

              The Devices screen is careful about what it claims: `push_tokens` is the only per-device
              record this backend keeps, so the list is "devices registered for notifications", NOT
              "every device that ever signed in". There is no session log to enumerate — the auth token
              is a stateless JWT — and adding one would be new device-data collection, which the
              compliance rules require consent for and forbid deriving a stable device identifier from.
              The screen says so in both languages rather than implying completeness it cannot have.

              `device_key.title` was also changed from "Devices" to "Device key": it titled the
              single-key screen, so before this change BOTH screens claimed the same name. */}
          <SettingsRow
            icon="devices"
            iconTint="teal"
            label={t('settings.devices')}
            onPress={() => router.push('/settings/devices' as any)}
          />
          <SettingsRow
            icon="vpn-key"
            iconTint="blue"
            label={t('settings.device_key')}
            onPress={() => router.push('/settings/device-key')}
            isLast
          />
        </View>

        {/* ── LEGAL: the two hosted documents, on their own ─────────────────────
            They were the bottom half of the Security card, directly under the in-app privacy
            controls and a row about device identity. Two different kinds of thing in one list: three
            settings that change the app, and two links that leave it.

            Split out, which is where Telegram and iOS Settings both keep them — grouped together,
            near the bottom, immediately above the version string. Nothing about either link changed;
            only which card they sit in. */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.section.legal')}
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="lock"
            iconTint="gray"
            label={t('settings.privacy_policy')}
            onPress={() => Linking.openURL('https://legal.san-m-app.com/privacy.html').catch(() => {})}
            isFirst
          />
          <SettingsRow
            icon="description"
            iconTint="gray"
            label={t('settings.terms')}
            onPress={() => Linking.openURL('https://legal.san-m-app.com/terms.html').catch(() => {})}
            isLast
          />
        </View>

        {/* ── Developer / diagnostics — LAST ───────────────────────────────────
            It was SECOND, above Appearance: a single debug toggle outranking every setting a user
            actually came here for. Diagnostics belong at the bottom, which is also where every OS
            settings app puts them. The rows above are unchanged; only the position moved. */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.section.developer', 'Разработчик')}
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <SettingsRow
            icon="insights"
            iconTint="green"
            label={t('settings.perf_monitor', 'Монитор производительности')}
            showChevron={false}
            rightElement={
              <Switch
                value={perfMonitorEnabled}
                onValueChange={setPerfMonitorEnabled}
                trackColor={{ true: '#4CD964', false: theme.colors.border.light }}
                thumbColor="#FFFFFF"
              />
            }
            isFirst
            isLast
          />
        </View>

        {/* ── THE TWO ACCOUNT ACTIONS, TOGETHER, AS ROWS ───────────────────────
            What was here was two hand-rolled Pressables in a flex row: bare rounded rectangles with
            no icon, no separator and no shared geometry with any other row on the screen, one of
            them outlined in translucent red and carrying GREY text for an irreversible action. The
            mismatch is what read badly, not the pairing.

            So the pairing is kept — asked for directly, they belong next to each other — and only
            the presentation changes. One card, two rows, stacked: same height, same icon tile, same
            separator and same press feedback as every other row on this screen. That is also how
            iOS Settings stacks a sign-out next to a destructive account action.

            Ordering is deliberate: Log out first, Delete account second. The reversible action is
            the one people reach for, and putting the irreversible one under it means a mis-tap on
            the row you wanted lands on the safer of the two.

            Neither takes a chevron: both act immediately, behind their confirmation Alerts, rather
            than pushing a screen — a chevron would claim otherwise. Delete account stays reachable
            in-app, which App Review requires. */}
        <View style={[sectionCardStyle, { marginTop: 8 }]}>
          <SettingsRow
            icon="logout"
            iconTint="red"
            label={t('settings.logout')}
            onPress={handleLogout}
            showChevron={false}
            destructive
            isFirst
          />
          <SettingsRow
            icon="person-remove"
            iconTint="red"
            label={t('settings.delete_account')}
            onPress={handleDeleteAccount}
            showChevron={false}
            destructive
            isLast
          />
        </View>

        {/* App version */}
        <Text variant="caption" align="center" color={theme.colors.text.tertiary} style={{ marginTop: 14, fontSize: 11 }}>
          {t('settings.version', undefined, { version: appVersion })}
        </Text>
      </ScrollView>

      {/* Bottom fade — mirrors the top header fade so the settings list
          dissolves into the background at the bottom edge instead of cutting
          off against a hard line. Pinned absolute over the bottom of the
          ScrollView; box-none so it never blocks taps on the last rows. */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: insets.bottom + 48 }} pointerEvents="none">
        <LinearGradient
          colors={bottomScrimColors(theme.isDark, bgColor)}
          locations={SCRIM_LOCATIONS}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* App icon picker — lazy-loaded because it imports expo-image-manipulator
          (a native module) at import time. Mounting it before the navigation
          transition completes was the source of the long task on this screen.
          The component flips in one frame after `runAfterInteractions`. */}
      {AppIconModalLazy ? (
        <AppIconModalLazy visible={iconModalVisible} onClose={() => setIconModalVisible(false)} />
      ) : null}
    </View>
  );
}
