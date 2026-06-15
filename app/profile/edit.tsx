import React, { useState, useEffect } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Platform, Modal, KeyboardAvoidingView, Text as RNText, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useTheme } from '../../src/theme';
import { Text, Input, Avatar } from '../../src/components/ui';
import { ShrinkingModalTitle } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { SlideUpSheet } from '../../src/components/ui/SlideUpSheet';
import { useAuthStore, UserLink } from '../../src/store/authStore';
import { updateProfile as updateSupabaseProfile, uploadBanner, loadProfileMeta } from '../../src/lib/supabase';
import { currentUser } from '../../src/utils/mockData';
import { useT } from '../../src/i18n/store';
import { validateName, validateBio } from '../../src/services/moderation';
import { showToast } from '../../src/store/toastStore';
import {
  BannerTransform,
  IDENTITY_BANNER_TRANSFORM,
  parseBannerTransform,
  serializeBannerTransform,
  stripBannerTransform,
} from '../../src/utils/bannerTransform';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

// Editor frame matches the on-display banner height (300) so the user
// is positioning the image inside the exact frame they'll see on the
// profile screen — what they see here is what shows there.
const BANNER_EDIT_HEIGHT = 300;
const MIN_SCALE = 1;
const MAX_SCALE = 3;

const LINK_TYPES = [
  { key: 'github', label: 'GitHub', icon: 'github', patterns: ['github.com'] },
  { key: 'twitter', label: 'Twitter/X', icon: 'twitter', patterns: ['twitter.com', 'x.com'] },
  { key: 'instagram', label: 'Instagram', icon: 'instagram', patterns: ['instagram.com'] },
  { key: 'youtube', label: 'YouTube', icon: 'youtube', patterns: ['youtube.com', 'youtu.be'] },
  { key: 'telegram', label: 'Telegram', icon: 'send', patterns: ['t.me', 'telegram.me'] },
  { key: 'tiktok', label: 'TikTok', icon: 'video', patterns: ['tiktok.com'] },
  { key: 'discord', label: 'Discord', icon: 'message-circle', patterns: ['discord.gg', 'discord.com'] },
  { key: 'twitch', label: 'Twitch', icon: 'tv', patterns: ['twitch.tv'] },
  { key: 'spotify', label: 'Spotify', icon: 'music', patterns: ['spotify.com', 'open.spotify.com'] },
  { key: 'linkedin', label: 'LinkedIn', icon: 'linkedin', patterns: ['linkedin.com'] },
  { key: 'website', label: '', icon: 'globe', patterns: [] },
];

function detectLinkTypeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  for (const lt of LINK_TYPES) {
    if (lt.patterns.some((p) => lower.includes(p))) return lt.key;
  }
  return 'website';
}

