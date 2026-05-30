import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Pressable, TextInput, FlatList, ActivityIndicator, Dimensions, Text as RNText, Animated, Keyboard, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { useThemeStore, ACCENT_COLORS } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store';
import { sendMessage, parseActions, applyAction, AIMessage, ParsedAction, getRemainingRequests, saveChatHistory, loadChatHistory } from '../../src/services/aiService';
import { triggerHaptic } from '../../src/utils/haptics';

const SCREEN_WIDTH = Dimensions.get('window').width;

// Mini theme preview card (like in appearance settings)
function MiniThemeCard({ themeKey, isActive }: { themeKey: string; isActive: boolean }) {
  const user = useAuthStore((s) => s.user);
  const t = ACCENT_COLORS.find(c => c.key === themeKey);
  if (!t) return null;
  const bgPrimary = t.darkBg;
  const bgElevated = t.darkElevated;
  const textPrimary = '#FFFFFF';
  const textSecondary = 'rgba(255,255,255,0.5)';
  const borderColor = t.darkBorder;

  return (
    <View style={{
      width: SCREEN_WIDTH * 0.55,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: bgPrimary,
      borderWidth: isActive ? 2 : 1,
      borderColor: isActive ? t.color : borderColor,
      marginTop: 8,
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: textPrimary }}>San</Text>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: t.color }} />
      </View>
      <View style={{ marginHorizontal: 8, marginVertical: 4, backgroundColor: bgElevated, borderRadius: 12, padding: 8, borderWidth: 0.5, borderColor: borderColor }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: t.color + '20', alignItems: 'center', justifyContent: 'center' }}>
            <RNText style={{ fontSize: 9 }} allowFontScaling={false}>{user?.emoji || '😊'}</RNText>
          </View>
          <View style={{ marginLeft: 6 }}>
            <Text style={{ fontSize: 8, fontWeight: '600', color: textPrimary }}>{user?.displayName || 'User'}</Text>
          </View>
        </View>
        <View style={{ height: 6, width: '80%', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 3 }} />
        <View style={{ height: 6, width: '50%', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.05)' }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 6, borderTopWidth: 0.5, borderTopColor: borderColor }}>
        <Feather name="home" size={10} color={t.color} />
        <Feather name="search" size={10} color={textSecondary} />
        <Feather name="plus-square" size={10} color={textSecondary} />
        <Feather name="message-circle" size={10} color={textSecondary} />
        <Feather name="user" size={10} color={textSecondary} />
      </View>
      {/* Label */}
      <View style={{ alignItems: 'center', paddingVertical: 4, backgroundColor: t.color + '15' }}>
        <Text style={{ fontSize: 9, fontWeight: '600', color: t.color }}>{t.label}</Text>
      </View>
    </View>
  );
}

function ActionBubble({ action }: { action: ParsedAction }) {
  const theme = useTheme();
  const currentAccent = useThemeStore((s) => s.accent);
  const labels: Record<string, string> = {
    theme: '🎨 Тема', mode: '🌓 Режим', name: '✏️ Имя',
    emoji: '😊 Эмодзи', username: '@ Юзернейм', bio: '📝 Био', font: '🔤 Шрифт',
  };
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: action.applied ? theme.colors.accent.primary + '15' : 'rgba(255,59,48,0.1)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginTop: 4, alignSelf: 'flex-start' }}>
        <Text variant="caption" color={action.applied ? theme.colors.accent.primary : '#FF3B30'} style={{ fontSize: 11 }}>
          {labels[action.type] || action.type}: {action.value}
        </Text>
        {action.applied ? <Feather name="check-circle" size={12} color={theme.colors.accent.primary} /> : <Feather name="x-circle" size={12} color="#FF3B30" />}
      </View>
      {action.type === 'theme' && action.applied && <MiniThemeCard themeKey={action.value} isActive={currentAccent === action.value} />}
    </View>
  );
}

function MessageBubble({ message }: { message: AIMessage }) {
  const theme = useTheme();
  const isUser = message.role === 'user';
  return (
    <View style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: 12 }}>
      {!isUser && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          <RNText style={{ fontSize: 14 }} allowFontScaling={false}>🤖</RNText>
          <Text variant="caption" weight="semibold" style={{ fontSize: 11 }}>San AI</Text>
          <VerifiedBadge size={10} />
        </View>
      )}
      <View style={{
        backgroundColor: isUser ? theme.colors.accent.primary : (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'),
        borderRadius: 20,
        borderBottomRightRadius: isUser ? 6 : 20,
        borderBottomLeftRadius: isUser ? 20 : 6,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}>
        <Text variant="body" color={isUser ? '#FFFFFF' : theme.colors.text.primary} style={{ fontSize: 14, lineHeight: 20 }}>
          {message.content}
        </Text>
      </View>
      {message.actions?.map((action, i) => <ActionBubble key={i} action={action} />)}
    </View>
  );
}

