import React, { useEffect, useRef } from 'react';
import { View, Pressable, Modal, Animated, Dimensions, ScrollView, StatusBar, Easing } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { FormattedText } from './FormattedText';
import { LinkPreview } from './LinkPreview';
import { CachedImage } from './CachedImage';
import { VerifiedBadge } from './VerifiedBadge';
import { UserBadge } from './UserBadge';
import { extractFirstUrl } from '../../services/linkPreview';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREVIEW_MAX_HEIGHT = SCREEN_HEIGHT * 0.45;
const LONG_TEXT_THRESHOLD = 220;

export type CommentAction = 'reply' | 'copy' | 'edit' | 'delete' | 'report';

interface CommentContextMenuProps {
  visible: boolean;
  comment: any | null;
  isOwn: boolean;
  // Pre-parsed display body + quote (so the preview matches the list exactly)
  displayBody?: string;
  replyUser?: string;
  replyText?: string;
  gifUrl?: string | null;
  onClose: () => void;
  onAction: (action: CommentAction, comment: any) => void;
}

// Long-press menu for comments — same smooth slide-up + fade as the chat /
// main-feed context menus. Shows a live preview of the held comment (including
// any link/video preview) above the action sheet. The preview is wide so rich
// previews (link/video cards) fit without being clipped.
export function CommentContextMenu({ visible, comment, isOwn, displayBody, replyUser, replyText, gifUrl, onClose, onAction }: CommentContextMenuProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(40)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const dismissing = useRef(false);

  useEffect(() => {
    if (visible) {
      dismissing.current = false;
      slideAnim.setValue(40);
      fade.setValue(0);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = (cb?: () => void) => {
    if (dismissing.current) return;
    dismissing.current = true;
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 40, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 170, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(() => { onClose(); cb?.(); });
  };

  if (!visible || !comment) return null;

  const profile = comment.profiles || {};
  const body: string = displayBody ?? comment.content ?? '';
  const link = !gifUrl ? extractFirstUrl(body) : null;
  const isLong = body.length > LONG_TEXT_THRESHOLD;

  const items: { action: CommentAction; icon: string; label: string; destructive?: boolean; show: boolean }[] = [
    { action: 'reply', icon: 'corner-up-left', label: 'Ответить', show: true },
    { action: 'copy', icon: 'copy', label: 'Копировать', show: !!body && !gifUrl },
    { action: 'edit', icon: 'edit-2', label: 'Редактировать', show: isOwn && !gifUrl },
    { action: 'delete', icon: 'trash-2', label: 'Удалить', destructive: true, show: isOwn },
    { action: 'report', icon: 'flag', label: 'Пожаловаться', destructive: true, show: !isOwn },
  ];

  const previewInner = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <Avatar emoji={profile.emoji || '😊'} size="xs" />
        <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{profile.display_name || 'User'}</Text>
        {profile.is_verified && <VerifiedBadge size={10} />}
        {profile.badge && <UserBadge badge={profile.badge} size="sm" />}
      </View>
      {/* Quoted comment this one replies to */}
      {replyUser ? (
        <View style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: theme.colors.accent.primary, marginBottom: 6 }}>
          <Text variant="caption" weight="semibold" color={theme.colors.accent.primary} numberOfLines={1} style={{ fontSize: 11 }}>@{replyUser}</Text>
          {replyText ? <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11 }}>{replyText}</Text> : null}
        </View>
      ) : null}
      {gifUrl ? (
        <CachedImage uri={gifUrl} style={{ width: 160, height: 160, borderRadius: 14, backgroundColor: theme.colors.background.secondary }} resizeMode="cover" />
      ) : body ? (
        <FormattedText color={theme.colors.text.primary} linkColor={theme.colors.accent.primary} style={{ fontSize: 15 }}>{body}</FormattedText>
      ) : null}
      {link ? (
        <View style={{ marginTop: 6 }}>
          <LinkPreview url={link} static />
        </View>
      ) : null}
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => dismiss()} statusBarTranslucent>
      <StatusBar hidden />
      <Pressable style={{ flex: 1 }} onPress={() => dismiss()}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', opacity: fade }} />

        <Animated.View
          style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: Math.max(insets.bottom, 16), opacity: fade, transform: [{ translateY: slideAnim }] }}
          pointerEvents="box-none"
        >
          {/* Held comment preview — wide so rich previews fit */}
          <View style={{ marginHorizontal: 12, marginBottom: 8, alignItems: 'stretch' }} pointerEvents="box-none">
            <View style={{ borderRadius: 18, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', overflow: 'hidden' }}>
              {isLong ? (
                <ScrollView style={{ maxHeight: PREVIEW_MAX_HEIGHT }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }} bounces={false}>
                  {previewInner}
                </ScrollView>
              ) : (
                <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
                  {previewInner}
                </View>
              )}
            </View>
          </View>

          {/* Action sheet */}
          <View style={{ marginHorizontal: 8, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
            </View>
            {items.filter(i => i.show).map((item) => {
              const color = item.destructive ? '#FF3B30' : theme.colors.text.primary;
              return (
                <Pressable key={item.action} onPress={() => dismiss(() => onAction(item.action, comment))} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: item.destructive ? '#FF3B3010' : (theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'), alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name={item.icon as any} size={17} color={color} />
                  </View>
                  <Text variant="body" color={color} style={{ marginLeft: 14 }}>{item.label}</Text>
                </Pressable>
              );
            })}
            <View style={{ height: 8 }} />
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
