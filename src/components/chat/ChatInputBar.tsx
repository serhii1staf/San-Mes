import React, { memo, useState, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { View, TextInput, Pressable, Platform, StyleSheet } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';

// Isolated chat input bar.
//
// Performance: this component owns the text-input state LOCALLY. Typing therefore
// re-renders only this small bar — never the parent ChatScreen or the message
// FlatList. That removes the keystroke lag that came from re-reconciling the whole
// message tree on every character.
//
// The parent drives "edit/reply prefill" and "clear" imperatively via the ref so
// it still never needs to hold the live text value.

export interface ChatInputBarHandle {
  setText: (text: string) => void;
  clear: () => void;
  getText: () => string;
}

interface ChatInputBarProps {
  isEditing: boolean;
  hasPendingImages: boolean;
  onSend: (text: string) => void;
  onPickImages: () => void;
  inputRowStyle: any; // Reanimated animated style (paddingBottom)
}

export const ChatInputBar = memo(forwardRef<ChatInputBarHandle, ChatInputBarProps>(function ChatInputBar(
  { isEditing, hasPendingImages, onSend, onPickImages, inputRowStyle },
  ref,
) {
  const theme = useTheme();
  const [text, setText] = useState('');

  useImperativeHandle(ref, () => ({
    setText: (t: string) => setText(t),
    clear: () => setText(''),
    getText: () => text,
  }), [text]);

  const canSend = text.trim().length > 0 || hasPendingImages;

  const handleSend = useCallback(() => {
    const t = text;
    setText('');
    onSend(t);
  }, [text, onSend]);

  return (
    <Reanimated.View style={[styles.row, inputRowStyle]}>
      <Pressable onPress={onPickImages} style={[styles.iconBtn, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
        <Feather name="image" size={20} color={theme.colors.accent.primary} />
      </Pressable>
      <View style={[styles.inputWrap, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Сообщение..."
          placeholderTextColor={theme.colors.text.tertiary}
          style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 100, paddingVertical: Platform.OS === 'ios' ? 10 : 6 }}
          multiline
        />
      </View>
      <Pressable onPress={handleSend} style={[styles.sendBtn, { backgroundColor: canSend ? theme.colors.accent.primary : theme.colors.background.elevated }]}>
        <Feather name={isEditing ? 'check' : 'send'} size={18} color={canSend ? '#FFFFFF' : theme.colors.text.tertiary} />
      </Pressable>
    </Reanimated.View>
  );
}));

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingHorizontal: 14, minHeight: 44, borderWidth: 1 },
  sendBtn: { marginLeft: 8, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
