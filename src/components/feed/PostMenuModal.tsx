import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Modal, Share, Alert, Animated, Dimensions, PanResponder } from 'react-native';
import { ModalStatusBar } from '../ui/ModalStatusBar';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { CachedImage } from '../ui/CachedImage';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { UserBadge } from '../ui/UserBadge';
import Skeleton from '../ui/Skeleton';
import { Post } from '../../types';
import { triggerHaptic } from '../../utils/haptics';
import { useAuthStore } from '../../store/authStore';
import { useFeedStore } from '../../store/feedStore';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';
import { deletePost } from '../../lib/supabase';
import { showToast } from '../../store/toastStore';
import { submitReport } from '../../services/moderation';
import { sharePost } from '../../utils/sharePost';
import { useT } from '../../i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const REPORT_CATS: { key: string; labelKey: string }[] = [
  { key: 'spam', labelKey: 'report.cat.spam' },
  { key: 'violence', labelKey: 'report.cat.violence' },
  { key: 'misinformation', labelKey: 'report.cat.misinformation' },
  { key: 'fraud', labelKey: 'report.cat.fraud' },
  { key: 'copyright', labelKey: 'report.cat.copyright' },
  { key: 'other', labelKey: 'report.cat.other' },
];

interface PostMenuModalProps {
  visible: boolean;
  post: Post | null;
  onClose: () => void;
}

