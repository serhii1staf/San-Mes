import React, { useEffect, useState } from 'react';
import { View, TextInput, Pressable, Text as RNText } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SlideUpSheet } from '../ui/SlideUpSheet';
import { Text } from '../ui/Text';
import { EmojiPickerModal } from '../ui/EmojiPickerModal';
import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { triggerHaptic } from '../../utils/haptics';

// ─── EditProfileTabModal ────────────────────────────────────────────────
// Long-press editor for a single own-profile category tab (Posts /
// Replies / Media / Likes). Reuses the same `SlideUpSheet` chrome as the
// rest of the bottom-sheet family (drag handle, dim backdrop, theme-aware
// background) so the look matches PostMenuModal / ProfileMenuModal /
// FollowsListModal exactly.
//
// Layout: emoji button (opens the existing EmojiPickerModal) + label
// TextInput in a single row, with an "Apply" primary action and a
// "Reset" link below. The default i18n label is shown as the input's
// placeholder so the user always sees what would render if they cleared
// the field.
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
  const [pickerOpen, setPickerOpen] = useState(false);

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
    const trimmed = label.trim();
    onApply({ label: trimmed || undefined, emoji: emoji || undefined });
    onClose();
  };

  const handleReset = () => {
    triggerHaptic('light');
    onReset();
    onClose();
  };

  return (
    <>
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
            {/* Emoji prefix slot — taps open the existing EmojiPickerModal.
                Uses the same restrained 12 px corners as the input bar
                next to it so the row reads as a single composed control. */}
            <Pressable
              onPress={() => {
                triggerHaptic('light');
                setPickerOpen(true);
              }}
              accessibilityLabel={t('profile.tab_edit.emoji_button')}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: theme.isDark
                  ? 'rgba(255,255,255,0.06)'
                  : 'rgba(0,0,0,0.04)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {emoji ? (
                <RNText style={{ fontSize: 22 }} allowFontScaling={false}>
                  {emoji}
                </RNText>
              ) : (
                <Feather
                  name="smile"
                  size={18}
                  color={theme.colors.text.tertiary}
                />
              )}
            </Pressable>

            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder={defaultLabel}
              placeholderTextColor={theme.colors.text.tertiary}
              maxLength={24}
              style={{
                flex: 1,
                height: 44,
                borderRadius: 12,
                paddingHorizontal: 12,
                backgroundColor: theme.isDark
                  ? 'rgba(255,255,255,0.06)'
                  : 'rgba(0,0,0,0.04)',
                color: theme.colors.text.primary,
                fontSize: 15,
              }}
            />
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 16,
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

      {/* Emoji picker is rendered as a sibling Modal so it stacks above the
          slide-up sheet cleanly. Keeping it OUTSIDE the SlideUpSheet
          children avoids the iOS quirk where a Modal-inside-Modal swallows
          the backdrop tap on dismiss. */}
      <EmojiPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(e) => {
          setEmoji(e);
        }}
      />
    </>
  );
}