const MOOD_CATEGORIES: { titleKey: string; emojis: string[] }[] = [
  {
    titleKey: 'emoji.cat.mood',
    emojis: [
      '😊', '😄', '😁', '🥰', '😍', '🤩', '😎', '🥳',
      '😇', '🤗', '😌', '😏', '🤔', '😴', '🥱', '😢',
      '😭', '😤', '🤬', '😱', '🤯', '😵‍💫', '🫠', '🥺',
      '😈', '👻', '💀', '🤡', '😷', '🤒', '🤕', '🤑',
    ],
  },
  {
    titleKey: 'emoji.cat.animals',
    emojis: [
      '🦊', '🐱', '🐶', '🐺', '🦁', '🐯', '🐼', '🐨',
      '🐸', '🐙', '🦋', '🐝', '🐞', '🦄', '🐰', '🐻',
      '🦈', '🐬', '🐳', '🦉', '🦅', '🐦', '🦜', '🐧',
      '🐢', '🦎', '🐍', '🦔', '🐹', '🐿️', '🦩', '🐾',
    ],
  },
  {
    titleKey: 'emoji.cat.nature',
    emojis: [
      '🌸', '🌺', '🌻', '🌹', '🌷', '💐', '🍀', '🌿',
      '🍃', '🍂', '🍁', '🌾', '🌵', '🎋', '🪷', '🌊',
      '☀️', '🌙', '⭐', '🌈', '☁️', '⚡', '❄️', '🔥',
      '🍄', '🪨', '💎', '🪐', '🌍', '🌋', '🏔️', '🌅',
    ],
  },
  {
    titleKey: 'emoji.cat.food',
    emojis: [
      '🍕', '🍔', '🍟', '🌮', '🍣', '🍜', '🍩', '🍪',
      '🎂', '🍰', '🧁', '🍫', '🍬', '🍭', '🍿', '🥤',
      '☕', '🍵', '🧋', '🍺', '🍷', '🥂', '🍹', '🧃',
      '🍎', '🍓', '🍑', '🥑', '🌽', '🥕', '🍉', '🥥',
    ],
  },
  {
    titleKey: 'emoji.cat.activities',
    emojis: [
      '🎮', '🎯', '🎲', '🎸', '🎵', '🎤', '🎬', '🎨',
      '🎭', '🎪', '🎢', '🏀', '⚽', '🏈', '🎾', '🏓',
      '🎳', '🛹', '🏄', '🚴', '🏋️', '🧘', '💃', '🕺',
      '🎧', '📷', '🎥', '💻', '📚', '✍️', '🎓', '🔬',
    ],
  },
  {
    titleKey: 'emoji.cat.symbols',
    emojis: [
      '✨', '💫', '⚡', '💥', '🫧', '🧿', '🪬', '🔮',
      '💝', '💖', '💗', '💓', '💕', '❤️‍🔥', '🖤', '💜',
      '💙', '💚', '💛', '🧡', '❤️', '🤍', '🩷', '🩵',
      '☮️', '✝️', '☯️', '♾️', '🏳️‍🌈', '🎀', '👑', '🦴',
    ],
  },
  {
    titleKey: 'emoji.cat.objects',
    emojis: [
      '🚀', '✈️', '🛸', '🏎️', '🚗', '🛵', '⛵', '🚂',
      '🏠', '🏰', '⛩️', '🗼', '🎡', '🌉', '💡', '🔑',
      '🗝️', '💰', '💸', '🎁', '🎈', '🎊', '🎉', '🪩',
      '🛡️', '⚔️', '🏹', '🪄', '🧲', '💊', '🩹', '🧸',
    ],
  },
];