export function PostMenuModal({ visible, post, onClose }: PostMenuModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Field-level selectors so this modal (mounted permanently inside FeedScreen)
  // doesn't re-render on every unrelated auth/feed store mutation.
  const user = useAuthStore((s) => s.user);
  const removePost = useFeedStore((s) => s.removePost);
  const [mode, setMode] = useState<'menu' | 'report'>('menu');
  // Defer the heavy preview thumbnail (CachedImage decode) by one paint after
  // the open animation starts, so the open-animation frame carries only cheap
  // views. A same-size Skeleton holds the box meanwhile (no layout jump).
  const [contentReady, setContentReady] = useState(false);

  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const isClosing = useRef(false);
  // RAF handles for the deferred content reveal — tracked so they can be
  // cancelled on cleanup / when `visible` flips before they fire.
  const rafA = useRef<number | null>(null);
  const rafB = useRef<number | null>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 10,
      onPanResponderMove: (_, g) => { if (g.dy > 0) dragY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) { dismiss(); }
        else { Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 120, friction: 10 }).start(); }
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      isClosing.current = false;
      setMode('menu');
      setContentReady(false);
      dragY.setValue(0);
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      // Reveal the heavy preview thumbnail one paint after the open animation
      // has been kicked off, keeping the first (open) frame cheap.
      rafA.current = requestAnimationFrame(() => {
        rafB.current = requestAnimationFrame(() => setContentReady(true));
      });
    } else {
      setContentReady(false);
    }
    return () => {
      if (rafA.current != null) { cancelAnimationFrame(rafA.current); rafA.current = null; }
      if (rafB.current != null) { cancelAnimationFrame(rafB.current); rafB.current = null; }
    };
  }, [visible]);

  const dismiss = () => {
    if (isClosing.current) return;
    isClosing.current = true;
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(() => {
        setMode('menu');
        onClose();
      }, 30);
    });
  };

  const switchToReport = () => {
    // Animate out, switch mode, animate in
    Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 150, useNativeDriver: true }).start(() => {
      setMode('report');
      dragY.setValue(0);
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }).start();
    });
  };

  if (!post) return null;

  const isOwnPost = user?.id === post.authorId;
  const previewName = post.isRepost && post.originalPost ? post.originalPost.authorName : post.authorName;
  const previewEmoji = post.isRepost && post.originalPost ? post.originalPost.authorEmoji : post.authorEmoji;
  const previewContent = post.isRepost && post.originalPost ? post.originalPost.content : (post.content || t('post_menu.default_content'));
  const previewImage = post.isRepost && post.originalPost ? post.originalPost.imageUrl : post.imageUrl;

  const handleCopyLink = async () => { triggerHaptic('light'); await Clipboard.setStringAsync(`https://san-m-app.com/post/${post.id}`); showToast(t('toast.link_copied'), 'link'); dismiss(); };
  const handleShare = async () => { triggerHaptic('light'); await sharePost(post); dismiss(); };
  const handleDelete = () => {
    triggerHaptic('medium');
    Alert.alert(t('profile.delete_post_title'), t('profile.delete_post_msg'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: async () => { if (user?.id) { await deletePost(post.id, user.id); removePost(post.id); showToast(t('toast.post_deleted'), 'trash-2'); } dismiss(); } },
    ]);
  };

  // Block the post's author. The block is local — we add the author to
  // `useBlockedUsersStore` so feed/profile/comments wrappers immediately
  // swap their content for the BlockedContentPlaceholder. Apple guideline
  // 1.2 (UGC apps must offer a block flow) is what makes this required;
  // see `.kiro/steering/apple-compliance.md`. There is intentionally no
  // server write here — the schema doesn't yet have a blocked_users table.
  const handleBlock = () => {
    if (!post) return;
    triggerHaptic('medium');
    // Use the displayed (effective) author for repost-aware blocking: when
    // the user is looking at a repost, "Block user" should target the
    // ORIGINAL author rather than the reposter, because that's whose
    // content is actually being hidden by the action.
    const targetId = post.isRepost && post.originalPost ? (post.originalPost as any).authorId || post.authorId : post.authorId;
    const targetUsername = post.isRepost && post.originalPost ? (post.originalPost as any).authorUsername || post.authorUsername : post.authorUsername;
    Alert.alert(
      t('block.confirm_title', undefined, { username: targetUsername || '' }),
      t('block.confirm_msg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('block.action'),
          style: 'destructive',
          onPress: () => {
            useBlockedUsersStore.getState().block(targetId);
            // Drop the post from the feed store immediately too, so
            // the visible card disappears even on screens that don't
            // wrap PostCard in the blocked-aware filter (e.g. legacy
            // call sites). Other-author posts re-mount on next sync.
            try { removePost(post.id); } catch {}
            showToast(t('block.toast.blocked'), 'slash');
            dismiss();
          },
        },
      ],
    );
  };

  const translateY = Animated.add(slideAnim, dragY);
  const sheetBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <ModalStatusBar />
      <View style={{ flex: 1 }}>
        {/* Backdrop */}
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim }}>
          <Pressable style={{ flex: 1 }} onPress={dismiss} />
        </Animated.View>

        {/* Sheet */}
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View
            style={{ transform: [{ translateY }] }}
            {...panResponder.panHandlers}
          >
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: sheetBg, borderRadius: 28, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
          {/* Handle */}
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
          </View>

          {mode === 'menu' ? (
            <>
              {/* Post preview */}
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, marginHorizontal: 12, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', borderRadius: 14, marginBottom: 8 }}>
                <Avatar emoji={previewEmoji} size="sm" />
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{previewName}</Text>
                    {post.authorVerified && <VerifiedBadge size={11} />}
                    {post.authorBadge && <UserBadge badge={post.authorBadge} size="sm" />}
                  </View>
                  <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>{previewContent}</Text>
                </View>
                {previewImage && (contentReady
                  ? <CachedImage uri={previewImage} style={{ width: 40, height: 40, borderRadius: 10, marginLeft: 8 }} resizeMode="cover" />
                  : <Skeleton width={40} height={40} radius={10} style={{ marginLeft: 8 }} />
                )}
              </View>
              <MenuItem icon="link" label={t('post_menu.copy_link')} onPress={handleCopyLink} theme={theme} />
              <MenuItem icon="share-2" label={t('post_menu.share')} onPress={handleShare} theme={theme} />
              <MenuItem icon="bookmark" label={t('post_menu.save')} onPress={() => { triggerHaptic('light'); showToast(t('toast.saved'), 'bookmark'); dismiss(); }} theme={theme} />
              {isOwnPost && <MenuItem icon="trash-2" label={t('post_menu.delete')} onPress={handleDelete} theme={theme} destructive />}
              {!isOwnPost && <MenuItem icon="flag" label={t('post_menu.report')} onPress={() => { triggerHaptic('light'); switchToReport(); }} theme={theme} destructive />}
              {!isOwnPost && <MenuItem icon="slash" label={t('block.action')} onPress={handleBlock} theme={theme} destructive />}
            </>
          ) : (
            <>
              <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 10 }}>{t('report.title')}</Text>
              {REPORT_CATS.map((cat) => (
                <Pressable key={cat.key} onPress={() => { triggerHaptic('medium'); void submitReport({ targetType: 'post', targetId: post.id, category: cat.key }); showToast(t('toast.report_sent'), 'flag'); dismiss(); }} style={{ paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}>
                  <Text variant="body">{t(cat.labelKey)}</Text>
                </Pressable>
              ))}
            </>
          )}
          <View style={{ height: 10 }} />
        </View>
        </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

function MenuItem({ icon, label, onPress, theme, destructive }: { icon: string; label: string; onPress: () => void; theme: any; destructive?: boolean }) {
  const color = destructive ? '#FF3B30' : theme.colors.text.primary;
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20 }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: destructive ? '#FF3B3010' : (theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'), alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon as any} size={17} color={color} />
      </View>
      <Text variant="body" color={color} style={{ marginLeft: 14 }}>{label}</Text>
    </Pressable>
  );
}
