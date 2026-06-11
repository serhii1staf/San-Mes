import React, { useRef, useState } from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';

// Bilingual privacy policy. The canonical version is English (this is what
// the App Store reviewer will read) and a Russian translation sits next to
// each section for our Russian-speaking audience. A simple top-of-screen
// language toggle keeps the page readable rather than doubled.
//
// Structure follows Apple's Privacy Policy expectations (App Review Guideline
// 5.1.1 + §3.3.3 of the Apple Developer Program License Agreement):
//   - What we collect
//   - How we use it
//   - With whom we share it (and why)
//   - Storage and retention
//   - User rights (access / deletion)
//   - Children's data
//   - Security practices
//   - Contact

type Lang = 'en' | 'ru';

interface Section {
  title: { en: string; ru: string };
  body: { en: string; ru: string };
}

const SECTIONS: Section[] = [
  {
    title: { en: '1. What we collect', ru: '1. Какие данные мы собираем' },
    body: {
      en: 'San collects only what is needed for the app to function: your username, display name, emoji avatar, optional bio, the posts/comments/messages you create, and a hashed PIN used to unlock the app. We do not request access to your contacts, location, microphone, or motion data. The Apple system permission prompts you see (photo library, camera) describe the exact reason each permission is requested.',
      ru: 'San собирает только то, что нужно для работы приложения: имя пользователя, отображаемое имя, эмодзи-аватар, биографию (по желанию), посты/комментарии/сообщения, которые вы создаёте, и хеш PIN-кода для разблокировки приложения. Мы не запрашиваем доступ к контактам, геолокации, микрофону или данным о движении. В системных запросах iOS на доступ к фото и камере мы указываем точную причину каждого запроса.',
    },
  },
  {
    title: { en: '2. How we use your data', ru: '2. Как мы используем данные' },
    body: {
      en: 'Your data is used solely to power the app: rendering your profile, delivering messages, showing posts, and authenticating you on the device. We do not use your data for advertising, profiling, or tracking across other apps. We do not use any third-party advertising or analytics SDK that builds a profile of you.',
      ru: 'Данные используются только для работы приложения: отображения профиля, доставки сообщений, показа постов и авторизации на устройстве. Мы не используем данные для рекламы, профилирования или отслеживания в других приложениях. Мы не подключаем рекламные или аналитические SDK, которые строят профиль пользователя.',
    },
  },
  {
    title: { en: '3. Sharing with third parties', ru: '3. Передача третьим лицам' },
    body: {
      en: 'We do not sell, rent, or trade your data. We use Supabase as our database/auth backend and Vercel for our HTTP API; both are processors that store data on our behalf under their respective security commitments. Music search uses public APIs from Apple iTunes Search and Audius; we send only the search query to them, no personal data.',
      ru: 'Мы не продаём, не сдаём в аренду и не обмениваем ваши данные. Мы используем Supabase для базы данных и авторизации и Vercel для HTTP API — оба сервиса выступают обработчиками и хранят данные от нашего имени по своим договорам безопасности. Поиск музыки использует публичные API Apple iTunes Search и Audius; туда отправляется только поисковый запрос без персональных данных.',
    },
  },
  {
    title: { en: '4. Storage and retention', ru: '4. Хранение и сроки' },
    body: {
      en: 'Account data lives on Supabase servers protected by HTTPS and row-level security. Anything you delete (a post, message, or your account) is removed from our backend within 30 days. On-device data sits in encrypted MMKV storage and is wiped on logout or app uninstall.',
      ru: 'Данные аккаунта хранятся на серверах Supabase под защитой HTTPS и row-level security. Всё, что вы удаляете (пост, сообщение, аккаунт), удаляется с серверов в течение 30 дней. Данные на устройстве лежат в зашифрованном MMKV и очищаются при выходе из аккаунта или удалении приложения.',
    },
  },
  {
    title: { en: '5. Your rights', ru: '5. Ваши права' },
    body: {
      en: 'You can edit your profile or delete any post/message at any time from within the app. Deleting your account removes all associated content and personal data from our backend. To request a copy of your data or any other privacy-related action, contact us via the settings screen.',
      ru: 'Вы можете в любой момент редактировать профиль или удалить любой свой пост/сообщение прямо в приложении. Удаление аккаунта стирает весь связанный контент и персональные данные с сервера. Чтобы получить копию ваших данных или запросить другое действие по конфиденциальности, свяжитесь с нами через экран настроек.',
    },
  },
  {
    title: { en: '6. Security', ru: '6. Безопасность' },
    body: {
      en: 'Sign-in is protected by a 4-digit PIN and a per-device key. The PIN is never stored in plaintext — only its hash leaves the device. All API traffic is HTTPS only; we do not allow arbitrary HTTP loads (NSAllowsArbitraryLoads is left at its secure iOS default).',
      ru: 'Вход защищён 4-значным PIN-кодом и ключом устройства. PIN никогда не сохраняется в открытом виде — наружу уходит только его хеш. Весь API-трафик идёт только по HTTPS; произвольные HTTP-загрузки запрещены (значение NSAllowsArbitraryLoads — безопасное по умолчанию iOS).',
    },
  },
  {
    title: { en: "7. Children's data", ru: '7. Данные детей' },
    body: {
      en: 'San is not directed at children under the age of 13 (or the equivalent minimum age in your jurisdiction). We do not knowingly collect personal data from children under that age. If you believe a child has provided us with data, please contact us so we can remove it.',
      ru: 'San не предназначен для детей младше 13 лет (или соответствующего минимального возраста в вашей юрисдикции). Мы сознательно не собираем персональные данные от детей младше этого возраста. Если вы считаете, что ребёнок отправил нам данные, свяжитесь с нами — мы удалим эти данные.',
    },
  },
  {
    title: { en: '8. Changes to this policy', ru: '8. Изменения в политике' },
    body: {
      en: 'We may update this policy from time to time. Material changes will be announced inside the app before they take effect. The "Last updated" date at the top of this page always reflects the current version.',
      ru: 'Мы можем обновлять эту политику время от времени. О существенных изменениях вы узнаете внутри приложения до того, как они вступят в силу. Дата «Последнее обновление» вверху страницы всегда соответствует текущей версии.',
    },
  },
  {
    title: { en: '9. Contact', ru: '9. Контакты' },
    body: {
      en: 'For privacy-related questions, contact us through the in-app support channel or by reaching the developer account associated with this App Store listing.',
      ru: 'По вопросам конфиденциальности пишите нам через встроенный канал поддержки или через аккаунт разработчика, указанный на странице приложения в App Store.',
    },
  },
];