export default function EditProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const displayUser = user || currentUser;

  const [name, setName] = useState(displayUser.displayName);
  const [username, setUsername] = useState(displayUser.username);
  const [bio, setBio] = useState(displayUser.bio || '');
  const [selectedEmoji, setSelectedEmoji] = useState(displayUser.emoji || '😊');
  const [links, setLinks] = useState<UserLink[]>((user as any)?.links || []);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [editingLinkIndex, setEditingLinkIndex] = useState<number | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkType, setLinkType] = useState('website');
  const [isSaving, setIsSaving] = useState(false);
  // Banner: separate the underlying image URL from the position/zoom
  // transform. The user.bannerUrl string may already carry an
  // `#x=&y=&s=` hash from a prior save — split it on mount so the
  // editor and persistence both work with structured data.
  //
  // Maintainers: see src/utils/bannerTransform.ts for the encoding
  // contract. Do NOT pass `bannerUri + hash` directly to a CachedImage
  // / image proxy — always strip the hash first.
  const initialBanner = (user as any)?.bannerUrl as string | undefined;
  const [bannerUri, setBannerUri] = useState<string | null>(stripBannerTransform(initialBanner) || null);
  const [bannerTransform, setBannerTransform] = useState<BannerTransform>(parseBannerTransform(initialBanner));
  // Banner editor modal — opens after picking a new image (so the user
  // can position it before save) and via the "Position" pill (so the
  // user can re-frame an existing banner without re-uploading).
  const [showBannerEditor, setShowBannerEditor] = useState(false);

  // Load banner from server-side meta in case the local copy got dropped.
  useEffect(() => {
    if (user?.id && !bannerUri) {
      loadProfileMeta(user.id)
        .then(({ meta }) => {
          if (meta?.banner_url) {
            // Server-side string may carry the same #x=&y=&s= hash —
            // split it the same way we do at mount.
            setBannerUri(stripBannerTransform(meta.banner_url) || null);
            setBannerTransform(parseBannerTransform(meta.banner_url));
          }
        })
        .catch(() => {});
    }
  }, [user?.id]);

  const handleClose = () => router.back();

  const pickBanner = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // No allowsEditing/quality — keeps animated GIFs animated end-to-end.
      allowsEditing: false,
      quality: 1.0,
    });
    if (!result.canceled && result.assets[0]) {
      setBannerUri(result.assets[0].uri);
      // New picks reset the transform to identity — the previous
      // position only made sense for the previous image. The editor
      // pops up immediately so the user can frame the new image
      // before save.
      setBannerTransform({ ...IDENTITY_BANNER_TRANSFORM });
      setShowBannerEditor(true);
    }
  };

  // Open the editor against the existing banner so the user can re-frame
  // it without picking a new image.
  const adjustBanner = () => {
    if (!bannerUri) return;
    setShowBannerEditor(true);
  };

  // Persist a transform from the editor back into the screen state. The
  // actual upload + URL serialization happens in handleSave.
  const handleBannerEditorSave = (next: BannerTransform) => {
    setBannerTransform(next);
    setShowBannerEditor(false);
  };
  const handleBannerEditorCancel = () => setShowBannerEditor(false);

  const handleSave = async () => {
    // Moderation: validate display name + bio BEFORE persisting. Toast on
    // reject so the existing field UI doesn't need an inline error slot.
    const nameCheck = validateName(name);
    if (!nameCheck.ok) {
      showToast(t(nameCheck.reasonKey || 'moderation.reason.profanity'), 'alert-circle');
      return;
    }
    const bioCheck = validateBio(bio);
    if (!bioCheck.ok) {
      showToast(t(bioCheck.reasonKey || 'moderation.reason.profanity'), 'alert-circle');
      return;
    }
    setIsSaving(true);
    try {
      // Local optimistic update — apply the transform onto the local
      // URI immediately so the redesigned profile screen picks it up
      // without waiting for the network round-trip below.
      const localBannerUrl = bannerUri
        ? serializeBannerTransform(bannerUri, bannerTransform)
        : undefined;
      updateProfile({
        displayName: name,
        username,
        bio,
        emoji: selectedEmoji,
        links,
        bannerUrl: localBannerUrl,
      });

      if (user?.id) {
        let finalBannerUrl = bannerUri;
        if (bannerUri && bannerUri.startsWith('file://')) {
          try {
            const { url } = await uploadBanner(user.id, bannerUri);
            if (url) finalBannerUrl = url;
          } catch {}
        }

        // Encode the transform as a hash on the final (uploaded) URL
        // so the next render of either profile screen will read it
        // back and apply the same position.
        const persistedUrl = finalBannerUrl
          ? serializeBannerTransform(finalBannerUrl, bannerTransform)
          : undefined;

        await updateSupabaseProfile(user.id, {
          display_name: name,
          bio,
          emoji: selectedEmoji,
          banner_url: persistedUrl || undefined,
          links: links.length > 0 ? links : [],
        });

        if (persistedUrl && persistedUrl !== localBannerUrl) {
          updateProfile({ bannerUrl: persistedUrl });
        }
      }
    } catch {
      // Local update already applied; ignore network failure.
    }
    setIsSaving(false);
    router.back();
  };

  const handleAddLink = () => {
    if (links.length >= 3) return;
    setEditingLinkIndex(null);
    setLinkUrl('');
    setLinkType('website');
    setShowLinkPicker(true);
  };

  const handleEditLink = (index: number) => {
    setEditingLinkIndex(index);
    setLinkUrl(links[index].url);
    setLinkType(links[index].type);
    setShowLinkPicker(true);
  };

  const handleSaveLink = () => {
    if (!linkUrl.trim()) {
      setShowLinkPicker(false);
      return;
    }
    const detectedType = detectLinkTypeFromUrl(linkUrl.trim());
    const finalType = detectedType !== 'website' ? detectedType : linkType;
    const newLink: UserLink = { type: finalType, url: linkUrl.trim() };
    if (editingLinkIndex !== null) {
      const updated = [...links];
      updated[editingLinkIndex] = newLink;
      setLinks(updated);
    } else {
      setLinks([...links, newLink]);
    }
    setShowLinkPicker(false);
  };

  const handleRemoveLink = (index: number) => {
    setLinks(links.filter((_, i) => i !== index));
  };

  const bgPrimary = theme.colors.background.primary;
  const bgElevated = theme.colors.background.elevated;
  const bgSecondary = theme.colors.background.secondary;
  const borderColor = theme.colors.border.light;
  const accent = theme.colors.accent.primary;

  return (
    <View style={[styles.root, { backgroundColor: bgPrimary }]}>
      {/* Floating header — three blur pills (back / title / save) sitting
          directly over the banner. Title pill is absolutely centered so
          the dynamic Save text width can't push it off-axis; the text
          inside the pill is single-line + ellipsizeMode='tail' so very
          long localizations still fit. A subtle gradient fades the
          screen background into the banner so the pills sit on a
          softer edge — the user asked for the blur back at the top
          after seeing it without. */}
      <View style={[styles.headerGradient, { height: insets.top + 56 }]} pointerEvents="none">
        <LinearGradient
          colors={[bgPrimary + 'CC', bgPrimary + '66', bgPrimary + '00']}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={[styles.headerRow, { top: 28 }]} pointerEvents="box-none">
        <Pressable onPress={handleClose} hitSlop={10} style={styles.headerPill}>
          <BlurView intensity={80} tint="dark" style={styles.headerPillInner}>
            <Feather name="x" size={18} color="#FFFFFF" />
          </BlurView>
        </Pressable>
        <View style={styles.headerTitleAbs} pointerEvents="box-none">
          <ShrinkingModalTitle>
            <View style={styles.headerTitlePill}>
              <BlurView intensity={80} tint="dark" style={styles.headerTitleInner}>
                <RNText
                  style={styles.headerTitleText}
                  allowFontScaling={false}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {t('edit_profile.title')}
                </RNText>
              </BlurView>
            </View>
          </ShrinkingModalTitle>
        </View>
        <Pressable onPress={handleSave} disabled={isSaving} hitSlop={10} style={styles.headerPill}>
          <BlurView intensity={80} tint="dark" style={[styles.headerPillInner, { paddingHorizontal: 14 }]}>
            <RNText style={styles.headerSaveText} allowFontScaling={false}>
              {isSaving ? '...' : t('common.save')}
            </RNText>
          </BlurView>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
      >
        {/* Banner — full-bleed at the top with a tap-to-pick affordance.
            Uses CachedImage so the same banner URL doesn't re-fetch every
            time the screen mounts (regular <Image> bypassed expo-image's
            cache, which is why the banner used to flash on each reopen).
            Applies the user-chosen transform here too so the editor's
            preview matches what the actual profile screens render.
            The "Position" pill is a NESTED Pressable; React Native's
            responder system gives the inner pressable priority so a tap
            on it opens the editor instead of the picker. */}
        <Pressable onPress={pickBanner}>
          <View style={[styles.banner, { backgroundColor: accent + '20', paddingTop: insets.top + 56 }]}>
            {bannerUri ? (
              <CachedImage
                uri={bannerUri}
                style={[
                  StyleSheet.absoluteFillObject,
                  {
                    transform: [
                      { translateX: bannerTransform.translateX },
                      { translateY: bannerTransform.translateY },
                      { scale: bannerTransform.scale },
                    ],
                  },
                ]}
                resizeMode="cover"
                proxyWidth={1080}
              />
            ) : null}
            <LinearGradient
              colors={['transparent', bgPrimary]}
              style={[StyleSheet.absoluteFillObject, { top: undefined, height: 80 }]}
            />
            {!bannerUri && (
              <View style={styles.bannerPlaceholder}>
                <Feather name="image" size={22} color={theme.colors.text.tertiary} />
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 4 }}>
                  {t('edit_profile.add_banner')}
                </Text>
              </View>
            )}
            {/* Re-open the position editor without re-uploading. Only
                shown when there's something to position. */}
            {bannerUri && (
              <Pressable onPress={adjustBanner} hitSlop={8} style={styles.bannerAdjustPill}>
                <Feather name="move" size={12} color="#FFFFFF" />
                <RNText style={styles.bannerEditText} allowFontScaling={false}>
                  {t('edit_profile.banner.adjust')}
                </RNText>
              </Pressable>
            )}
            <View style={styles.bannerEditPill}>
              <Feather name="edit-2" size={12} color="#FFFFFF" />
              <RNText style={styles.bannerEditText} allowFontScaling={false}>
                {t('edit_profile.add_banner')}
              </RNText>
            </View>
          </View>
        </Pressable>

        {/* Avatar — overlaps the banner edge by half its height */}
        <View style={styles.avatarWrap}>
          <Pressable onPress={() => setShowEmojiPicker(true)}>
            <View
              style={[
                styles.avatarRing,
                { borderColor: bgPrimary, backgroundColor: bgElevated },
              ]}
            >
              <Avatar emoji={selectedEmoji} size="xl" />
            </View>
            <View style={[styles.avatarBadge, { backgroundColor: accent }]}>
              <Feather name="edit-2" size={11} color="#FFFFFF" />
            </View>
          </Pressable>
          <Pressable
            onPress={() => setShowEmojiPicker(true)}
            style={{ marginTop: 10, alignSelf: 'center' }}
          >
            <Text variant="caption" weight="semibold" color={accent}>
              {t('edit_profile.change_emoji')}
            </Text>
          </Pressable>
        </View>

        {/* Fields — each in a tinted card so the form reads like one cohesive group */}
        <View style={[styles.cardSection, { backgroundColor: bgElevated, borderColor }]}>
          <Input
            label={t('edit_profile.name_label')}
            value={name}
            onChangeText={setName}
            placeholder={t('edit_profile.name_placeholder')}
            style={{ marginBottom: 12 }}
          />
          <Input
            label={t('edit_profile.username_label')}
            value={username}
            onChangeText={setUsername}
            placeholder="username"
            style={{ marginBottom: 12 }}
          />
          <Input
            label={t('edit_profile.bio_label')}
            value={bio}
            onChangeText={(text) => setBio(text.slice(0, 150))}
            placeholder={t('edit_profile.bio_placeholder')}
            multiline
            style={{ marginBottom: 4 }}
          />
          <Text variant="caption" color={theme.colors.text.tertiary} align="right">
            {t('edit_profile.chars_left', undefined, { count: 150 - bio.length })}
          </Text>
        </View>

        {/* Links section — card-style, matches Fields visually */}
        <View style={[styles.linksSection, { backgroundColor: bgElevated, borderColor }]}>
          <View style={styles.linksHeader}>
            <Text variant="body" weight="semibold">
              {t('edit_profile.links')}
            </Text>
            <Text variant="caption" color={theme.colors.text.tertiary}>
              {links.length}/3
            </Text>
          </View>
          {links.map((link, index) => (
            <View
              key={index}
              style={[styles.linkRow, { backgroundColor: bgSecondary }]}
            >
              <Feather
                name={(LINK_TYPES.find((lt) => lt.key === link.type)?.icon || 'link') as any}
                size={17}
                color={accent}
              />
              <Pressable onPress={() => handleEditLink(index)} style={styles.linkRowText}>
                <Text variant="caption" weight="medium" numberOfLines={1}>
                  {link.url}
                </Text>
              </Pressable>
              <Pressable onPress={() => handleRemoveLink(index)} hitSlop={6}>
                <Feather name="x-circle" size={18} color={theme.colors.text.tertiary} />
              </Pressable>
            </View>
          ))}
          {links.length < 3 && (
            <Pressable onPress={handleAddLink} style={styles.addLinkRow}>
              <Feather name="plus-circle" size={18} color={accent} />
              <Text variant="caption" weight="medium" color={accent}>
                {t('edit_profile.add_link')}
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {/* Emoji picker — same SlideUpSheet as the post 3-dots menu so the
          height, corners, and animation match exactly. */}
      <SlideUpSheet visible={showEmojiPicker} onClose={() => setShowEmojiPicker(false)}>
        <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 8 }}>
          {t('edit_profile.emoji_title')}
        </Text>
        <View style={[styles.emojiPreviewWrap, { borderColor: accent, backgroundColor: accent + '15' }]}>
          <RNText style={styles.emojiPreviewText} allowFontScaling={false}>
            {selectedEmoji}
          </RNText>
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ maxHeight: SCREEN_HEIGHT * 0.45 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
        >
          {MOOD_CATEGORIES.map((category) => (
            <View key={category.titleKey} style={{ marginBottom: 16 }}>
              <Text
                variant="caption"
                weight="semibold"
                color={theme.colors.text.secondary}
                style={{ marginBottom: 8, paddingHorizontal: 4 }}
              >
                {t(category.titleKey)}
              </Text>
              <View style={styles.emojiGrid}>
                {category.emojis.map((e) => {
                  const active = selectedEmoji === e;
                  return (
                    <Pressable
                      key={e}
                      onPress={() => {
                        setSelectedEmoji(e);
                        setShowEmojiPicker(false);
                      }}
                      style={[
                        styles.emojiCell,
                        {
                          backgroundColor: active ? accent + '30' : bgSecondary,
                          borderColor: active ? accent : 'transparent',
                          borderWidth: active ? 2 : 0,
                        },
                      ]}
                    >
                      <RNText style={styles.emojiCellText} allowFontScaling={false}>
                        {e}
                      </RNText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      </SlideUpSheet>

      {/* Link picker — small card-style modal with the URL input + type picker.
          Stays a regular Modal because it needs the keyboard to push its
          content up; SlideUpSheet's static-bottom anchoring would let the
          keyboard cover the input. */}
      <Modal
        visible={showLinkPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLinkPicker(false)}
        statusBarTranslucent
      >
        <Pressable
          style={styles.linkPickerBackdrop}
          onPress={() => setShowLinkPicker(false)}
        />
        <KeyboardAvoidingView
          style={styles.linkPickerWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          pointerEvents="box-none"
        >
          <View style={[styles.linkPickerCard, { backgroundColor: bgElevated }]}>
            <View style={styles.linkPickerHandle}>
              <View style={[styles.linkPickerHandleBar, { backgroundColor: borderColor }]} />
            </View>
            <Text variant="body" weight="semibold" align="center" style={{ marginBottom: 16 }}>
              {editingLinkIndex !== null
                ? t('edit_profile.link_edit_title')
                : t('edit_profile.link_add_title')}
            </Text>
            <Text
              variant="caption"
              weight="medium"
              color={theme.colors.text.secondary}
              style={{ marginBottom: 8 }}
            >
              {t('edit_profile.link_type')}
            </Text>
            <View style={styles.linkTypeRow}>
              {LINK_TYPES.map((lt) => {
                const active = linkType === lt.key;
                return (
                  <Pressable
                    key={lt.key}
                    onPress={() => setLinkType(lt.key)}
                    style={[
                      styles.linkTypePill,
                      {
                        backgroundColor: active ? accent + '20' : bgSecondary,
                        borderColor: active ? accent : 'transparent',
                        borderWidth: active ? 1.5 : 0,
                      },
                    ]}
                  >
                    <Feather
                      name={lt.icon as any}
                      size={14}
                      color={active ? accent : theme.colors.text.tertiary}
                    />
                    <Text
                      variant="caption"
                      weight={active ? 'semibold' : 'regular'}
                      color={active ? accent : theme.colors.text.secondary}
                    >
                      {lt.key === 'website' ? t('edit_profile.link_website') : lt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Input
              label="URL"
              value={linkUrl}
              onChangeText={(text) => {
                setLinkUrl(text);
                const detected = detectLinkTypeFromUrl(text);
                if (detected !== 'website' || text.length > 10) setLinkType(detected);
              }}
              placeholder="https://..."
              style={{ marginBottom: 20 }}
            />
            <Pressable
              onPress={handleSaveLink}
              style={[styles.linkPickerSave, { backgroundColor: accent }]}
            >
              <Text variant="body" weight="semibold" color={theme.colors.text.inverse}>
                {editingLinkIndex !== null
                  ? t('edit_profile.link_save')
                  : t('edit_profile.link_add')}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Banner position editor — drag + pinch the picked image inside
          a 300-tall banner-shaped frame, then save. Reanimated drives
          everything on the UI thread so the gesture stays at 60fps even
          while the JS thread is busy with the rest of the form. The
          GestureHandlerRootView wrapper inside the Modal is mandatory —
          gesture handlers don't propagate into RN's portal-rendered
          modals from the app-level root. */}
      <BannerPositionEditorModal
        visible={showBannerEditor}
        uri={bannerUri}
        initial={bannerTransform}
        onCancel={handleBannerEditorCancel}
        onSave={handleBannerEditorSave}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Banner position editor
// ─────────────────────────────────────────────────────────────────────────
// The picked image lives inside a banner-shaped frame; the user drags +
// pinches to position. Gestures drive shared values via reanimated, so
// the entire transform pipeline runs on the UI thread without crossing
// the JS bridge — which matters because the parent screen is doing a lot
// of other work (form state, image cache invalidations, etc.).
//
// On save, the committed shared values are read back via runOnJS into a
// plain `BannerTransform` object and handed to the parent via `onSave`.
// Cancel restores the editor's saved state; the parent's transform stays
// untouched.
interface BannerPositionEditorModalProps {
  visible: boolean;
  uri: string | null;
  initial: BannerTransform;
  onCancel: () => void;
  onSave: (transform: BannerTransform) => void;
}

function BannerPositionEditorModal({
  visible,
  uri,
  initial,
  onCancel,
  onSave,
}: BannerPositionEditorModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();

  // Live values driven by the gestures.
  const translateX = useSharedValue(initial.translateX);
  const translateY = useSharedValue(initial.translateY);
  const scale = useSharedValue(initial.scale);
  // Snapshot of the values at the start of each gesture so the live
  // delta can be applied on top — keeps successive pans/pinches from
  // resetting position back to (0,0,1).
  const savedTranslateX = useSharedValue(initial.translateX);
  const savedTranslateY = useSharedValue(initial.translateY);
  const savedScale = useSharedValue(initial.scale);

  // Re-seed the shared values whenever the modal opens against a
  // potentially different `initial`. Without this, opening the editor
  // a second time after a Cancel would still show the previously
  // committed in-modal state.
  useEffect(() => {
    if (!visible) return;
    translateX.value = initial.translateX;
    translateY.value = initial.translateY;
    scale.value = initial.scale;
    savedTranslateX.value = initial.translateX;
    savedTranslateY.value = initial.translateY;
    savedScale.value = initial.scale;
  }, [visible, initial.translateX, initial.translateY, initial.scale]);

  // Pan: translates the cover-fitted image inside the frame. No
  // hard clamp here — at 1× the user can drag the edge inwards to
  // intentionally show the background tint, which is fine; the
  // serializer's MAX_TRANSLATE guard catches anything pathological.
  const panGesture = Gesture.Pan()
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // Pinch: clamps to 1×–3× per the spec. Hard clamp during the gesture
  // means the visible value can never escape bounds, so onEnd can just
  // commit the current value without a spring snap-back.
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      if (next < MIN_SCALE) scale.value = MIN_SCALE;
      else if (next > MAX_SCALE) scale.value = MAX_SCALE;
      else scale.value = next;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture);

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // Commit the live transform back to the JS thread on save.
  const handleSave = () => {
    const next: BannerTransform = {
      translateX: translateX.value,
      translateY: translateY.value,
      scale: scale.value,
    };
    onSave(next);
  };

  if (!uri) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      {/* GestureHandlerRootView is required inside Modal — RN portals the
          modal contents outside the app's gesture root, so handlers
          attached to <GestureDetector> wouldn't fire without this. */}
      <GestureHandlerRootView style={editorStyles.root}>
        <View style={[editorStyles.dim, { paddingTop: insets.top }]}>
          <View style={editorStyles.headerRow}>
            <Pressable
              onPress={onCancel}
              hitSlop={10}
              style={editorStyles.headerBtn}
            >
              <RNText style={editorStyles.headerBtnText} allowFontScaling={false}>
                {t('edit_profile.banner.cancel')}
              </RNText>
            </Pressable>
            <RNText
              style={editorStyles.headerTitle}
              allowFontScaling={false}
              numberOfLines={1}
            >
              {t('edit_profile.banner.editor_title')}
            </RNText>
            <Pressable
              onPress={handleSave}
              hitSlop={10}
              style={[editorStyles.headerBtn, editorStyles.headerBtnSave]}
            >
              <RNText
                style={[editorStyles.headerBtnText, editorStyles.headerBtnSaveText]}
                allowFontScaling={false}
              >
                {t('edit_profile.banner.save')}
              </RNText>
            </Pressable>
          </View>

          {/* Banner-shaped frame containing the gesture-driven image.
              `overflow: 'hidden'` clips the transformed image to the
              frame so the user only ever sees what would render on
              the actual profile screen. */}
          <View
            style={[
              editorStyles.frame,
              {
                width: SCREEN_WIDTH,
                height: BANNER_EDIT_HEIGHT,
                backgroundColor: theme.colors.accent.primary + '33',
              },
            ]}
          >
            <GestureDetector gesture={composedGesture}>
              <Animated.View style={[StyleSheet.absoluteFill, animatedImageStyle]}>
                <CachedImage
                  uri={uri}
                  style={StyleSheet.absoluteFillObject}
                  resizeMode="cover"
                  proxyWidth={800}
                />
              </Animated.View>
            </GestureDetector>
            {/* Subtle inset border so the frame edge is visible against
                the dimmed backdrop even when the image is light. */}
            <View pointerEvents="none" style={editorStyles.frameBorder} />
          </View>

          <View style={editorStyles.hintWrap} pointerEvents="none">
            <View style={editorStyles.hintPill}>
              <Feather name="move" size={12} color="#FFFFFF" />
              <RNText style={editorStyles.hintText} allowFontScaling={false}>
                {t('edit_profile.banner.editor_hint')}
              </RNText>
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const editorStyles = StyleSheet.create({
  root: { flex: 1 },
  dim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
  },
  headerRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  headerBtnSave: {
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  headerBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  headerBtnSaveText: {
    color: '#000000',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  frame: {
    overflow: 'hidden',
    marginTop: 24,
  },
  frameBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  hintWrap: {
    marginTop: 28,
    alignItems: 'center',
  },
  hintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  hintText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
  },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99,
  },
  headerRow: {
    // top is supplied via inline style (insets.top + 8) so we don't carry
    // any paddingTop on the row itself — paddingTop would push the X / Save
    // pills below the title pill (which is absolutely positioned and would
    // ignore the padding), leaving the three not vertically aligned.
    position: 'absolute',
    left: 0,
    right: 0,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 100,
  },
  headerPill: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  headerPillInner: {
    height: 36,
    minWidth: 36,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  headerTitleAbs: {
    // Absolute centering — width:100% with center alignment so the title
    // pill sits exactly on screen-x-center regardless of how wide the
    // Save / X buttons grow with localization. paddingHorizontal:60 keeps
    // the pill from overlapping the side buttons even on narrow phones.
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 60,
  },
  headerTitlePill: {
    borderRadius: 18,
    overflow: 'hidden',
    maxWidth: '100%',
  },
  headerTitleInner: {
    height: 36,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  headerSaveText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  banner: {
    height: 220,
    width: '100%',
    overflow: 'hidden',
  },
  bannerPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerEditPill: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  bannerEditText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  // "Position" pill — bottom-LEFT of the banner so it doesn't collide
  // with the existing edit-banner pill on the right. Mirrors the same
  // visual treatment so the two pills read as siblings.
  bannerAdjustPill: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  avatarWrap: {
    alignItems: 'center',
    marginTop: -48,
    marginBottom: 16,
  },
  avatarRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: 'hidden',
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSection: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 18,
    borderWidth: 0.5,
    marginBottom: 16,
  },
  linksSection: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 18,
    borderWidth: 0.5,
  },
  linksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 8,
    gap: 10,
  },
  linkRowText: { flex: 1 },
  addLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  emojiPreviewWrap: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    marginBottom: 12,
  },
  emojiPreviewText: { fontSize: 36 },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  emojiCell: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiCellText: { fontSize: 24 },
  linkPickerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  linkPickerWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  linkPickerCard: {
    marginHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 32,
    elevation: 20,
  },
  linkPickerHandle: { alignItems: 'center', marginBottom: 12 },
  linkPickerHandleBar: { width: 36, height: 5, borderRadius: 3 },
  linkTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  linkTypePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  linkPickerSave: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
});