export default function AIChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [remaining, setRemaining] = useState(50);
  const keyboardAnim = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  // Smooth keyboard animation
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      Animated.timing(keyboardAnim, { toValue: e.endCoordinates.height, duration: Platform.OS === 'ios' ? e.duration || 250 : 200, useNativeDriver: false }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, (e) => {
      Animated.timing(keyboardAnim, { toValue: 0, duration: Platform.OS === 'ios' ? (e as any).duration || 250 : 200, useNativeDriver: false }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Load saved chat
  useEffect(() => {
    loadChatHistory().then(saved => { if (saved.length > 0) setMessages(saved); });
    getRemainingRequests().then(setRemaining);
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
      const recentMessages = newMessages.slice(-10).map(m => ({ role: m.role, content: m.content }));
      const response = await sendMessage(recentMessages);
      const { cleanText, actions } = parseActions(response);

      const appliedActions: ParsedAction[] = [];
      for (const action of actions) {
        const success = await applyAction(action);
        appliedActions.push({ ...action, applied: success });
        if (success) triggerHaptic('medium');
      }

      const aiMsg: AIMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: cleanText || (appliedActions.length > 0 ? 'Готово!' : ''),
        actions: appliedActions.length > 0 ? appliedActions : undefined,
        timestamp: Date.now(),
      };
      const finalMessages = [...newMessages, aiMsg];
      setMessages(finalMessages);
      saveChatHistory(finalMessages);
      getRemainingRequests().then(setRemaining);
    } catch {
      const errMsg: AIMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: 'Не удалось подключиться. Проверь интернет.', timestamp: Date.now() };
      const finalMessages = [...newMessages, errMsg];
      setMessages(finalMessages);
      saveChatHistory(finalMessages);
    }
    setIsLoading(false);
  }, [input, isLoading, messages]);

  // Compute bottom with padding
  const inputBottom = Animated.add(keyboardAnim, new Animated.Value(insets.bottom + 8));

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 }}>
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.7, 1]} style={{ paddingTop: insets.top + 8, paddingBottom: 20, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} style={{ borderRadius: 17, overflow: 'hidden' }}>
              <BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="chevron-left" size={18} color="#FFFFFF" />
              </BlurView>
            </Pressable>
            <View style={{ alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text variant="body" weight="bold">San AI</Text>
                <VerifiedBadge size={13} />
              </View>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10 }}>{remaining}/50 запросов</Text>
            </View>
            <View style={{ width: 34 }} />
          </View>
        </LinearGradient>
      </View>

      {/* Messages */}
      <Animated.View style={{ flex: 1, paddingBottom: Animated.add(keyboardAnim, new Animated.Value(70)) }}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingTop: insets.top + 76, paddingBottom: 80, paddingHorizontal: 16 }}
          renderItem={({ item }) => <MessageBubble message={item} />}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <RNText style={{ fontSize: 48 }} allowFontScaling={false}>🤖</RNText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 }}>
                <Text variant="body" weight="bold">San AI</Text>
                <VerifiedBadge size={14} />
              </View>
              <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 8, paddingHorizontal: 40, lineHeight: 18 }}>
                Привет! Я могу сменить тему под настроение, изменить имя, эмодзи, био — просто напиши.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 16, paddingHorizontal: 20 }}>
                {['Подбери тему', 'Сменить имя', 'Тёмная тема', 'Что ты умеешь?'].map(hint => (
                  <Pressable key={hint} onPress={() => setInput(hint)} style={{ backgroundColor: theme.colors.accent.primary + '12', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text variant="caption" color={theme.colors.accent.primary} style={{ fontSize: 12 }}>{hint}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
        />
      </Animated.View>

      {/* Typing indicator */}
      {isLoading && (
        <Animated.View style={{ position: 'absolute', bottom: Animated.add(keyboardAnim, new Animated.Value(insets.bottom + 68)), left: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }}>
            <ActivityIndicator size="small" color={theme.colors.accent.primary} />
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>Думаю...</Text>
          </View>
        </Animated.View>
      )}

      {/* Input — animated with keyboard */}
      <Animated.View style={{ position: 'absolute', bottom: Animated.add(keyboardAnim, new Animated.Value(insets.bottom + 8)), left: 0, right: 0, paddingHorizontal: 16, paddingTop: 8, backgroundColor: theme.colors.background.primary }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.border.light }}>
          <TextInput
            ref={inputRef}
            value={input}
            onChangeText={setInput}
            placeholder="Напиши что-нибудь..."
            placeholderTextColor={theme.colors.text.tertiary}
            multiline
            style={{ flex: 1, fontSize: 14, color: theme.colors.text.primary, maxHeight: 100, paddingVertical: 4 }}
          />
          <Pressable onPress={handleSend} disabled={!input.trim() || isLoading} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: input.trim() ? theme.colors.accent.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
            <Feather name="send" size={14} color={input.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}
