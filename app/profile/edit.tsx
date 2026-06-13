import React, { useState, useEffect } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Platform, Modal, KeyboardAvoidingView, Text as RNText, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/theme';
import { Text, Input, Avatar } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { SlideUpSheet } from '../../src/components/ui/SlideUpSheet';
import { useAuthStore, UserLink } from '../../src/store/authStore';
import { updateProfile as updateSupabaseProfile, uploadBanner, loadProfileMeta } from '../../src/lib/supabase';
import { currentUser } from '../../src/utils/mockData';
import { useT } from '../../src/i18n/store';
import { validateName, validateBio } from '../../src/services/moderation';
import { showToast } from '../../src/store/toastStore';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

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
  const [bannerUri, setBannerUri] = useState<string | null>((user as any)?.bannerUrl || null);

  // Load banner from server-side meta in case the local copy got dropped.
  useEffect(() => {
    if (user?.id && !bannerUri) {
      loadProfileMeta(user.id)
        .then(({ meta }) => {
          if (meta?.banner_url) setBannerUri(meta.banner_url);
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
    }
  };

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
      updateProfile({
        displayName: name,
        username,
        bio,
        emoji: selectedEmoji,
        links,
        bannerUrl: bannerUri || undefined,
      });

      if (user?.id) {
        let finalBannerUrl = bannerUri;
        if (bannerUri && bannerUri.startsWith('file://')) {
          try {
            const { url } = await uploadBanner(user.id, bannerUri);
            if (url) finalBannerUrl = url;
          } catch {}
        }

        await updateSupabaseProfile(user.id, {
          display_name: name,
          bio,
          emoji: selectedEmoji,
          banner_url: finalBannerUrl || undefined,
          links: links.length > 0 ? links : [],
        });

        if (finalBannerUrl && finalBannerUrl !== bannerUri) {
          updateProfile({ bannerUrl: finalBannerUrl });
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
      <View style={[styles.headerRow, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable onPress={handleClose} hitSlop={10} style={styles.headerPill}>
          <BlurView intensity={80} tint="dark" style={styles.headerPillInner}>
            <Feather name="x" size={18} color="#FFFFFF" />
          </BlurView>
        </Pressable>
        <View style={styles.headerTitleAbs} pointerEvents="box-none">
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
            cache, which is why the banner used to flash on each reopen). */}
        <Pressable onPress={pickBanner}>
          <View style={[styles.banner, { backgroundColor: accent + '20', paddingTop: insets.top + 56 }]}>
            {bannerUri ? (
              <CachedImage
                uri={bannerUri}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
                proxyWidth={800}
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
    </View>
  );
}

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
