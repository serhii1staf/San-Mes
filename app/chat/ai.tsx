import React, { useState, useRef, useCallback } from 'react';
import { View, Pressable, TextInput, FlatList, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useThemeStore, ACCENT_COLORS } from '../../src/store/themeStore';
import { sendMessage, parseActions, applyAction, AIMessage, ParsedAction } from '../../src/services/aiService';
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
  const labels: Record<string, string> = { theme: '🎨 Тема', name: '✏️ Имя', emoji: '😊 Эмодзи', username: '@ Юзернейм', bio: '📝 Био' };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.accent.primary + '15', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginTop: 4, alignSelf: 'flex-start' }}>
      <Text variant="caption" color={theme.colors.accent.primary} style={{ fontSize: 11 }}>{labels[action.type] || action.type}: {action.value}</Text>
      {action.applied && <Feather name="check-circle" size={12} color={theme.colors.accent.primary} />}
    </View>
  );
}

function MessageBubble({ message }: { message: AIMessage }) {
  const theme = useTheme();
  const isUser = message.role === 'user';
  return (
    <View style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '80%', marginBottom: 10 }}>
      <View style={{ backgroundColor: isUser ? theme.colors.accent.primary : (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'), borderRadius: 18, borderBottomRightRadius: isUser ? 4 : 18, borderBottomLeftRadius: isUser ? 18 : 4, paddingHorizontal: 14, paddingVertical: 10 }}>
        <Text variant="body" color={isUser ? '#FFFFFF' : theme.colors.text.primary} style={{ fontSize: 14 }}>{message.content}</Text>
      </View>
      {message.actions?.map((action, i) => (
        <View key={i}>
          <ActionBubble action={action} />
          {action.type === 'theme' && <ThemePreview themeKey={action.value} />}
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
  const flatListRef = useRef<FlatList>(null);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    triggerHaptic('light');
    setInput('');

    const userMsg: AIMessage = { id: Date.now().toString(), role: 'user', content: text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    setIsLoading(true);
    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
      const response = await sendMessage(history);
      const { cleanText, actions } = parseActions(response);

      // Apply actions
      const appliedActions: ParsedAction[] = [];
      for (const action of actions) {
        const success = await applyAction(action);
        appliedActions.push({ ...action, applied: success });
      }

      const aiMsg: AIMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: cleanText, actions: appliedActions.length > 0 ? appliedActions : undefined, timestamp: Date.now() };
      setMessages(prev => [...prev, aiMsg]);
    } catch {
      const errMsg: AIMessage = { id: (Date.now() + 1).toString(), role: 'assistant', content: 'Не удалось подключиться. Попробуй позже.', timestamp: Date.now() };
      setMessages(prev => [...prev, errMsg]);
    }
    setIsLoading(false);
  }, [input, isLoading, messages]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.background.primary }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 }}>
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.7, 1]} style={{ paddingTop: insets.top + 8, paddingBottom: 16, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} style={{ borderRadius: 17, overflow: 'hidden' }}>
              <BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="chevron-left" size={18} color="#FFFFFF" />
              </BlurView>
            </Pressable>
            <View style={{ alignItems: 'center' }}>
              <Text variant="body" weight="bold">San AI</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10 }}>Ассистент</Text>
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
        contentContainerStyle={{ paddingTop: insets.top + 70, paddingBottom: 90, paddingHorizontal: 16 }}
        renderItem={({ item }) => <MessageBubble message={item} />}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 80 }}>
            <Text style={{ fontSize: 48 }}>🤖</Text>
            <Text variant="body" weight="semibold" style={{ marginTop: 12 }}>Привет! Я San AI</Text>
            <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 6, paddingHorizontal: 32 }}>
              Могу сменить тему, имя, эмодзи, юзернейм или био. Просто напиши что хочешь!
            </Text>
          </View>
        }
      />

      {/* Loading indicator */}
      {isLoading && (
        <View style={{ position: 'absolute', bottom: 80, left: 16 }}>
          <View style={{ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 }}>
            <ActivityIndicator size="small" color={theme.colors.accent.primary} />
          </View>
        </View>
      )}

      {/* Input */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: insets.bottom + 8, paddingHorizontal: 16, paddingTop: 8, backgroundColor: theme.colors.background.primary }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: theme.colors.border.light }}>
          <TextInput
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
      </View>
    </KeyboardAvoidingView>
  );
}
