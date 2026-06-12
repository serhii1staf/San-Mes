import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Pressable, TextInput, FlatList, ActivityIndicator, Dimensions, Text as RNText, Platform, LayoutAnimation, UIManager, InteractionManager } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { FormattedText } from '../../src/components/ui/FormattedText';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { useThemeStore, ACCENT_COLORS } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store';
import { sendMessage, parseActions, applyAction, AIMessage, ParsedAction, getRemainingRequests, saveChatHistory, loadChatHistory } from '../../src/services/aiService';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';

const SCREEN_WIDTH = Dimensions.get('window').width;

// Enable LayoutAnimation on Android (no-op on iOS).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function MiniThemeCard({ themeKey }: { themeKey: string }) {
  const user = useAuthStore((s) => s.user);
  const t = useT();
  const allThemes = [...ACCENT_COLORS, ...useThemeStore((s) => s.aiThemes)];
  const themeOpt = allThemes.find(c => c.key === themeKey);
  if (!themeOpt) return null;
  return (
    <View style={{ width: SCREEN_WIDTH * 0.55, borderRadius: 16, overflow: 'hidden', backgroundColor: themeOpt.darkBg, borderWidth: 2, borderColor: themeOpt.color, marginTop: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFFFFF' }}>San</Text>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: themeOpt.color }} />
      </View>
      <View style={{ marginHorizontal: 8, marginVertical: 4, backgroundColor: themeOpt.darkElevated, borderRadius: 12, padding: 8, borderWidth: 0.5, borderColor: themeOpt.darkBorder }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: themeOpt.color + '20', alignItems: 'center', justifyContent: 'center' }}>
            <RNText style={{ fontSize: 9 }} allowFontScaling={false}>{user?.emoji || '😊'}</RNText>
          </View>
          <Text style={{ fontSize: 8, fontWeight: '600', color: '#FFFFFF', marginLeft: 6, flexShrink: 1 }} numberOfLines={1}>{user?.displayName || t('ai_chat.user_fallback')}</Text>
        </View>
        <View style={{ height: 6, width: '80%', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 3 }} />
        <View style={{ height: 6, width: '50%', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.05)' }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 6, borderTopWidth: 0.5, borderTopColor: themeOpt.darkBorder }}>
        <Feather name="home" size={10} color={themeOpt.color} />
        <Feather name="search" size={10} color="rgba(255,255,255,0.4)" />
        <Feather name="plus-square" size={10} color="rgba(255,255,255,0.4)" />
        <Feather name="message-circle" size={10} color="rgba(255,255,255,0.4)" />
        <Feather name="user" size={10} color="rgba(255,255,255,0.4)" />
      </View>
      <View style={{ alignItems: 'center', paddingVertical: 4, backgroundColor: themeOpt.color + '15' }}>
        <Text style={{ fontSize: 9, fontWeight: '600', color: themeOpt.color }}>{themeOpt.label}</Text>
      </View>
    </View>
  );
}

function ActionBubble({ action }: { action: ParsedAction }) {
  const theme = useTheme();
  const t = useT();
  const labels: Record<string, string> = { theme: t('ai_chat.label.theme'), custom_theme: t('ai_chat.label.custom_theme'), mode: t('ai_chat.label.mode'), name: t('ai_chat.label.name'), emoji: t('ai_chat.label.emoji'), username: t('ai_chat.label.username'), bio: t('ai_chat.label.bio'), font: t('ai_chat.label.font') };
  const displayValue = action.type === 'custom_theme' ? action.value.split(':')[0] : action.value;
  const themeKey = action.type === 'theme' ? action.value : (action.type === 'custom_theme' ? 'ai-' + action.value.split(':')[0].toLowerCase().replace(/[^a-z0-9]/g, '-') : null);
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: action.applied ? theme.colors.accent.primary + '15' : 'rgba(255,59,48,0.1)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginTop: 4, alignSelf: 'flex-start' }}>
        <Text variant="caption" color={action.applied ? theme.colors.accent.primary : '#FF3B30'} style={{ fontSize: 11 }}>{labels[action.type] || action.type}: {displayValue}</Text>
        {action.applied ? <Feather name="check-circle" size={12} color={theme.colors.accent.primary} /> : <Feather name="x-circle" size={12} color="#FF3B30" />}
      </View>
      {themeKey && action.applied && <MiniThemeCard themeKey={themeKey} />}
    </View>
  );
}

