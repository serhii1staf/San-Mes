import React, { useState, useRef, useEffect } from 'react';
import { View, ScrollView, Pressable, ViewStyle, Platform, KeyboardAvoidingView, Animated, Dimensions, PanResponder, Text as RNText, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/theme';
import { Text, Input, Avatar } from '../../src/components/ui';
import { useAuthStore, UserLink } from '../../src/store/authStore';
import { updateProfile as updateSupabaseProfile, supabase, uploadBanner, saveProfileMeta, loadProfileMeta } from '../../src/lib/supabase';
import { currentUser } from '../../src/utils/mockData';
import { useT } from '../../src/i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_THRESHOLD = 200;

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
  // `website` label is translated at use site via `edit_profile.link_website`.
  { key: 'website', label: '', icon: 'globe', patterns: [] },
];

function detectLinkTypeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  for (const lt of LINK_TYPES) {
    if (lt.patterns.some(p => lower.includes(p))) return lt.key;
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

// Flat list for quick access
const ALL_EMOJIS = MOOD_CATEGORIES.flatMap(c => c.emojis);

export default function EditProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { user, updateProfile } = useAuthStore();
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

  // Load banner from profile meta on mount (in case local state was lost)
  useEffect(() => {
    if (user?.id && !bannerUri) {
      loadProfileMeta(user.id).then(({ meta }) => {
        if (meta?.banner_url) setBannerUri(meta.banner_url);
      });
    }
  }, [user?.id]);

  // Animation
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const dragAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Animate both backdrop and sheet together
    Animated.parallel([
      Animated.timing(backdropAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }),
    ]).start();
  }, []);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 280, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start(() => {
      router.back();
    });
  };

  // Swipe down to dismiss
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Only allow swipe-to-dismiss from top 60px of the modal
        const touchY = evt.nativeEvent.locationY;
        return touchY < 60 && gestureState.dy > 20 && Math.abs(gestureState.dx) * 2 < Math.abs(gestureState.dy);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          dragAnim.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > DISMISS_THRESHOLD) {
          handleClose();
        } else {
          Animated.spring(dragAnim, {
            toValue: 0,
            useNativeDriver: true,
            tension: 100,
            friction: 10,
          }).start();
        }
      },
    })
  ).current;

  // Emoji picker animation — same spring/timing pair as the main sheet so
  // the two slides feel like the same surface. Mounted only when visible
  // to keep the heavy emoji grid out of the initial render.
  const emojiSlide = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const emojiBackdrop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (showEmojiPicker) {
      emojiSlide.setValue(SCREEN_HEIGHT);
      emojiBackdrop.setValue(0);
      Animated.parallel([
        Animated.timing(emojiBackdrop, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(emojiSlide, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
      ]).start();
    }
  }, [showEmojiPicker]);
  const dismissEmojiPicker = () => {
    Animated.parallel([
      Animated.timing(emojiSlide, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(emojiBackdrop, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => setShowEmojiPicker(false));
  };

  const pickBanner = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // Do NOT enable allowsEditing — iOS' built-in crop converts animated
      // GIFs to a single static frame and re-encodes as JPEG. Same goes for
      // the `quality` setting which forces JPEG re-encoding. The banner is
      // already shown at a fixed 3:1 region with `resizeMode: 'cover'`, so
      // we don't need a crop step. This keeps GIFs animated end-to-end.
      allowsEditing: false,
      quality: 1.0,
    });
    if (!result.canceled && result.assets[0]) {
      setBannerUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Update local state immediately
      updateProfile({ displayName: name, username, bio, emoji: selectedEmoji, links, bannerUrl: bannerUri || undefined });

      if (user?.id) {
        // Try to upload banner to Storage first
        let finalBannerUrl = bannerUri;
        if (bannerUri && bannerUri.startsWith('file://')) {
          try {
            const { url } = await uploadBanner(user.id, bannerUri);
            if (url) finalBannerUrl = url;
          } catch {}
        }

        // Save everything to DB in one call
        await updateSupabaseProfile(user.id, {
          display_name: name,
          bio,
          emoji: selectedEmoji,
          banner_url: finalBannerUrl || undefined,
          links: links.length > 0 ? links : [],
        });

        // Update local with remote URL
        if (finalBannerUrl && finalBannerUrl !== bannerUri) {
          updateProfile({ bannerUrl: finalBannerUrl });
        }
      }
    } catch (e) {
      // Local save always works
    }
    setIsSaving(false);
    handleClose();
  };

  const handleAddLink = () => {
    if (links.length >= 3) {
      return;
    }
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
    // Auto-detect type from URL for accuracy
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

  const outerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: 'transparent',
  };

  // Match the post 3-dots menu (PostMenuModal) so the edit-profile sheet
  // visually belongs to the same family: bottom-anchored, theme-aware
  // background, 28-px corners, **content-sized** (not full screen). The
  // heavy fields live inside an inner ScrollView with its own maxHeight,
  // so the whole card grows up to a comfortable ~55% of the screen and
  // never reaches the status bar — same feel as PostMenuModal which is
  // also content-sized.
  const sheetBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';
  // Cap the inner ScrollView so the card stays in the bottom-half feel
  // family. iPhone 12 (~844 px) gets ~460 px of scroll area, plenty for
  // banner + emoji + name + username + bio + first link without forcing
  // the user into a fullscreen card. Smaller / larger phones scale
  // proportionally.
  const sheetScrollMaxHeight = SCREEN_HEIGHT * 0.55;
  const cardStyle: ViewStyle = {
    marginHorizontal: 8,
    marginBottom: insets.bottom + 16,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: sheetBg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 12,
  };

  const translateY = Animated.add(slideAnim, dragAnim);

  return (
    <View style={outerStyle}>
      {/* Backdrop - tap to close */}
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim }}>
        <Pressable style={{ flex: 1 }} onPress={handleClose} />
      </Animated.View>

      {/* Modal Card — bottom-anchored, slides up from the bottom edge.
          We deliberately do NOT wrap in KeyboardAvoidingView: when the
          user taps Name/Username/Bio fields, behavior="padding" used to
          push the entire modal off the top of the screen. With the card
          now content-sized (not full-tall), iOS' built-in keyboard
          handling for ScrollView keeps the focused input visible without
          us moving the whole sheet, which matches what the user
          described as "earlier the modal closed halfway when typing". */}
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View
          style={[
            cardStyle,
            { transform: [{ translateY }] },
          ]}
          {...panResponder.panHandlers}
        >
          {/* Drag handle — sits at the top of the card. The wrapping
              Animated.View is content-sized now (no flex:1, no fixed
              height), so an inner `flex: 1` wrapper would collapse to
              zero — that's why the user briefly saw only the backdrop.
              Children render directly on the Animated.View. */}
          <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
            <View
              style={{
                width: 36,
                height: 5,
                borderRadius: 3,
                backgroundColor: theme.colors.border.medium,
              }}
            />
          </View>

          <ScrollView
            style={{ maxHeight: sheetScrollMaxHeight }}
            contentContainerStyle={{ paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
            scrollEnabled={true}
          >
                {/* Header */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 20,
                    paddingTop: 8,
                    paddingBottom: 12,
                  }}
                >
                  <Pressable onPress={handleClose}>
                    <Feather name="x" size={22} color={theme.colors.text.primary} />
                  </Pressable>
                  <Text variant="body" weight="semibold">{t('edit_profile.title')}</Text>
                  <Pressable onPress={handleSave} disabled={isSaving}>
                    <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>
                      {isSaving ? '...' : t('common.save')}
                    </Text>
                  </Pressable>
                </View>

                {/* Banner */}
                <Pressable onPress={pickBanner} style={{ marginHorizontal: 20, marginBottom: 16 }}>
                  <View style={{ height: 100, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.colors.background.secondary }}>
                    {bannerUri ? (
                      <Image source={{ uri: bannerUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    ) : (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Feather name="image" size={24} color={theme.colors.text.tertiary} />
                        <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 4 }}>{t('edit_profile.add_banner')}</Text>
                      </View>
                    )}
                  </View>
                </Pressable>

                {/* Emoji Avatar */}
                <View style={{ alignItems: 'center', marginVertical: 20 }}>
                  <Avatar emoji={selectedEmoji} size="xl" />
                  <Pressable style={{ marginTop: 12 }} onPress={() => setShowEmojiPicker(true)}>
                    <Text variant="body" weight="medium" color={theme.colors.accent.primary}>
                      {t('edit_profile.change_emoji')}
                    </Text>
                  </Pressable>
                </View>

                {/* Fields */}
                <View style={{ paddingHorizontal: 20 }}>
                  <Input
                    label={t('edit_profile.name_label')}
                    value={name}
                    onChangeText={setName}
                    placeholder={t('edit_profile.name_placeholder')}
                    style={{ marginBottom: 16 }}
                  />

                  <Input
                    label={t('edit_profile.username_label')}
                    value={username}
                    onChangeText={setUsername}
                    placeholder="username"
                    style={{ marginBottom: 16 }}
                  />

                  <Input
                    label={t('edit_profile.bio_label')}
                    value={bio}
                    onChangeText={(text) => setBio(text.slice(0, 150))}
                    placeholder={t('edit_profile.bio_placeholder')}
                    multiline
                    style={{ marginBottom: 4 }}
                  />
                  <Text
                    variant="caption"
                    color={theme.colors.text.tertiary}
                    style={{ marginBottom: 20 }}
                  >
                    {t('edit_profile.chars_left', undefined, { count: 150 - bio.length })}
                  </Text>

                  {/* Links Section */}
                  <View style={{ marginBottom: 24 }}>
                    <Text variant="body" weight="semibold" style={{ marginBottom: 12 }}>
                      {t('edit_profile.links')}
                    </Text>
                    {links.map((link, index) => (
                      <View
                        key={index}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: theme.colors.background.secondary,
                          borderRadius: 12,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          marginBottom: 8,
                        }}
                      >
                        <Feather
                          name={(LINK_TYPES.find(t => t.key === link.type)?.icon || 'link') as any}
                          size={18}
                          color={theme.colors.accent.primary}
                        />
                        <Pressable
                          onPress={() => handleEditLink(index)}
                          style={{ flex: 1, marginLeft: 10 }}
                        >
                          <Text variant="caption" weight="medium" numberOfLines={1}>
                            {link.url}
                          </Text>
                        </Pressable>
                        <Pressable onPress={() => handleRemoveLink(index)}>
                          <Feather name="x-circle" size={18} color={theme.colors.text.tertiary} />
                        </Pressable>
                      </View>
                    ))}
                    {links.length < 3 && (
                      <Pressable
                        onPress={handleAddLink}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          paddingVertical: 10,
                        }}
                      >
                        <Feather name="plus-circle" size={18} color={theme.colors.accent.primary} />
                        <Text variant="caption" weight="medium" color={theme.colors.accent.primary}>
                          {t('edit_profile.add_link')}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              </ScrollView>
        </Animated.View>
      </View>

      {/* Emoji/Mood Picker — same family as the main sheet (PostMenuModal-
          style): bottom-anchored card, theme background, smooth spring in
          and timed slide-out so it doesn't pop on/off any more. */}
      {showEmojiPicker && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
            justifyContent: 'flex-end',
          }}
        >
          <Animated.View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.4)',
              opacity: emojiBackdrop,
            }}
          >
            <Pressable style={{ flex: 1 }} onPress={dismissEmojiPicker} />
          </Animated.View>
          <Animated.View
            style={{
              marginHorizontal: 8,
              marginBottom: insets.bottom + 16,
              borderRadius: 28,
              overflow: 'hidden',
              backgroundColor: sheetBg,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.14,
              shadowRadius: 18,
              elevation: 12,
              transform: [{ translateY: emojiSlide }],
            }}
          >
            {/* Drag handle */}
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <View
                style={{
                  width: 36,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: theme.colors.border.medium,
                }}
              />
            </View>

            {/* Header */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 20,
                paddingTop: 8,
                paddingBottom: 12,
              }}
            >
              <Pressable onPress={dismissEmojiPicker}>
                <Feather name="x" size={22} color={theme.colors.text.primary} />
              </Pressable>
              <Text variant="body" weight="semibold">{t('edit_profile.emoji_title')}</Text>
              <View style={{ width: 22 }} />
            </View>

            {/* Current selection preview */}
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: theme.colors.accent.primary + '20',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: theme.colors.accent.primary,
                  overflow: 'visible',
                }}
              >
                <RNText style={{ fontSize: 36 }} allowFontScaling={false}>{selectedEmoji}</RNText>
              </View>
            </View>

            {/* Scrollable emoji categories */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: SCREEN_HEIGHT * 0.5 }}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
            >
              {MOOD_CATEGORIES.map((category) => (
                <View key={category.titleKey} style={{ marginBottom: 20 }}>
                  <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 10, paddingHorizontal: 4 }}>
                    {t(category.titleKey)}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
                    {category.emojis.map((e) => (
                      <Pressable
                        key={e}
                        onPress={() => { setSelectedEmoji(e); dismissEmojiPicker(); }}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 12,
                          backgroundColor: selectedEmoji === e ? theme.colors.accent.primary + '30' : theme.colors.background.secondary,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: selectedEmoji === e ? 2 : 0,
                          borderColor: theme.colors.accent.primary,
                          overflow: 'visible',
                        }}
                      >
                        <RNText style={{ fontSize: 24 }} allowFontScaling={false}>{e}</RNText>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          </Animated.View>
        </View>
      )}

      {/* Link Picker modal overlay */}
      {showLinkPicker && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
          }}
        >
          <Pressable
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
            }}
            onPress={() => setShowLinkPicker(false)}
          />
          <KeyboardAvoidingView
            style={{ flex: 1, justifyContent: 'center' }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View
              style={{
                marginHorizontal: 16,
                backgroundColor: theme.isDark ? '#1e1e1e' : '#ffffff',
                borderRadius: 24,
                paddingTop: 16,
                paddingBottom: 24,
                paddingHorizontal: 20,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 12 },
                shadowOpacity: 0.3,
                shadowRadius: 32,
                elevation: 20,
              }}
            >
              <View style={{ alignItems: 'center', marginBottom: 16 }}>
                <View
                  style={{
                    width: 36,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: theme.colors.border.medium,
                  }}
                />
              </View>
              <Text variant="body" weight="semibold" align="center" style={{ marginBottom: 16 }}>
                {editingLinkIndex !== null ? t('edit_profile.link_edit_title') : t('edit_profile.link_add_title')}
              </Text>

              {/* Link type selector */}
              <Text variant="caption" weight="medium" color={theme.colors.text.secondary} style={{ marginBottom: 8 }}>
                {t('edit_profile.link_type')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {LINK_TYPES.map((lt) => (
                  <Pressable
                    key={lt.key}
                    onPress={() => setLinkType(lt.key)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 10,
                      backgroundColor: linkType === lt.key
                        ? theme.colors.accent.primary + '20'
                        : theme.colors.background.secondary,
                      borderWidth: linkType === lt.key ? 1.5 : 0,
                      borderColor: theme.colors.accent.primary,
                    }}
                  >
                    <Feather name={lt.icon as any} size={14} color={linkType === lt.key ? theme.colors.accent.primary : theme.colors.text.tertiary} />
                    <Text variant="caption" weight={linkType === lt.key ? 'semibold' : 'regular'} color={linkType === lt.key ? theme.colors.accent.primary : theme.colors.text.secondary}>
                      {lt.key === 'website' ? t('edit_profile.link_website') : lt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* URL input */}
              <Input
                label="URL"
                value={linkUrl}
                onChangeText={(text) => {
                  setLinkUrl(text);
                  // Auto-detect link type from URL
                  const detected = detectLinkTypeFromUrl(text);
                  if (detected !== 'website' || text.length > 10) {
                    setLinkType(detected);
                  }
                }}
                placeholder="https://..."
                style={{ marginBottom: 20 }}
              />

              <Pressable
                onPress={handleSaveLink}
                style={{
                  backgroundColor: theme.colors.accent.primary,
                  borderRadius: 14,
                  paddingVertical: 14,
                  alignItems: 'center',
                }}
              >
                <Text variant="body" weight="semibold" color={theme.colors.text.inverse}>
                  {editingLinkIndex !== null ? t('edit_profile.link_save') : t('edit_profile.link_add')}
                </Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}
    </View>
  );
}
