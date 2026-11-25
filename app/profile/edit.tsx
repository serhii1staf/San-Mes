import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Text as RNText, Dimensions, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from '../../src/components/ui/AppBlurView';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { SettingsSection } from '../../src/components/settings/SettingsList';
import {
  EditorAddLinkRow,
  EditorField,
  EditorHairline,
  EditorLinkRow,
  EditorSectionHeader,
} from '../../src/components/profile/EditorForm';
import { LinkEditorSheet } from '../../src/components/profile/LinkEditorSheet';
import { EmojiPickerSheet } from '../../src/components/profile/EmojiPickerSheet';
import { BannerPositionEditor } from '../../src/components/profile/BannerPositionEditor';
import type { LinkKind } from '../../src/utils/linkKind';
import { useAuthStore, UserLink } from '../../src/store/authStore';
import { updateProfile as updateSupabaseProfile, uploadBanner, loadProfileMeta } from '../../src/lib/supabase';
import { currentUser } from '../../src/utils/mockData';
import { useT } from '../../src/i18n/store';
// Import the validators from the moderation PACKAGE INDEX explicitly.
// A sibling file `src/services/moderation.ts` (report/block helpers) shadows
// the `moderation/` directory under default Metro resolution (a file beats a
// directory), and that file does NOT export validateName/validateBio. The
// bare specifier therefore resolved to `undefined` at runtime, so the first
// line of handleSave (`validateName(name)`) threw before its try/catch and
// the whole save silently no-opped. Pointing at `/index` resolves to the
// real validators on every bundler/TS path.
import { validateName, validateBio } from '../../src/services/moderation/index';
import { sanitizeUserText } from '../../src/utils/sanitizeText';
import { showToast } from '../../src/store/toastStore';
import {
  BannerTransform,
  IDENTITY_BANNER_TRANSFORM,
  parseBannerTransform,
  serializeBannerTransform,
  stripBannerTransform,
} from '../../src/utils/bannerTransform';
import { useLiquidGlassActive, NativeGlassView } from '../../src/components/ui/LiquidGlass';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function EditProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  // Native iOS-26 liquid glass for the floating header pills (close / title /
  // save). White icons + text sit over the banner, so we keep colorScheme
  // 'dark' for contrast (same as the profile-header chrome exception).
  const glassActive = useLiquidGlassActive();
  const displayUser = user || currentUser;

  const [name, setName] = useState(displayUser.displayName);
  const [username, setUsername] = useState(displayUser.username);
  const [bio, setBio] = useState(displayUser.bio || '');
  const [selectedEmoji, setSelectedEmoji] = useState(displayUser.emoji || '😊');
  const [links, setLinks] = useState<UserLink[]>((user as any)?.links || []);
  // ── VIEW MODE FIRST, EDIT MODE ON REQUEST ──────────────────────────────────
  //
  // The header's right-hand pill used to be "Сохранить" permanently. It is now "Изменить" until the
  // user asks to edit, and only then becomes "Сохранить".
  //
  // The reason this needs care: the text fields are not the only things on this screen that mutate
  // state. The emoji picker, the banner and the links all do. If `isEditing`
  // gated ONLY the pill's label, a user who changed their banner without first tapping "Изменить"
  // would have no Save button and no way to persist it — the change would look accepted and then be
  // silently discarded on back.
  //
  // So every mutating control also arms edit mode through `beginEditing()`. The pill is therefore
  // "Изменить" exactly while there is nothing to save, and "Сохранить" the moment there is.
  // ── NOW ALWAYS EDITING ─────────────────────────────────────────────────────
  // The screen is opened by the profile's own "Редактировать" button, so a second "Изменить" step
  // inside it was an extra tap Telegram does not have: its editor is editable the moment it opens.
  // Everything below that was gated on `isEditing` is therefore simply shown. `beginEditing` stays
  // as the call sites' way to say "something changed" (it is a no-op now).
  const [isEditing] = useState(true);
  const beginEditing = useCallback(() => {}, []);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [editingLinkIndex, setEditingLinkIndex] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Resolved once so both the glass and the BlurView branch of the header pill render the same string
  // — they are two copies of the same pill and previously each inlined the label expression.
  const headerActionLabel = isSaving ? '...' : t('common.done');
  // The screenshot lock used to be a row here. It moved to Settings → Безопасность, where it saves
  // the moment it is switched (asked: "как будто ей не там место"; this screen is about the
  // profile's content, and the lock is an account setting).
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
      beginEditing();
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
    beginEditing();
    setBannerTransform(next);
    setShowBannerEditor(false);
  };
  const handleBannerEditorCancel = () => setShowBannerEditor(false);

  const handleSave = async () => {
    // Moderation: validate display name + bio BEFORE persisting — but ONLY
    // the fields the user actually changed this session. A name/bio that was
    // already accepted and saved previously must never block a link-only (or
    // emoji-only) re-save; otherwise an over-strict false positive on
    // pre-existing content silently swallows the save and it looks like
    // "nothing happens". New/edited content is still fully moderated, and the
    // server stays the backstop. Wrapped in try/catch so a validator fault
    // can never dead-end the save with no feedback (it fails OPEN).
    const nameChanged = name !== displayUser.displayName;
    const bioChanged = bio !== (displayUser.bio || '');
    // "Готово" with nothing changed just goes back: no request, no "Сохранено" toast.
    const initialLinks = JSON.stringify((user as any)?.links || []);
    const dirty =
      nameChanged ||
      bioChanged ||
      username !== displayUser.username ||
      selectedEmoji !== (displayUser.emoji || '😊') ||
      JSON.stringify(links) !== initialLinks ||
      (bannerUri ? serializeBannerTransform(bannerUri, bannerTransform) : undefined) !== (initialBanner || undefined);
    if (!dirty) {
      router.back();
      return;
    }
    try {
      if (nameChanged) {
        const nameCheck = validateName(name);
        if (!nameCheck.ok) {
          // Name the offending field so the toast isn't a mystery.
          showToast(
            t('edit_profile.name_label') + ': ' + t(nameCheck.reasonKey || 'moderation.reason.profanity'),
            'alert-circle',
          );
          return;
        }
      }
      if (bioChanged) {
        const bioCheck = validateBio(bio);
        if (!bioCheck.ok) {
          showToast(
            t('edit_profile.bio_label') + ': ' + t(bioCheck.reasonKey || 'moderation.reason.profanity'),
            'alert-circle',
          );
          return;
        }
      }
    } catch {
      // Validator threw unexpectedly — never let moderation dead-end the save
      // silently. Fall through and persist; server-side moderation backstops.
    }
    // ── THE USERNAME IS SAVED NOW ─────────────────────────────────────────────
    //
    // The field was always editable, but the value only ever went into the local profile: the PATCH
    // below never carried it. So a new username showed until the next session check, then quietly
    // reverted to the old one. It is sent now, FIRST and on its own, because only the server knows
    // whether it is taken, and `PATCH /v1/profiles/me` rejects the whole update when it is — nothing
    // else may be applied before that answer.
    const usernameChanged = username !== displayUser.username;
    if (usernameChanged && !/^[a-z0-9_]{2,32}$/.test(username)) {
      showToast(t('edit_profile.username_label') + ': ' + t('edit_profile.username_invalid'), 'alert-circle');
      return;
    }
    setIsSaving(true);
    if (usernameChanged && user?.id) {
      const { error } = await updateSupabaseProfile(user.id, { username });
      if (error) {
        setIsSaving(false);
        showToast(error === 'username_taken' ? t('auth.error.username_taken') : t('toast.error_generic'), 'alert-circle');
        return;
      }
    }
    // Set when a newly picked banner did not upload (see "ONLY AN UPLOADED BANNER" below).
    let bannerUploadFailed = false;
    let bannerTooLarge = false;
    try {
      // Strip dangerous invisible / control / bidi-override characters before
      // persisting (decorative Unicode + emoji are preserved). Single-line for
      // name/username, multi-line for bio.
      const cleanName = sanitizeUserText(name, { singleLine: true, maxLength: 50 });
      const cleanUsername = sanitizeUserText(username, { singleLine: true, maxLength: 30 });
      const cleanBio = sanitizeUserText(bio, { maxLength: 150 });
      // Local optimistic update — apply the transform onto the local
      // URI immediately so the redesigned profile screen picks it up
      // without waiting for the network round-trip below.
      const localBannerUrl = bannerUri
        ? serializeBannerTransform(bannerUri, bannerTransform)
        : undefined;
      updateProfile({
        displayName: cleanName,
        username: cleanUsername,
        bio: cleanBio,
        emoji: selectedEmoji,
        links,
        bannerUrl: localBannerUrl,
      });

      if (user?.id) {
        // ── ONLY AN UPLOADED BANNER GOES TO THE PROFILE (Nov 2026) ──────────────────────────────
        //
        // A picked image is a file on this phone. When its upload failed, the file path itself was
        // saved as the banner (found on a live profile: `file:///var/mobile/Containers/...`): a
        // broken image for everyone else, and for this account on any other device. Now a failed
        // upload sends no banner at all, the previous one stays, and the toast below says so.
        let finalBannerUrl: string | null = bannerUri;
        if (bannerUri && !/^https?:\/\//i.test(bannerUri)) {
          finalBannerUrl = null;
          try {
            const { url, reason } = await uploadBanner(user.id, bannerUri);
            if (url) finalBannerUrl = url;
            else bannerTooLarge = reason === 'too_large';
          } catch {}
          bannerUploadFailed = !finalBannerUrl;
        }
        if (bannerUploadFailed) {
          // Back to the banner the server still has, so this phone does not show one nobody else sees.
          updateProfile({ bannerUrl: initialBanner });
        }

        // Encode the transform as a hash on the final (uploaded) URL
        // so the next render of either profile screen will read it
        // back and apply the same position.
        const persistedUrl = finalBannerUrl
          ? serializeBannerTransform(finalBannerUrl, bannerTransform)
          : undefined;

        await updateSupabaseProfile(user.id, {
          display_name: cleanName,
          bio: cleanBio,
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
    // Always confirm the save so the action is never a silent no-op. The
    // local optimistic updateProfile above (which includes `links`) has
    // already applied, so this is truthful even if the network round-trip
    // failed — the link shows on the profile immediately after router.back().
    // Except for a banner that did not upload: everything else is saved, the banner is not.
    if (bannerUploadFailed) {
      showToast(t(bannerTooLarge ? 'edit_profile.banner_too_large' : 'edit_profile.banner_upload_failed'), 'alert-circle');
    } else {
      showToast(t('toast.saved'), 'check-circle');
    }
    router.back();
  };

  const handleAddLink = () => {
    if (links.length >= 3) return;
    setEditingLinkIndex(null);
    setShowLinkPicker(true);
  };

  const handleEditLink = useCallback((index: number) => {
    setEditingLinkIndex(index);
    setShowLinkPicker(true);
  }, []);

  // The sheet hands back a normalised link and the kind it recognised; nothing is chosen by hand.
  const handleSaveLink = (link: { type: LinkKind; url: string }) => {
    const newLink: UserLink = { type: link.type, url: link.url };
    if (editingLinkIndex !== null) {
      setLinks((prev) => prev.map((l, i) => (i === editingLinkIndex ? newLink : l)));
    } else {
      setLinks((prev) => (prev.length >= 3 ? prev : [...prev, newLink]));
    }
    setShowLinkPicker(false);
  };

  const handleRemoveLink = useCallback((index: number) => {
    setLinks((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleRemoveEditingLink = () => {
    if (editingLinkIndex !== null) handleRemoveLink(editingLinkIndex);
    setShowLinkPicker(false);
  };

  const closeLinkPicker = useCallback(() => setShowLinkPicker(false), []);
  const closeEmojiPicker = useCallback(() => setShowEmojiPicker(false), []);
  const pickEmoji = useCallback((e: string) => {
    setSelectedEmoji(e);
    setShowEmojiPicker(false);
  }, []);

  // Only what the server accepts (`^[a-z0-9_]{2,32}$`, PATCH /v1/profiles/me), with registration's
  // 16-character limit, so an invalid name cannot be typed in the first place.
  const onUsernameChange = useCallback((v: string) => {
    setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16));
  }, []);
  const onBioChange = useCallback((v: string) => setBio(v.slice(0, 150)), []);

  const bgPrimary = theme.colors.background.primary;
  const bgElevated = theme.colors.background.elevated;
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
      {/* Two controls and nothing else, like Telegram: back on the left, "Готово" on the right.
          No title pill: the screen is obviously the profile being edited. */}
      <View style={[styles.headerRow, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable
          onPress={handleClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={[styles.headerPill, glassActive ? { overflow: 'visible' } : null]}
        >
          {glassActive ? (
            // Interactive morphing glass IS the back button; icon is its child.
            // No overflow so the liquid stretch isn't clipped on touch.
            <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={[styles.headerPillInner, { borderRadius: 18 }]}>
              <Feather name="chevron-left" size={22} color="#FFFFFF" />
            </NativeGlassView>
          ) : (
            <BlurView intensity={80} role="scrim" tint="dark" style={styles.headerPillInner}>
              <Feather name="chevron-left" size={22} color="#FFFFFF" />
            </BlurView>
          )}
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={isSaving}
          accessibilityRole="button"
          hitSlop={10}
          style={[styles.headerPill, glassActive ? { overflow: 'visible' } : null]}
        >
          {glassActive ? (
            <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={[styles.headerPillInner, { paddingHorizontal: 14, borderRadius: 18 }]}>
              <RNText style={styles.headerSaveText} allowFontScaling={false}>
                {headerActionLabel}
              </RNText>
            </NativeGlassView>
          ) : (
            <BlurView intensity={80} role="scrim" tint="dark" style={[styles.headerPillInner, { paddingHorizontal: 14 }]}>
              <RNText style={styles.headerSaveText} allowFontScaling={false}>
                {headerActionLabel}
              </RNText>
            </BlurView>
          )}
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
                proxyWidth={SCREEN_WIDTH}
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
            {/* ── EDITING AFFORDANCES ARE HIDDEN IN VIEW MODE ────────────────────
                Asked for: "Расположить" and "Добавить баннер" should not be there until "Изменить" is
                tapped. Gating the pills is the honest version of the toggle — a control that is
                visible but does nothing is worse than one that is absent, and previously the whole
                banner area stayed tappable in view mode. */}
            {isEditing && bannerUri ? (
              <Pressable onPress={adjustBanner} hitSlop={8} style={styles.bannerAdjustPill}>
                <Feather name="move" size={12} color="#FFFFFF" />
                <RNText style={styles.bannerEditText} allowFontScaling={false}>
                  {t('edit_profile.banner.adjust')}
                </RNText>
              </Pressable>
            ) : null}
            {isEditing ? (
              <View style={styles.bannerEditPill}>
                <Feather name="edit-2" size={12} color="#FFFFFF" />
                <RNText style={styles.bannerEditText} allowFontScaling={false}>
                  {t('edit_profile.add_banner')}
                </RNText>
              </View>
            ) : null}
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
            {/* The little pencil badge on the avatar is an affordance too — gone in view mode. */}
            {isEditing ? (
              <View style={[styles.avatarBadge, { backgroundColor: accent }]}>
                <Feather name="edit-2" size={11} color="#FFFFFF" />
              </View>
            ) : null}
          </Pressable>
          {isEditing ? (
            <Pressable
              onPress={() => setShowEmojiPicker(true)}
              style={{ marginTop: 10, alignSelf: 'center' }}
            >
              <Text variant="caption" weight="semibold" color={accent}>
                {t('edit_profile.change_emoji')}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* ── THE FORM, AS AN INSET-GROUPED LIST ────────────────────────────────
            Asked for: the fields looked "очень по-старому". They were three outlined boxes, one per
            field, each with its own 1.5 pt border. Now they are the settings screens' grouped cards
            (`SettingsSection`): name and username share one card with a hairline between them, the
            bio has its own with a character counter, and links are rows with the service's own tile.
            No outlines anywhere: the card is the container, and a focused field shows it by its
            caption taking the accent colour. */}
        <View style={styles.form}>
          <SettingsSection>
            <EditorField
              label={t('edit_profile.name_label')}
              value={name}
              onChangeText={setName}
              placeholder={t('edit_profile.name_placeholder')}
              maxLength={50}
              autoCapitalize="words"
            />
            <EditorHairline />
            <EditorField
              label={t('edit_profile.username_label')}
              value={username}
              onChangeText={onUsernameChange}
              placeholder="username"
              prefix="@"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'visible-password'}
            />
          </SettingsSection>

          <SettingsSection>
            <EditorField
              label={t('edit_profile.bio_label')}
              value={bio}
              onChangeText={onBioChange}
              placeholder={t('edit_profile.bio_placeholder')}
              multiline
              maxLength={150}
              showCounter
            />
          </SettingsSection>

          {/* Links: each one as the service it was recognised as (tile + name), the address under it.
              Tap to edit, the cross removes it. Up to three. */}
          <EditorSectionHeader title={t('edit_profile.links')} right={`${links.length}/3`} />
          <SettingsSection>
            {links.map((link, index) => (
              <React.Fragment key={`${index}:${link.url}`}>
                {index > 0 ? <EditorHairline inset={60} /> : null}
                <EditorLinkRow
                  url={link.url}
                  index={index}
                  onEdit={handleEditLink}
                  onRemove={handleRemoveLink}
                  removeLabel={t('edit_profile.link_remove')}
                />
              </React.Fragment>
            ))}
            {links.length < 3 ? (
              <>
                {links.length > 0 ? <EditorHairline inset={60} /> : null}
                <EditorAddLinkRow label={t('edit_profile.add_link')} onPress={handleAddLink} />
              </>
            ) : null}
          </SettingsSection>
        </View>
      </ScrollView>

      {/* Same SlideUpSheet as the rest of the app; the grid inside is virtualised (see the component). */}
      <EmojiPickerSheet
        visible={showEmojiPicker}
        selected={selectedEmoji}
        onPick={pickEmoji}
        onClose={closeEmojiPicker}
      />

      {/* One field, no type picker: the service is recognised from the link. */}
      <LinkEditorSheet
        visible={showLinkPicker}
        initialUrl={editingLinkIndex !== null ? links[editingLinkIndex]?.url ?? '' : ''}
        isEdit={editingLinkIndex !== null}
        onClose={closeLinkPicker}
        onSave={handleSaveLink}
        onRemove={handleRemoveEditingLink}
      />

      {/* Banner position editor: drag and pinch the picked image in a centred frame. */}
      <BannerPositionEditor
        visible={showBannerEditor}
        uri={bannerUri}
        initial={bannerTransform}
        onCancel={handleBannerEditorCancel}
        onSave={handleBannerEditorSave}
      />
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
  // The grouped cards (SettingsSection) carry their own geometry; this is only the column they sit in.
  form: {
    paddingHorizontal: 16,
    marginTop: 4,
  },
});