function MessageBubble({ message }: { message: AIMessage }) {
  const theme = useTheme();
  const isUser = message.role === 'user';
  // Deduplicate actions of same type (show only last)
  const uniqueActions = message.actions ? message.actions.filter((a, i, arr) => arr.findIndex(x => x.type === a.type) === i) : undefined;
  return (
    <View style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: 12 }}>
      {!isUser && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          <RNText style={{ fontSize: 14 }} allowFontScaling={false}>🤖</RNText>
          <Text variant="caption" weight="semibold" style={{ fontSize: 11 }}>San AI</Text>
          <VerifiedBadge size={10} />
        </View>
      )}
      <View style={{ backgroundColor: isUser ? theme.colors.accent.primary : (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'), borderRadius: 20, borderBottomRightRadius: isUser ? 6 : 20, borderBottomLeftRadius: isUser ? 20 : 6, paddingHorizontal: 14, paddingVertical: 10 }}>
        <FormattedText color={isUser ? '#FFFFFF' : theme.colors.text.primary} linkColor={isUser ? '#FFFFFF' : theme.colors.accent.primary} style={{ fontSize: 14, lineHeight: 20 }}>{message.content}</FormattedText>
      </View>
      {uniqueActions?.map((action, i) => <ActionBubble key={i} action={action} />)}
    </View>
  );
}

const MemoMessageBubble = React.memo(MessageBubble, (prev, next) => prev.message.id === next.message.id && prev.message.content === next.message.content);

export default function AIChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Mount-time marker — surfaces in the perf-monitor panel so the user can
  // tell at a glance whether opening the AI chat froze on the JS thread
  // (large initial render) or on the navigation transition itself.
  const mountStart = useRef(Date.now()).current;
  useEffect(() => {
    perfMonitor.markScreenMount('chat/ai', Date.now() - mountStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  // Inverted list: the visual bottom spacer is the ListHeaderComponent.
  // Grow it with the keyboard so newest messages stay above the input bar.
  const INPUT_BAR = 60;
  const headerSpacerStyle = useAnimatedStyle(() => ({
    height: Math.abs(keyboardHeight.value) + INPUT_BAR + insets.bottom,
  }));

  // Bottom padding under the input: safe-area when keyboard closed → small gap when open.
  const inputPadStyle = useAnimatedStyle(() => {
    const open = Math.abs(keyboardHeight.value) > 1;
    return { paddingBottom: open ? 8 : (insets.bottom > 0 ? insets.bottom : 16) };
  });
  const [remaining, setRemaining] = useState(50);
  const flatListRef = useRef<FlatList>(null);

  // Defer the iOS BlurView in the back button (and the "thinking" indicator)
  // past the navigation transition. UIVisualEffectView is one of the more
  // expensive native views to construct on first mount; on weak devices that
  // mount lands on the same RAF as the navigation animation and shaved the
  // slide-in framerate from 60 → ~40. Show a flat fallback for the first
  // frame and swap to the BlurView one interaction tick later.
  const [chromeReady, setChromeReady] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setChromeReady(true));
    return () => handle.cancel();
  }, []);

  useEffect(() => {
    // Defer all the cold-start side-effects (chat history hydrate, remaining
    // requests fetch, special-chats `markOpened`) past the navigation
    // transition so they never compete with the slide-in animation.
    const handle = InteractionManager.runAfterInteractions(() => {
      loadChatHistory().then(saved => { if (saved.length > 0) setMessages(saved); });
      getRemainingRequests().then(setRemaining);
      try { require('../../src/store/specialChatsStore').useSpecialChatsStore.getState().markOpened('ai'); } catch {}
    });
    return () => handle.cancel();
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    triggerHaptic('light');
    setInput('');

    const userMsg: AIMessage = { id: Date.now().toString(), role: 'user', content: text, timestamp: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    saveChatHistory(newMessages);

    setIsLoading(true);
    try {
      const recentMessages = newMessages.slice(-8).map(m => ({ role: m.role, content: m.content }));
      const response = await sendMessage(recentMessages);
      const { cleanText, actions } = parseActions(response);

      // Deduplicate actions of same type (keep last)
      const deduped = actions.reduce((acc, a) => { acc.set(a.type, a); return acc; }, new Map<string, ParsedAction>());
      const uniqueActions = Array.from(deduped.values());

      const appliedActions: ParsedAction[] = [];
      for (const action of uniqueActions) {
        const success = await applyAction(action);
        appliedActions.push({ ...action, applied: success });
        if (success) triggerHaptic('medium');
      }

      const aiMsg: AIMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: cleanText || (appliedActions.length > 0 ? t('ai_chat.done') : ''), actions: appliedActions.length > 0 ? appliedActions : undefined, timestamp: Date.now() };
      const finalMessages = [...newMessages, aiMsg];
      setMessages(finalMessages);
      saveChatHistory(finalMessages);
      getRemainingRequests().then(setRemaining);
    } catch {
      const errMsg: AIMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: t('ai_chat.error_connection'), timestamp: Date.now() };
      setMessages(prev => [...prev, errMsg]);
    }
    setIsLoading(false);
  }, [input, isLoading, messages, t]);

  // Inverted data for FlatList — memoized to avoid re-reverse on every keystroke
  const invertedData = React.useMemo(() => [...messages].reverse(), [messages]);

  const renderItem = useCallback(({ item }: { item: AIMessage }) => <MemoMessageBubble message={item} />, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 }}>
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.7, 1]} style={{ paddingTop: insets.top + 8, paddingBottom: 20, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} style={{ borderRadius: 17, overflow: 'hidden' }}>
              {chromeReady ? (
                <BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="chevron-left" size={18} color="#FFFFFF" />
                </BlurView>
              ) : (
                <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
                  <Feather name="chevron-left" size={18} color="#FFFFFF" />
                </View>
              )}
            </Pressable>
            <View style={{ alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text variant="body" weight="bold">{t('ai_chat.title')}</Text>
                <VerifiedBadge size={13} />
              </View>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10 }}>{remaining}/50</Text>
            </View>
            <View style={{ width: 34 }} />
          </View>
        </LinearGradient>
      </View>

      {/* Inverted FlatList — newest at bottom, no scroll needed */}
      <FlatList
        ref={flatListRef}
        data={invertedData}
        keyExtractor={item => item.id}
        inverted
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustsScrollIndicatorInsets={false}
        removeClippedSubviews={false}
        // Tightened from 12/8/9 — same fix as chat/music. 12 MessageBubbles
        // on first paint piled up on the navigation transition frame.
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={5}
        ListHeaderComponent={
          <>
            {isLoading ? (
              <View style={{ paddingBottom: 8 }}>
                <View style={{ borderRadius: 14, overflow: 'hidden', alignSelf: 'flex-start' }}>
                  <BlurView intensity={80} tint="dark" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7 }}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={{ fontSize: 11, color: '#FFFFFF', fontWeight: '500' }}>{t('ai_chat.thinking')}</Text>
                  </BlurView>
                </View>
              </View>
            ) : null}
            <Reanimated.View style={headerSpacerStyle} />
          </>
        }
        ListFooterComponent={<View style={{ height: insets.top + 72 }} />}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 60, transform: [{ scaleY: -1 }] }}>
            <RNText style={{ fontSize: 48 }} allowFontScaling={false}>🤖</RNText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 }}>
              <Text variant="body" weight="bold">{t('ai_chat.title')}</Text>
              <VerifiedBadge size={14} />
            </View>
            <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 8, paddingHorizontal: 40, lineHeight: 18 }}>
              {t('ai_chat.empty_hint')}
            </Text>
          </View>
        }
      />

      {/* Input — sticks to keyboard (smooth, no lag) */}
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Reanimated.View style={[{ paddingHorizontal: 16, paddingTop: 8, backgroundColor: theme.colors.background.primary }, inputPadStyle]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', backgroundColor: theme.isDark ? 'rgba(40,40,40,0.95)' : 'rgba(245,245,245,0.95)', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.border.light, minHeight: 44 }}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={t('ai_chat.input_placeholder')}
              placeholderTextColor={theme.colors.text.tertiary}
              multiline
              textAlignVertical="center"
              style={{ flex: 1, fontSize: 14, color: theme.colors.text.primary, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20, alignSelf: 'center' }}
              onContentSizeChange={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); }}
            />
            <Pressable onPress={handleSend} disabled={!input.trim() || isLoading} style={{ alignSelf: 'flex-end', width: 32, height: 32, borderRadius: 16, backgroundColor: input.trim() ? theme.colors.accent.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginLeft: 8, marginBottom: 2 }}>
              <Feather name="send" size={14} color={input.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
            </Pressable>
          </View>
        </Reanimated.View>
      </KeyboardStickyView>
    </View>
  );
}
