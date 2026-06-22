import React, { useEffect, useRef } from 'react';
import {
  View,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  AccessibilityInfo,
  findNodeHandle,
  InteractionManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ModalStatusBar } from '../ui/ModalStatusBar';
import { Text } from '../ui/Text';
import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { showToast } from '../../store/toastStore';
import { openLegalLink } from './openLegalLink';

// Module-level HTTPS literals for the legal pages. These are HTTPS-only by
// contract (see openLegalLink / ATS compliance) and never change at runtime.
const TERMS_URL = 'https://legal.san-m-app.com/terms.html';
const PRIVACY_URL = 'https://legal.san-m-app.com/privacy.html';

export interface MiniAppConsentDialogProps {
  /** Controls modal visibility. */
  visible: boolean;
  /** Call context — affects only the title/accept-button label (publish vs edit). */
  mode: 'publish' | 'edit';
  /** User accepted the content policy (Accept_Control). */
  onAccept: () => void;
  /** User declined the content policy (Decline_Control) or dismissed the dialog. */
  onDecline: () => void;
}

/**
 * Consent_Dialog — модальное окно согласия с правилами публикации контента
 * мини-приложений. Презентационный компонент: рендерит правила строго из
 * i18n-ключей `mini_apps.consent.*`, две HTTPS-ссылки (Terms/Privacy) и
 * кнопки Accept/Decline. Бизнес-логики отправки не содержит — только UI и
 * колбэки.
 *
 * Закрытие по фону / `onRequestClose` трактуется как Decline (безопасный
 * исход — без отправки данных в worker).
 */
export function MiniAppConsentDialog({ visible, mode, onAccept, onDecline }: MiniAppConsentDialogProps) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();

  const acceptLabel = mode === 'edit' ? t('mini_apps.consent.accept_edit') : t('mini_apps.consent.accept');

  // Built-in fallback a11y labels (Req 6.6): if an i18n value resolves to an
  // empty string, fall back to a sensible constant so the control is never
  // label-less and remains activatable by the Screen_Reader.
  const acceptA11y =
    t('mini_apps.consent.accept_a11y') || (mode === 'edit' ? 'Agree and save' : 'Agree and publish');
  const declineA11y = t('mini_apps.consent.decline_a11y') || 'Decline and cancel';
  const termsA11y = t('mini_apps.consent.terms_link_a11y') || 'Open Terms of Use';
  const privacyA11y = t('mini_apps.consent.privacy_link_a11y') || 'Open Privacy Policy';
  const titleText = t('mini_apps.consent.title');

  // On open, move Screen_Reader focus to the dialog title (Req 6.3). The View
  // wrapping the title carries the ref + header role; we resolve its native
  // node handle and request accessibility focus after interactions/animations
  // settle for reliability.
  const titleRef = useRef<View>(null);
  useEffect(() => {
    if (!visible) return;
    const task = InteractionManager.runAfterInteractions(() => {
      const node = titleRef.current ? findNodeHandle(titleRef.current) : null;
      if (node != null) {
        AccessibilityInfo.setAccessibilityFocus(node);
      }
    });
    return () => task.cancel();
  }, [visible]);

  // Surfaces the link-open failure to the user via the shared toast WITHOUT
  // closing the dialog or touching consent state (onAccept/onDecline are not
  // called), so the Consent_Dialog stays open and the choice is preserved.
  // (Req 3.7 / 9.7)
  const handleLinkError = () => {
    showToast(t('mini_apps.consent.link_error'), 'alert-circle');
  };

  const cardBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';
  const linkColor = theme.colors.accent.primary;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDecline}
      statusBarTranslucent
    >
      <ModalStatusBar />
      <View style={styles.backdrop}>
        {/* Backdrop tap → Decline (safe outcome, no submission). */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onDecline} />

        <View
          accessibilityViewIsModal
          style={[
            styles.card,
            {
              backgroundColor: cardBg,
              marginBottom: insets.bottom,
            },
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View
              ref={titleRef}
              accessible
              accessibilityRole="header"
              accessibilityLabel={titleText}
            >
              <Text variant="heading" weight="bold" style={styles.title}>
                {titleText}
              </Text>
            </View>

            <Text variant="body" color={theme.colors.text.secondary} style={styles.intro}>
              {t('mini_apps.consent.intro')}
            </Text>

            <Text variant="subheading" weight="semibold" style={styles.sectionHeading}>
              {t('mini_apps.consent.prohibited_heading')}
            </Text>

            <Text variant="body" color={theme.colors.text.secondary} style={styles.paragraph}>
              {t('mini_apps.consent.prohibited_body')}
            </Text>

            <Text variant="body" color={theme.colors.text.secondary} style={styles.paragraph}>
              {t('mini_apps.consent.stores')}
            </Text>

            <Text variant="body" color={theme.colors.text.secondary} style={styles.paragraph}>
              {t('mini_apps.consent.san_policies')}
            </Text>

            {/* Legal links — open strictly over HTTPS via openLegalLink; on
                failure handleLinkError surfaces a toast and keeps the dialog
                open without changing consent state (Req 3.6, 3.7). Non-empty
                a11y labels with built-in fallbacks (Req 6.4, 6.6). */}
            <View style={styles.links}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={termsA11y}
                onPress={() => openLegalLink(TERMS_URL, handleLinkError)}
              >
                <Text variant="body" weight="medium" color={linkColor} style={styles.link}>
                  {t('mini_apps.consent.terms_link')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={privacyA11y}
                onPress={() => openLegalLink(PRIVACY_URL, handleLinkError)}
              >
                <Text variant="body" weight="medium" color={linkColor} style={styles.link}>
                  {t('mini_apps.consent.privacy_link')}
                </Text>
              </Pressable>
            </View>
          </ScrollView>

          {/* Accept / Decline — visually distinct (accent vs secondary), with
              button role and non-empty a11y labels (Req 6.1, 6.2, 6.6). */}
          <View style={styles.actions}>
            <Pressable
              onPress={onAccept}
              accessibilityRole="button"
              accessibilityLabel={acceptA11y}
              style={[styles.button, { backgroundColor: theme.colors.accent.primary }]}
            >
              <Text variant="body" weight="semibold" color="#FFFFFF">
                {acceptLabel}
              </Text>
            </Pressable>
            <Pressable
              onPress={onDecline}
              accessibilityRole="button"
              accessibilityLabel={declineA11y}
              style={[
                styles.button,
                styles.secondaryButton,
                { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' },
              ]}
            >
              <Text variant="body" weight="semibold" color={theme.colors.text.primary}>
                {t('mini_apps.consent.decline')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    borderRadius: 24,
    maxHeight: '82%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 8,
  },
  title: {
    marginBottom: 10,
  },
  intro: {
    marginBottom: 18,
  },
  sectionHeading: {
    marginBottom: 8,
  },
  paragraph: {
    marginBottom: 12,
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
    marginTop: 4,
    marginBottom: 4,
  },
  link: {
    textDecorationLine: 'underline',
  },
  actions: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 18,
    gap: 10,
  },
  button: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {},
});
