import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Pressable, TextInput, FlatList, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { useThemeStore, ACCENT_COLORS } from '../../src/store/themeStore';
import { sendMessage, parseActions, applyAction, AIMessage, ParsedAction, getRemainingRequests } from '../../src/services/aiService';
import { triggerHaptic } from '../../src/utils/haptics';

function ThemePreview({ themeKey }: { themeKey: string }) {
  const t = ACCENT_COLORS.find(c => c.key === themeKey);
  if (!t) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.darkBg, borderRadius: 12, padding: 10, marginTop: 6, borderWidth: 1, borderColor: t.color + '30' }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.color }} />
      <Text variant="caption" weight="semibold" color={t.color}>{t.label}</Text>
      <Feather name="check" size={14} color={t.color} />
    </View>
  );
}

function ActionBubble({ action }: { action: ParsedAction }) {
  const theme = useTheme();
  const labels: Record<string, string> = {
    theme: '🎨 Тема', mode: '🌓 Режим', name: '✏️ Имя',
    emoji: '😊 Эмодзи', username: '@ Юзернейм', bio: '📝 Био', font: '🔤 Шрифт',
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: action.applied ? theme.colors.accent.primary + '15' : 'rgba(255,59,48,0.1)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginTop: 4, alignSelf: 'flex-start' }}>
      <Text variant="caption" color={action.applied ? theme.colors.accent.primary : '#FF3B30'} style={{ fontSize: 11 }}>
        {labels[action.type] || action.type}: {action.value}
      </Text>
      {action.applied ? <Feather name="check-circle" size={12} color={theme.colors.accent.primary} /> : <Feather name="x-circle" size={12} color="#FF3B30" />}
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
          <Text style={{ fontSize: 12 }}>🤖</Text>
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
      {message.actions?.map((action, i) => (
        <View key={i}>
          <ActionBubble action={action} />
          {action.type === 'theme' && action.applied && <ThemePreview themeKey={action.value} />}
        </View>
      ))}
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
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => { getRemainingRequests().then(setRemaining); }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    triggerHaptic('light');
    setInput('');

    const userMsg: AIMessage = { id: Date.now().toString(), role: 'user', content: text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    setIsLoading(true);
    try {
      // Send last 10 messages for context (optimize token usage)
      const recentMessages = [...messages, userMsg].slice(-10).map(m => ({ role: m.role, content: m.content }));
      const response = await sendMessage(recentMessages);
      const { cleanText, actions } = parseActions(response);

      // Apply actions sequentially
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
      setMessages(prev => [...prev, aiMsg]);
      getRemainingRequests().then(setRemaining);
    } catch {
      const errMsg: AIMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: 'Не удалось подключиться. Проверь интернет.', timestamp: Date.now() };
      setMessages(prev => [...prev, errMsg]);
    }
    setIsLoading(false);
  }, [input, isLoading, messages]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.background.primary }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
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
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10 }}>{remaining} запросов осталось</Text>
            </View>
            <View style={{ width: 34 }} />
          </View>
        </LinearGradient>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingTop: insets.top + 76, paddingBottom: 100, paddingHorizontal: 16 }}
        renderItem={({ item }) => <MessageBubble message={item} />}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ fontSize: 48 }}>🤖</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 }}>
              <Text variant="body" weight="bold">San AI</Text>
              <VerifiedBadge size={14} />
            </View>
            <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 8, paddingHorizontal: 40, lineHeight: 18 }}>
              Привет! Я могу сменить тему под настроение, изменить имя, эмодзи, био — просто напиши что хочешь.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 16, paddingHorizontal: 20 }}>
              {['Подбери тему', 'Сменить имя', 'Тёмная тема', 'Что ты умеешь?'].map(hint => (
                <Pressable key={hint} onPress={() => { setInput(hint); }} style={{ backgroundColor: theme.colors.accent.primary + '12', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 }}>
                  <Text variant="caption" color={theme.colors.accent.primary} style={{ fontSize: 12 }}>{hint}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
      />

      {/* Typing indicator */}
      {isLoading && (
        <View style={{ position: 'absolute', bottom: 88, left: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }}>
            <ActivityIndicator size="small" color={theme.colors.accent.primary} />
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>Думаю...</Text>
          </View>
        </View>
      )}

      {/* Input */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: insets.bottom + 8, paddingHorizontal: 16, paddingTop: 8, backgroundColor: theme.colors.background.primary }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.border.light }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Напиши что-нибудь..."
            placeholderTextColor={theme.colors.text.tertiary}
            multiline
            style={{ flex: 1, fontSize: 14, color: theme.colors.text.primary, maxHeight: 100, paddingVertical: 4 }}
            onSubmitEditing={handleSend}
          />
          <Pressable onPress={handleSend} disabled={!input.trim() || isLoading} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: input.trim() ? theme.colors.accent.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
            <Feather name="send" size={14} color={input.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
