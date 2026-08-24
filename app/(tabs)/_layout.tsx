import React from 'react';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../src/components/ui/Avatar';
import { useAuthStore } from '../../src/store';
import { useNotificationsBadge } from '../../src/store/notificationsBadgeStore';
import { CustomTabBar } from '../../src/components/navigation/CustomTabBar';
import { useDynamicOverlayStore } from '../../src/store/dynamicOverlayStore';
import { triggerHaptic } from '../../src/utils/haptics';

// Stable references for `tabBar`/`screenOptions`/`tabBarIcon` so React Navigation
// doesn't see new prop identities on every render of the parent layout.

const renderTabBar = (props: React.ComponentProps<typeof CustomTabBar>) => (
  <CustomTabBar {...props} />
);

const screenOptions = {
  headerShown: false,
  sceneStyle: { backgroundColor: 'transparent' as const },
};

type TabBarIconProps = { color: string; size: number };

const HomeTabIcon = ({ color, size }: TabBarIconProps) => (
  <Feather name="home" size={size} color={color} />
);
const SearchTabIcon = ({ color, size }: TabBarIconProps) => (
  <Feather name="search" size={size} color={color} />
);
const CreateTabIcon = ({ color, size }: TabBarIconProps) => (
  <Feather name="plus-circle" size={size} color={color} />
);
/**
 * Messages tab, with an unread count.
 *
 * The count comes from `useNotificationsBadge`, which already exists and is already kept current —
 * it is derived from the cached notification feed against a last-seen watermark, and
 * `RealtimeAccountBridge` increments it the instant a message arrives. Nothing was displaying it.
 *
 * Rendered as a badge pinned to the glyph rather than as a separate element, so it tracks the icon
 * wherever the tab bar puts it. `pointerEvents: none` because the whole tab is the touch target —
 * a badge that intercepted taps would create a dead spot in the middle of it.
 */
const MessagesTabIcon = ({ color, size }: TabBarIconProps) => {
  const count = useNotificationsBadge((s) => s.unread);
  return (
    <View style={{ width: size, height: size }}>
      <Feather name="message-circle" size={size} color={color} />
      {count > 0 ? (
        <View style={tabBadgeStyles.badge} pointerEvents="none">
          <Text style={tabBadgeStyles.badgeText} allowFontScaling={false} numberOfLines={1}>
            {/* Capped at 99+: three digits would widen the pill past the icon and start shifting
                the tab's layout, and the exact number stops being useful long before that. */}
            {count > 99 ? '99+' : String(count)}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const tabBadgeStyles = StyleSheet.create({
  // Anchored to the glyph's top-right and allowed to overflow it — `minWidth` with a symmetric
  // `paddingHorizontal` makes a single digit a circle and two digits a pill, without measuring text.
  badge: {
    position: 'absolute',
    top: -5,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', lineHeight: 13, includeFontPadding: false },
});

/**
 * The profile tab shows the ACCOUNT'S OWN EMOJI rather than a generic person glyph.
 *
 * Every account already has one (`user.emoji` — it is what the avatar renders everywhere else and
 * what the typing indicator sends), so the tab can identify *this* user instead of "a user". It is
 * also the one tab whose meaning is personal, which makes it the only one where a generic icon is
 * actively losing information.
 *
 * `color` is intentionally ignored: an emoji is already coloured, and tinting it would either do
 * nothing or muddy it. Selection is instead conveyed by opacity, so the active/inactive distinction
 * the tab bar relies on is preserved — an inactive tab passes a dimmer `color`, and comparing it
 * against the active tint tells us which state we are in without threading a new prop through
 * React Navigation.
 *
 * Falls back to the Feather glyph when the account has no emoji, so a profile that never picked one
 * looks deliberate rather than blank.
 */
const ProfileTabIcon = ({ color, size }: TabBarIconProps) => {
  const emoji = useAuthStore((s) => s.user?.emoji);
  const name = useAuthStore((s) => s.user?.displayName || s.user?.username);
  if (!emoji) return <Feather name="user" size={size} color={color} />;
  // ── THE ACTUAL AVATAR, not a bare emoji ────────────────────────────────────
  //
  // My first attempt rendered the emoji as plain text, and the report was that it still did not
  // look like an avatar. Correct — in this app an avatar is not the glyph, it is the glyph inside
  // `Avatar`'s tinted circle: a fill and hairline ring whose hue is hashed from the account's name,
  // so a given user keeps the same colour everywhere. That circle is what makes it read as "me"
  // rather than as a stray emoji sitting in the tab bar, and it is the same treatment the chat list
  // and the feed already use.
  //
  // `tint` is opt-in precisely because some places want the bare glyph; a tab bar is not one of
  // them — it needs a shape at a glance. `name` is passed so the hue matches this user's avatar in
  // every other list, since `getEmojiTint` seeds on `name || emoji`.
  //
  // `xs` (24 pt) rather than the `size` the navigator passes: `Avatar`'s sizes are a fixed scale and
  // 24 is the step that fits a tab bar icon box without the ring being clipped by it.
  return <Avatar emoji={emoji} name={name} size="xs" tint />;
};

// Long-pressing the Home tab summons the Dynamic Island companion overlay.
// This replaces the previous "long-press the top of the screen" trigger,
// which proved awkward because the catchment region overlapped with screen
// headers (settings buttons, notification bell, etc.) — users couldn't tap
// those on the first try when they happened to be near the notch.
//
// React Navigation's `listeners` prop accepts a `tabLongPress` callback per
// screen; CustomTabBar already emits the event on long-press of any tab
// button. Wiring it here keeps the trigger logic out of the (already busy)
// custom tab bar component.
const homeListeners = {
  tabLongPress: () => {
    try { triggerHaptic('light'); } catch {}
    useDynamicOverlayStore.getState().show();
  },
};

const homeOptions = { title: 'Home', tabBarIcon: HomeTabIcon };
const searchOptions = { title: 'Search', tabBarIcon: SearchTabIcon };
const createOptions = { title: 'Create', headerShown: false, tabBarIcon: CreateTabIcon };
const messagesOptions = { title: 'Messages', tabBarIcon: MessagesTabIcon };
const profileOptions = { title: 'Profile', tabBarIcon: ProfileTabIcon };

export default function TabLayout() {
  return (
    <Tabs tabBar={renderTabBar} screenOptions={screenOptions}>
      <Tabs.Screen name="index" options={homeOptions} listeners={homeListeners} />
      <Tabs.Screen name="search" options={searchOptions} />
      <Tabs.Screen name="create" options={createOptions} />
      <Tabs.Screen name="messages" options={messagesOptions} />
      <Tabs.Screen name="profile" options={profileOptions} />
    </Tabs>
  );
}
