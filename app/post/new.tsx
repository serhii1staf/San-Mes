/**
 * New post — opened from «Публикации» on your own profile.
 *
 * Publishing exists only through profiles: there is no feed, so a post is read on its author's
 * profile and commented on in its own thread. Text plus up to four photos from the library. No
 * camera: the camera permission was removed from the binary on purpose (see the compliance notes),
 * and a capture button would need it back.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { useAuthStore } from '../../src/store';
import { createPost, joinImageUrls, uploadPostImage } from '../../src/lib/supabase';
// `moderation/index` explicitly: `services/moderation` resolves to the sibling moderation.ts (reports).
import { validatePost } from '../../src/services/moderation/index';
import { invalidateProfilePosts } from '../../src/services/profilePosts';
import { showToast } from '../../src/store/toastStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';

const MAX_PHOTOS = 4;
const MAX_CHARS = 4000;
/** Toolbar row height without its bottom safe-area padding (paddingTop 10 + 38 pt button). */
const TOOLBAR_HEIGHT = 48;

export default function NewPostScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const userId = useAuthStore((s) => s.user?.id);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const canPublish = !busy && (text.trim().length > 0 || photos.length > 0);

  const pickPhotos = useCallback(async () => {
    if (photos.length >= MAX_PHOTOS) return;
    triggerHaptic('light');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_PHOTOS - photos.length,
        quality: 1,
      });
      if (result.canceled) return;
      const uris = result.assets.map((a) => a.uri).filter(Boolean);
      setPhotos((prev) => [...prev, ...uris].slice(0, MAX_PHOTOS));
    } catch {}
  }, [photos.length]);

  const publish = useCallback(async () => {
    if (!canPublish || !userId) return;
    const body = text.trim().slice(0, MAX_CHARS);
    const verdict = validatePost(body);
    if (!verdict.ok) {
      showToast(t(verdict.reasonKey || 'moderation.reason.generic'), 'alert-circle');
      return;
    }
    setBusy(true);
    triggerHaptic('medium');
    try {
      const urls: string[] = [];
      for (const uri of photos) {
        const { url, error } = await uploadPostImage(uri);
        if (!url) {
          showToast(error ? `${t('post.upload_failed')}: ${error}` : t('post.upload_failed'), 'alert-circle');
          setBusy(false);
          return;
        }
        urls.push(url);
      }
      const { post, error } = await createPost(userId, body, urls.length > 0 ? joinImageUrls(urls) : undefined);
      if (error || !post) {
        showToast(error || t('post.publish_failed'), 'alert-circle');
        setBusy(false);
        return;
      }
      invalidateProfilePosts(userId);
      showToast(t('post.published'), 'check');
      router.back();
    } catch (e: any) {
      showToast(e?.message || t('post.publish_failed'), 'alert-circle');
      setBusy(false);
    }
  }, [canPublish, userId, text, photos, t]);

  // ── THE PHOTO BUTTON WAS UNDER THE KEYBOARD ─────────────────────────────────
  // Reported on iPhone: the field autofocuses, the keyboard comes up, and the toolbar with «Фото»
  // stays behind it. RN's KeyboardAvoidingView measures against the window, but this screen is a
  // page sheet that starts lower than the window top, so its padding came out short. The toolbar is
  // now a KeyboardStickyView (react-native-keyboard-controller, already driving every composer in
  // the app): it rides exactly on the keyboard's top edge, and the text scrolls above it.
  const bottomPad = Math.max(insets.bottom, 12);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 14 : insets.top + 10, borderBottomColor: theme.colors.border.light }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.cancel')} style={styles.close}>
          <Feather name="x" size={24} color={theme.colors.text.secondary} />
        </Pressable>
        <Text variant="body" weight="bold" numberOfLines={1} style={styles.title}>{t('post.new_title')}</Text>
        <View>
          <Pressable
            onPress={publish}
            disabled={!canPublish}
            accessibilityRole="button"
            style={[styles.publish, { backgroundColor: canPublish ? theme.colors.accent.primary : theme.colors.background.elevated }]}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text variant="caption" weight="bold" color={canPublish ? '#FFFFFF' : theme.colors.text.tertiary} style={{ fontSize: 14 }}>
                {t('post.publish')}
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: TOOLBAR_HEIGHT + bottomPad + 24 }}
        bottomOffset={TOOLBAR_HEIGHT + 16}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('create.placeholder')}
          placeholderTextColor={theme.colors.text.tertiary}
          multiline
          autoFocus
          maxLength={MAX_CHARS}
          style={[styles.input, { color: theme.colors.text.primary }]}
        />
        {photos.length > 0 ? (
          <View style={styles.photos}>
            {photos.map((uri) => (
              <View key={uri} style={styles.photoWrap}>
                <CachedImage uri={uri} style={styles.photo} resizeMode="cover" noProxy />
                <Pressable
                  onPress={() => setPhotos((prev) => prev.filter((p) => p !== uri))}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.delete')}
                  style={styles.photoRemove}
                >
                  <Feather name="x" size={14} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      {/* `opened` pulls the bar down by its own safe-area padding while the keyboard is up (the
          keyboard already covers the home indicator), leaving an 8 pt gap above the keys. */}
      <KeyboardStickyView offset={{ closed: 0, opened: bottomPad - 8 }} style={styles.toolbarDock}>
      <View style={[styles.toolbar, { paddingBottom: bottomPad, borderTopColor: theme.colors.border.light, backgroundColor: theme.colors.background.primary }]}>
        <Pressable
          onPress={pickPhotos}
          disabled={photos.length >= MAX_PHOTOS || busy}
          accessibilityRole="button"
          accessibilityLabel={t('post.add_photos')}
          style={[styles.tool, { backgroundColor: theme.colors.background.elevated, opacity: photos.length >= MAX_PHOTOS ? 0.5 : 1 }]}
        >
          <Feather name="image" size={20} color={theme.colors.accent.primary} />
          <Text variant="caption" weight="semibold" color={theme.colors.text.secondary}>
            {t('create.photos_count', undefined, { n: photos.length, max: MAX_PHOTOS })}
          </Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Text variant="caption" color={theme.colors.text.tertiary}>{text.length}/{MAX_CHARS}</Text>
      </View>
      </KeyboardStickyView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', marginHorizontal: 6, fontSize: 15 },
  publish: { paddingHorizontal: 12, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', minWidth: 80 },
  input: { fontSize: 17, lineHeight: 24, minHeight: 140, textAlignVertical: 'top' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  photoWrap: { width: 96, height: 96, borderRadius: 14, overflow: 'hidden' },
  photo: { width: 96, height: 96 },
  photoRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarDock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 38, borderRadius: 19 },
});
