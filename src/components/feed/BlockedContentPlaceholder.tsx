import React, { memo } from 'react';
import { View, Pressable, Platform, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { useT } from '../../i18n/store';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';

interface BlockedContentPlaceholderProps {
  /** Author whose content this placeholder hides. Used to wire the optional
   *  tap-to-unblock confirmation. */
  blockedUserId: string;
  /** Optional username for the unblock confirm dialog. */
  username?: string;
  /** Visual variant — `card` mimics a feed/profile post card; `inline` is a
   *  compact row used inside the comments list. */
  variant?: 'card' | 'inline';
}

/**
 * Visual signal that a piece of UGC has been hidden because the viewer
 * blocked the author. Required by Apple's UGC compliance guideline 1.2 —
 * blocked content must be hidden AND visibly marked, not silently dropped.
 *
 * Uses BlurView on iOS (real CALayer-backed backdrop blur, looks like the
 * rest of the app's chrome) and a flat dim on Android (BlurView's Android
 * fallback is a software blur over a screenshot — it stutters on weak
 * devices and isn't worth the visual win for a placeholder).
 *
 * Tapping the placeholder asks the user whether they want to unblock the
 * author, which is the primary undo affordance besides the Blocked section.
 *
 * Memoized so virtualization in feed / profile / comments lists doesn't
 * pay re-render cost on scroll. The custom comparator only checks the
 * inputs that affect the visual output.
 */
export const BlockedContentPlaceholder = memo(
  function BlockedContentPlaceholder({
    blockedUserId,
    username,
    variant = 'card',
  }: BlockedContentPlaceholderProps) {
    const theme = useTheme();
    const t = useT();
    // Read the unblock action via the store's static reference — we do
    // NOT subscribe to the list inside the placeholder so a state mutation
    // elsewhere can't bust this memoized component.
    const handleTap = () => {
      triggerHaptic('light');
      Alert.alert(
        t('block.unblock_confirm_title', undefined, { username: username || '…' }),
        t('block.unblock_confirm_msg'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('block.menu.unblock'),
            onPress: () => {
              useBlockedUsersStore.getState().unblock(blockedUserId);
              showToast(t('block.toast.unblocked'), 'check');
            },
          },
        ],
      );
    };

    if (variant === 'inline') {
      return (
        <Pressable
          onPress={handleTap}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme.colors.border.light,
            backgroundColor: theme.isDark
              ? 'rgba(255,255,255,0.04)'
              : 'rgba(0,0,0,0.025)',
            marginBottom: 8,
          }}
        >
          <Feather
            name="slash"
            size={14}
            color={theme.colors.text.tertiary}
            style={{ marginRight: 8 }}
          />
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ flex: 1 }}>
            {t('block.placeholder.subtitle')}
          </Text>
          <Text variant="caption" color={theme.colors.accent.primary} style={{ fontSize: 11 }}>
            {t('block.menu.unblock')}
          </Text>
        </Pressable>
      );
    }

    // Card variant — same outer dimensions as a regular feed/profile card
    // so the FlatList layout doesn't jump when a placeholder lands among
    // real cards.
    const cardBg = theme.isDark ? theme.colors.background.elevated : 'rgba(255,255,255,0.95)';
    const cardBorder = theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    return (
      <View
        style={{
          marginBottom: 12,
          borderRadius: 28,
          backgroundColor: cardBg,
          borderWidth: 1,
          borderColor: cardBorder,
          overflow: 'hidden',
        }}
      >
        <Pressable onPress={handleTap}>
          <View style={{ height: 140, alignItems: 'center', justifyContent: 'center' }}>
            {Platform.OS === 'ios' ? (
              <BlurView
                intensity={32}
                tint={theme.isDark ? 'dark' : 'light'}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                }}
              />
            ) : (
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: theme.isDark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.06)',
                }}
              />
            )}
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: theme.isDark
                  ? 'rgba(255,255,255,0.08)'
                  : 'rgba(0,0,0,0.05)',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 10,
              }}
            >
              <Feather name="slash" size={20} color={theme.colors.text.tertiary} />
            </View>
            <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
              {t('block.placeholder.title')}
            </Text>
            <Text
              variant="caption"
              color={theme.colors.text.tertiary}
              style={{ marginTop: 2, fontSize: 11 }}
            >
              {t('block.placeholder.subtitle')}
            </Text>
            <Text
              variant="caption"
              color={theme.colors.accent.primary}
              style={{ marginTop: 8, fontSize: 11 }}
            >
              {t('block.placeholder.tap_to_unblock')}
            </Text>
          </View>
        </Pressable>
      </View>
    );
  },
  (prev, next) =>
    prev.blockedUserId === next.blockedUserId &&
    prev.username === next.username &&
    prev.variant === next.variant,
);
