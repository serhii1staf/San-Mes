import React, { useEffect, useState } from 'react';
import { View, TextInput, Pressable, Text as RNText, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SlideUpSheet } from '../ui/SlideUpSheet';
import { Text } from '../ui/Text';
import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { triggerHaptic } from '../../utils/haptics';
import { sanitizeUserText } from '../../utils/sanitizeText';

// ─── EditProfileTabModal ────────────────────────────────────────────────
// Long-press editor for a single own-profile category tab (Posts /
// Replies / Media / Likes). Reuses the same `SlideUpSheet` chrome as the
// rest of the bottom-sheet family.
//
// IMPORTANT: this modal must NOT host another <Modal> (e.g. the full
// EmojiPickerModal) inside its sheet. SlideUpSheet itself is a real RN
// `<Modal>`, and Modal-on-Modal on Android renders the inner Modal
// BEHIND the outer one — the user sees no picker, and on dismiss the
// stacked Modal teardown leaves the app in a soft-frozen state where
// the profile screen stops responding to taps. To stay safe we use an
// inline horizontal scroll of preset emojis right inside the sheet:
// no modal nesting, no freeze, and the picker is one tap away. A
// "no emoji" affordance + a "clear" action both stay reachable.

const EMOJI_PRESETS = [
  '✨', '🔥', '💬', '📝', '📷', '🎵', '🎬', '⭐',
  '❤️', '👀', '🌿', '🌙', '☀️', '⚡', '💎', '🍿',
  '🎮', '🧠', '🚀', '🌊', '🌸', '🍀', '🎨', '📚',
];

interface EditProfileTabModalProps {
  visible: boolean;
  onClose: () => void;
  // i18n default label shown as the input placeholder.
  defaultLabel: string;
  // Current customization (if any) to seed the form with on open.
  initialLabel?: string;
  initialEmoji?: string;
  // Apply normalised values. Empty/whitespace-only label is treated as
  // "no label override" and routed through to the store as undefined.
  onApply: (value: { label?: string; emoji?: string }) => void;
  // Reset = clear customization for this tab. Closes the sheet too.
  onReset: () => void;
}

export function EditProfileTabModal({
  visible,
  onClose,
  defaultLabel,
  initialLabel,
  initialEmoji,
  onApply,
  onReset,
}: EditProfileTabModalProps) {
  const theme = useTheme();
  const t = useT();
  const [label, setLabel] = useState(initialLabel || '');
  const [emoji, setEmoji] = useState<string | undefined>(initialEmoji);

  // Re-seed the form whenever we open against a different tab. Reading the
  // initial values from props each open keeps the modal stateless across
  // invocations — the parent owns "which tab am I editing".
  useEffect(() => {
    if (visible) {
      setLabel(initialLabel || '');
      setEmoji(initialEmoji);
    }
  }, [visible, initialLabel, initialEmoji]);

  const handleApply = () => {
    triggerHaptic('light');
    const trimmed = sanitizeUserText(label, { singleLine: true, maxLength: 16 });
    onApply({ label: trimmed || undefined, emoji: emoji || undefined });
    onClose();
  };

  const handleReset = () => {
    triggerHaptic('light');
    onReset();
    onClose();
  };

  const slotBg = theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const slotActiveBg = theme.colors.accent.primary + '24';

  return (
    <SlideUpSheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 6 }}>
        <Text variant="body" weight="semibold" align="center">
          {t('profile.tab_edit.title')}
        </Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            marginTop: 14,
          }}
        >
          {/* Current emoji preview slot — tap to clear (mirror of the
              "remove" affordance some users expect). When empty, shows a
              hint icon so the slot is still discoverable. */}
          <Pressable
            onPress={() => {
              if (emoji) {
                triggerHaptic('light');
                setEmoji(undefined);
              }
            }}
            accessibilityLabel={t('profile.tab_edit.emoji_button')}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: slotBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {emoji ? (
              <RNText style={{ fontSize: 22 }} allowFontScaling={false}>
                {emoji}
              </RNText>
            ) : (
              <Feather name="smile" size={18} color={theme.colors.text.tertiary} />
            )}
          </Pressable>

          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder={defaultLabel}
            placeholderTextColor={theme.colors.text.tertiary}
            maxLength={16}
            style={{
              flex: 1,
              height: 44,
              borderRadius: 12,
              paddingHorizontal: 12,
              backgroundColor: slotBg,
              color: theme.colors.text.primary,
              fontSize: 15,
            }}
          />
        </View>

        {/* Inline emoji picker. Horizontal scroll keeps the sheet compact
            on small screens and avoids any nested-Modal crash on Android.
            Tap an emoji to set it; the slot above mirrors the choice
            instantly. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 12, paddingHorizontal: 2 }}
        >
          {EMOJI_PRESETS.map((e) => {
            const active = e === emoji;
            return (
              <Pressable
                key={e}
                onPress={() => {
                  triggerHaptic('selection');
                  setEmoji(e);
                }}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? slotActiveBg : slotBg,
                  borderWidth: active ? 1 : 0,
                  borderColor: theme.colors.accent.primary,
                }}
              >
                <RNText style={{ fontSize: 20 }} allowFontScaling={false}>
                  {e}
                </RNText>
              </Pressable>
            );
          })}
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 6,
          }}
        >
          <Pressable onPress={handleReset} hitSlop={8}>
            <Text variant="caption" color={theme.colors.text.tertiary}>
              {t('profile.tab_edit.reset')}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleApply}
            style={{
              paddingVertical: 9,
              paddingHorizontal: 18,
              borderRadius: 14,
              backgroundColor: theme.colors.accent.primary,
            }}
          >
            <Text variant="caption" weight="semibold" color="#FFFFFF">
              {t('profile.tab_edit.apply')}
            </Text>
          </Pressable>
        </View>
      </View>
    </SlideUpSheet>
  );
}
