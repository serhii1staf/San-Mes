/**
 * New post — opened from «Публикации» on your own profile.
 *
 * Publishing exists only through profiles: there is no feed, so a post is read on its author's
 * profile and commented on in its own thread. Text plus up to four photos from the library. No
 * camera: the camera permission was removed from the binary on purpose (see the compliance notes),
 * and a capture button would need it back.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Switch,
  Keyboard,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Reanimated from 'react-native-reanimated';
import { useKeyboardRiseStyle } from '../../src/hooks/useKeyboardFrames';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { SlideUpSheet } from '../../src/components/ui/SlideUpSheet';
import { useAuthStore } from '../../src/store';
import { createPost, joinImageUrls, parseImageUrls, updatePost, uploadPostImage } from '../../src/lib/supabase';
// `moderation/index` explicitly: `services/moderation` resolves to the sibling moderation.ts (reports).
import { validatePost } from '../../src/services/moderation/index';
import { findCachedPost, invalidateProfilePosts } from '../../src/services/profilePosts';
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
  // `?editId=` opens the same screen as an editor for one of your posts (long-press a post card →
  // Изменить). The post is read from the profile's in-memory page, which is where the menu was.
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const editing = useState(() => (editId ? findCachedPost(String(editId)) : null))[0];
  const [text, setText] = useState(() => editing?.content || '');
  const [photos, setPhotos] = useState<string[]>(() => (editing ? parseImageUrls(editing.image_url) : []));
  const [busy, setBusy] = useState(false);
  // ── THE POST'S SETTINGS (Nov 2026) ─────────────────────────────────────────────────────────────
  //
  // Requested: closing a post's comments, when publishing and later from Изменить. Everyone still
  // sees the post and the comments already there; nobody adds one, the author included, and the
  // thread says so where its composer was (app/comments/[id].tsx). The Worker refuses the comment
  // too (403 `comments_off`), so an install without this update cannot get round it.
  //
  // Behind one button that opens a sheet, so the next setting has a place without another button in
  // the toolbar. The button shows a crossed-out bubble while comments are off, so a closed post is
  // not a surprise at the moment of publishing.
  const [commentsOff, setCommentsOff] = useState(() => !!editing?.comments_off);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => {
    triggerHaptic('light');
    // The sheet is a modal: with the keyboard left up it would sit on top of the sheet.
    Keyboard.dismiss();
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const toggleComments = useCallback(() => {
    triggerHaptic('selection');
    setCommentsOff((v) => !v);
  }, []);

  // Asked to edit a post this screen cannot find: close rather than turn into a new-post screen,
  // where pressing the button would publish a duplicate.
  const lostEdit = !!editId && !editing;
  useEffect(() => {
    if (!lostEdit) return;
    showToast(t('post.publish_failed'), 'alert-circle');
    router.back();
  }, [lostEdit, t]);

  const canPublish = !busy && !lostEdit && (text.trim().length > 0 || photos.length > 0);

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
        // Photos already on the server (an edited post's own) are kept as they are.
        if (/^https?:\/\//i.test(uri)) {
          urls.push(uri);
          continue;
        }
        const { url, error } = await uploadPostImage(uri);
        if (!url) {
          showToast(error ? `${t('post.upload_failed')}: ${error}` : t('post.upload_failed'), 'alert-circle');
          setBusy(false);
          return;
        }
        urls.push(url);
      }
      if (editing) {
        const { error } = await updatePost(editing.id, body, urls.length > 0 ? joinImageUrls(urls) : null, commentsOff);
        if (error) {
          showToast(error, 'alert-circle');
          setBusy(false);
          return;
        }
        invalidateProfilePosts(userId);
        showToast(t('toast.saved'), 'check');
        router.back();
        return;
      }
      const { post, error } = await createPost(userId, body, urls.length > 0 ? joinImageUrls(urls) : undefined, commentsOff);
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
  }, [canPublish, userId, text, photos, t, editing, commentsOff]);

  // ── THE PHOTO BUTTON WAS UNDER THE KEYBOARD ─────────────────────────────────
  // Reported on iPhone: the field autofocuses, the keyboard comes up, and the toolbar with «Фото»
  // stays behind it. RN's KeyboardAvoidingView measures against the window, but this screen is a
  // page sheet that starts lower than the window top, so its padding came out short. The toolbar now
  // rides the keyboard frame by frame (`useKeyboardFrames`, as every composer in the app does), 8 pt
  // above the keys, and the text scrolls above it. It was a KeyboardStickyView, which on iOS writes
  // its end position once and jumped there whenever a React commit was in flight, as one always is
  // here: the field autofocuses while the sheet is still opening.
  const bottomPad = Math.max(insets.bottom, 12);
  const toolbarRiseStyle = useKeyboardRiseStyle(bottomPad);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 14 : insets.top + 10, borderBottomColor: theme.colors.border.light }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.cancel')} style={styles.close}>
          <Feather name="x" size={24} color={theme.colors.text.secondary} />
        </Pressable>
        <Text variant="body" weight="bold" numberOfLines={1} style={styles.title}>{editing ? t('post.edit_title') : t('post.new_title')}</Text>
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
                {editing ? t('common.save') : t('post.publish')}
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

      {/* The bar keeps its safe-area padding and rises by what the keyboard covers beyond it (the
          keyboard already covers the home indicator), leaving an 8 pt gap above the keys. */}
      <Reanimated.View style={[styles.toolbarDock, toolbarRiseStyle]}>
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
        {/* Icon only: with a label the row ran past the screen's edge on a 390 pt phone (the counter
            was pushed off it on the emulator). The icon itself says when comments are off. */}
        <Pressable
          onPress={openSettings}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={commentsOff ? `${t('post.settings')}, ${t('post.comments_off_short')}` : t('post.settings')}
          style={[styles.tool, styles.settingsTool, { backgroundColor: theme.colors.background.elevated }]}
        >
          {commentsOff ? (
            <MaterialCommunityIcons name="comment-off-outline" size={19} color={theme.colors.accent.primary} />
          ) : (
            <Feather name="sliders" size={18} color={theme.colors.text.secondary} />
          )}
        </Pressable>
        <View style={{ flex: 1 }} />
        <Text variant="caption" color={theme.colors.text.tertiary}>{text.length}/{MAX_CHARS}</Text>
      </View>
      </Reanimated.View>

      <SlideUpSheet visible={settingsOpen} onClose={closeSettings} expandable={false}>
        <View style={styles.sheet}>
          <Text variant="body" weight="semibold" style={styles.sheetTitle}>{t('post.settings')}</Text>
          <Pressable
            onPress={toggleComments}
            accessibilityRole="switch"
            accessibilityState={{ checked: !commentsOff }}
            accessibilityLabel={t('post.comments')}
            style={[styles.settingRow, { backgroundColor: theme.colors.background.elevated }]}
          >
            <View style={[styles.settingIcon, { backgroundColor: theme.colors.accent.primary + '1F' }]}>
              <Feather name="message-circle" size={18} color={theme.colors.accent.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="body" weight="semibold" style={{ fontSize: 15 }}>{t('post.comments')}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 2 }}>
                {commentsOff ? t('post.comments_off_hint') : t('post.comments_on_hint')}
              </Text>
            </View>
            {/* The row takes the tap, the switch only shows the state: a native switch inside a
                Pressable would toggle twice, once for each. Hidden from screen readers, since the
                row itself is the switch for them. */}
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Switch
                value={!commentsOff}
                trackColor={{ true: '#4CD964', false: theme.colors.border.light }}
                thumbColor="#FFFFFF"
              />
            </View>
          </Pressable>
        </View>
      </SlideUpSheet>
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
  settingsTool: { marginLeft: 8, width: 44, paddingHorizontal: 0, justifyContent: 'center' },
  sheet: { paddingHorizontal: 16, paddingBottom: 8 },
  sheetTitle: { fontSize: 16, marginBottom: 12, marginLeft: 2 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16 },
  settingIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