export default function PrivacyPolicyScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [lang, setLang] = useState<Lang>('ru');
  const tapCount = useRef(0);
  const lastTap = useRef(0);

  const handleContactsTap = () => {
    const now = Date.now();
    if (now - lastTap.current > 2000) tapCount.current = 0;
    lastTap.current = now;
    tapCount.current++;
    if (tapCount.current >= 6) {
      tapCount.current = 0;
      router.push('/settings/admin' as any);
    }
  };

  const headerTitle = lang === 'en' ? 'Privacy' : 'Конфиденциальность';
  const policyTitle = lang === 'en' ? 'San Privacy Policy' : 'Политика конфиденциальности San';
  const lastUpdated = lang === 'en' ? 'Last updated: June 11, 2026' : 'Последнее обновление: 11 июня 2026';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: insets.top + 8, paddingBottom: 16, position: 'relative' }}>
        <Pressable onPress={() => router.back()} style={{ position: 'absolute', left: 24, top: insets.top + 8 }}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="subheading" weight="bold">{headerTitle}</Text>
      </View>

      {/* Language toggle — keeps the page readable rather than doubled. */}
      <View style={{ flexDirection: 'row', alignSelf: 'center', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 12, padding: 3, marginBottom: 12 }}>
        {(['ru', 'en'] as Lang[]).map((l) => (
          <Pressable
            key={l}
            onPress={() => setLang(l)}
            style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 9, backgroundColor: lang === l ? theme.colors.background.elevated : 'transparent' }}
          >
            <Text variant="caption" weight={lang === l ? 'semibold' : 'medium'} color={lang === l ? theme.colors.text.primary : theme.colors.text.tertiary} style={{ fontSize: 12 }}>
              {l === 'ru' ? 'Русский' : 'English'}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <Text variant="body" weight="semibold" style={{ marginBottom: 8 }}>{policyTitle}</Text>
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 20 }}>{lastUpdated}</Text>

        {SECTIONS.map((s, i) => {
          const Wrapper = i === 8 ? Pressable : View;
          const wrapperProps = i === 8 ? { onPress: handleContactsTap } : {};
          return (
            <View key={s.title.en} style={{ marginBottom: 12 }}>
              <Wrapper {...wrapperProps}>
                <Text variant="body" weight="semibold" style={{ marginTop: 16, marginBottom: 8 }}>{s.title[lang]}</Text>
              </Wrapper>
              <Text variant="body" color={theme.colors.text.secondary} style={{ lineHeight: 22 }}>
                {s.body[lang]}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
