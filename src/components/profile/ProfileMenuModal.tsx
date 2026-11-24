/**
 * The "More" sheet on someone else's profile: copy link, share, report, block / unblock.
 *
 * Moved out of `app/profile/[id].tsx` unchanged in behaviour when that screen was rebuilt. It is the
 * profile-level REPORT and BLOCK entry that App Review guideline 1.2 requires for user-generated
 * content, so it must stay reachable from every profile.
 *
 * Height is read from `useWindowDimensions` at open time rather than a module constant, so the
 * slide distance stays right after a rotation or a window resize.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Modal, Animated, Alert, PanResponder, useWindowDimensions } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { ModalStatusBar } from '../ui/ModalStatusBar';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { UserBadge } from '../ui/UserBadge';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';
import { openProfileShareSheet } from '../../store/shareSheetStore';
import { useBlockedUsersStore, useIsBlocked } from '../../store/blockedUsersStore';
import { submitReport } from '../../services/moderation';
import { useT } from '../../i18n/store';
import { profileUrl } from './ProfileLayout';
import { openProfileQr } from '../../store/profileQrStore';

// Report category KEYS — labels come from the dictionary at render time.
const REPORT_CATEGORIES: { key: string; labelKey: string }[] = [
  { key: 'spam', labelKey: 'report.cat.spam' },
  { key: 'violence', labelKey: 'report.cat.violence' },
  { key: 'misinformation', labelKey: 'report.cat.misinformation' },
  { key: 'fraud', labelKey: 'report.cat.fraud' },
  { key: 'other', labelKey: 'report.cat.other' },
];

export interface ProfileMenuTarget {
  id: string;
  username?: string | null;
  display_name?: string | null;
  emoji?: string | null;
  is_verified?: boolean | null;
  badge?: string | null;
}

function ProfileMenuModalImpl({ visible, profile, onClose }: { visible: boolean; profile: ProfileMenuTarget | null; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const { height: windowHeight } = useWindowDimensions();
  const heightRef = useRef(windowHeight);
  useEffect(() => { heightRef.current = windowHeight; }, [windowHeight]);
  const slideAnim = useRef(new Animated.Value(windowHeight)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const [mode, setMode] = useState<'menu' | 'report'>('menu');
  const isClosing = useRef(false);
  // Action to run once this sheet has fully closed — two overlapping RN Modals on iOS end with the
  // second one never appearing, so the share sheet waits for this one to be gone.
  const afterCloseRef = useRef<(() => void) | null>(null);

  const handleClose = () => {
    if (isClosing.current) return;
    isClosing.current = true;
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: heightRef.current, duration: 250, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(() => {
        setMode('menu');
        onClose();
        const next = afterCloseRef.current;
        afterCloseRef.current = null;
        if (next) { try { next(); } catch {} }
      }, 30);
    });
  };
  // The pan responder is created once; it must call the latest close handler.
  const handleCloseRef = useRef(handleClose);
  useEffect(() => { handleCloseRef.current = handleClose; });

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 8,
    onPanResponderMove: (_, g) => { if (g.dy > 0) dragY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 80 || g.vy > 0.5) handleCloseRef.current();
      else Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 100, friction: 10 }).start();
    },
  })).current;

  useEffect(() => {
    if (visible) {
      isClosing.current = false;
      setMode('menu');
      dragY.setValue(0);
      slideAnim.setValue(heightRef.current);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const switchToReport = () => {
    Animated.timing(slideAnim, { toValue: heightRef.current, duration: 150, useNativeDriver: true }).start(() => {
      setMode('report');
      dragY.setValue(0);
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }).start();
    });
  };

  const handleCopyLink = async () => {
    triggerHaptic('light');
    if (profile?.id) await Clipboard.setStringAsync(profileUrl(profile.id));
    showToast(t('toast.link_copied'), 'link');
    handleClose();
  };

  // Sends the profile link into a chat through the in-app picker. Queued until this sheet closed.
  const handleShare = () => {
    triggerHaptic('light');
    const pid = profile?.id;
    if (!pid) return;
    afterCloseRef.current = () => openProfileShareSheet(pid, profile?.display_name || undefined);
    handleClose();
  };

  const handleReport = (cat: string) => {
    if (!profile) return;
    triggerHaptic('medium');
    // `submitReport` never throws; the catch only keeps a rejected promise from surfacing.
    void submitReport({ targetType: 'profile', targetId: profile.id, category: cat }).catch(() => {});
    showToast(t('toast.report_sent'), 'flag');
    handleClose();
  };

  // Block / unblock the profile owner (App Review 1.2: a top-level block flow on user profiles).
  const handleBlockToggle = () => {
    if (!profile) return;
    triggerHaptic('medium');
    const isBlockedNow = useBlockedUsersStore.getState().isBlocked(profile.id);
    if (isBlockedNow) {
      Alert.alert(
        t('block.unblock_confirm_title', undefined, { username: profile.username || '' }),
        t('block.unblock_confirm_msg'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('block.menu.unblock'),
            onPress: () => {
              useBlockedUsersStore.getState().unblock(profile.id);
              showToast(t('block.toast.unblocked'), 'check');
              handleClose();
            },
          },
        ],
      );
    } else {
      Alert.alert(
        t('block.confirm_title', undefined, { username: profile.username || '' }),
        t('block.confirm_msg'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('block.action'),
            style: 'destructive',
            onPress: () => {
              useBlockedUsersStore.getState().block(profile.id);
              showToast(t('block.toast.blocked'), 'slash');
              handleClose();
            },
          },
        ],
      );
    }
  };

  if (!profile) return null;
  const translateY = Animated.add(slideAnim, dragY);

  // The QR screen is the root-level one (ProfileQrHost), opened once this sheet has gone: it is not a
  // Modal, so it would otherwise be drawn under this one.
  const openQr = () => {
    triggerHaptic('light');
    const p = profile;
    afterCloseRef.current = () =>
      openProfileQr({ id: p.id, username: p.username, displayName: p.display_name, emoji: p.emoji });
    handleClose();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose} statusBarTranslucent>
      <ModalStatusBar />
      <View style={{ flex: 1 }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim }}>
          <Pressable style={{ flex: 1 }} onPress={handleClose} />
        </Animated.View>
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY }] }} {...panResponder.panHandlers}>
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 12 }}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)' }} />
              </View>

              {mode === 'menu' ? (
                <>
                  <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Avatar emoji={profile.emoji || '😊'} size="lg" />
                      <View style={{ marginLeft: 12, flex: 1, marginRight: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text variant="body" weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>{profile.display_name || ''}</Text>
                          {profile.is_verified ? <VerifiedBadge size={13} /> : null}
                          {profile.badge ? <UserBadge badge={profile.badge} size="sm" /> : null}
                        </View>
                        <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{profile.username || ''}</Text>
                      </View>
                      {/* A QR glyph, not this profile's code: the thumbnail was an image fetched from a
                          QR service on every open of this sheet, and the code itself is shown, made on
                          the device, by the screen this opens. */}
                      <Pressable
                        onPress={openQr}
                        accessibilityRole="button"
                        accessibilityLabel={t('profile.qr_title')}
                        style={{ backgroundColor: '#FFF', borderRadius: 12, width: 50, height: 50, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <MaterialIcons name="qr-code-2" size={36} color="#15151B" />
                      </Pressable>
                    </View>
                  </View>
                  <MenuItem icon="link" label={t('profile_menu.copy_link')} onPress={handleCopyLink} />
                  <MenuItem icon="share-2" label={t('profile_menu.share_profile')} onPress={handleShare} />
                  <MenuItem icon="flag" label={t('profile_menu.report')} onPress={() => { triggerHaptic('light'); switchToReport(); }} destructive />
                  <ProfileBlockMenuItem profileId={profile.id} onPress={handleBlockToggle} />
                </>
              ) : (
                <>
                  <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 12 }}>{t('report.title')}</Text>
                  {REPORT_CATEGORIES.map((cat) => (
                    <Pressable key={cat.key} onPress={() => handleReport(cat.key)} style={{ paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}>
                      <Text variant="body">{t(cat.labelKey)}</Text>
                    </Pressable>
                  ))}
                </>
              )}
              <View style={{ height: 12 }} />
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

function MenuItem({ icon, label, onPress, destructive }: { icon: string; label: string; onPress: () => void; destructive?: boolean }) {
  const theme = useTheme();
  const color = destructive ? '#FF3B30' : theme.colors.text.primary;
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: destructive ? '#FF3B3010' : (theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'), alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon as any} size={17} color={color} />
      </View>
      <Text variant="body" color={color} style={{ marginLeft: 14 }}>{label}</Text>
    </Pressable>
  );
}

// Subscribes to the blocked-users store so the label flips right after the confirmation dialog.
function ProfileBlockMenuItem({ profileId, onPress }: { profileId: string; onPress: () => void }) {
  const t = useT();
  const isBlocked = useIsBlocked(profileId);
  return (
    <MenuItem
      icon={isBlocked ? 'check-circle' : 'slash'}
      label={isBlocked ? t('block.action_unblock') : t('block.action')}
      onPress={onPress}
      destructive={!isBlocked}
    />
  );
}

export const ProfileMenuModal = React.memo(ProfileMenuModalImpl);
