import React, { useEffect, useMemo, useRef } from 'react';
import { View, Pressable, Modal, ScrollView, Animated, Dimensions, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { useT } from '../../i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface FormatHelpModalProps {
  visible: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
  onToggleSpoilerPhoto: () => void;
  hasPhotos: boolean;
}

export function FormatHelpModal({ visible, onClose, onInsert, onToggleSpoilerPhoto, hasPhotos }: FormatHelpModalProps) {
  const theme = useTheme();
  const t = useT();
  // Build the option list inside the component so labels follow the active locale.
  const FORMAT_OPTIONS = useMemo(() => {
    const txt = t('format_help.syntax.text');
    const usr = t('format_help.syntax.username');
    const code = t('format_help.syntax.code');
    const tag = t('format_help.syntax.tag');
    return [
      { key: 'mention', label: t('format_help.mention.label'), syntax: `@${usr}`, description: t('format_help.mention.desc'), icon: 'at-sign' },
      { key: 'bold', label: t('format_help.bold.label'), syntax: `**${txt}**`, description: t('format_help.bold.desc'), icon: 'bold' },
      { key: 'italic', label: t('format_help.italic.label'), syntax: `*${txt}*`, description: t('format_help.italic.desc'), icon: 'italic' },
      { key: 'spoiler', label: t('format_help.spoiler.label'), syntax: `||${txt}||`, description: t('format_help.spoiler.desc'), icon: 'eye-off' },
      { key: 'code', label: t('format_help.code.label'), syntax: `\`${code}\``, description: t('format_help.code.desc'), icon: 'code' },
      { key: 'strike', label: t('format_help.strike.label'), syntax: `~~${txt}~~`, description: t('format_help.strike.desc'), icon: 'minus' },
      { key: 'underline', label: t('format_help.underline.label'), syntax: `__${txt}__`, description: t('format_help.underline.desc'), icon: 'underline' },
      { key: 'hashtag', label: t('format_help.hashtag.label'), syntax: `#${tag}`, description: t('format_help.hashtag.desc'), icon: 'hash' },
      { key: 'spoiler_photo', label: t('format_help.spoiler_photo.label'), syntax: '', description: t('format_help.spoiler_photo.desc'), icon: 'image' },
    ];
  }, [t]);
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(onClose, 30);
    });
  };

  const handleOption = (opt: typeof FORMAT_OPTIONS[0]) => {
    if (opt.key === 'spoiler_photo') {
      if (!hasPhotos) {
        Alert.alert(t('format_help.no_photo_title'), t('format_help.no_photo_msg'));
        dismiss();
        return;
      }
      onToggleSpoilerPhoto();
      dismiss();
    } else {
      onInsert(opt.syntax);
      dismiss();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim }}>
          <Pressable style={{ flex: 1 }} onPress={dismiss} />
        </Animated.View>
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY: slideAnim }] }}>
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
              {/* Handle */}
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
              </View>
              <Text variant="body" weight="bold" align="center" style={{ marginBottom: 12 }}>{t('format_help.title')}</Text>

              <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
                {FORMAT_OPTIONS.map((opt, i) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => handleOption(opt)}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: i < FORMAT_OPTIONS.length - 1 ? 0.5 : 0, borderBottomColor: theme.colors.border.light }}
                  >
                    <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.colors.accent.primary + '15', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                      <Feather name={opt.icon as any} size={16} color={theme.colors.accent.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="body" weight="medium">{opt.label}</Text>
                      <Text variant="caption" color={theme.colors.text.tertiary}>{opt.description}</Text>
                    </View>
                    {opt.syntax ? <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontFamily: 'Courier', fontSize: 11 }}>{opt.syntax}</Text> : null}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}
