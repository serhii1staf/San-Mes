import React, { useState, useEffect } from 'react';
import { View, Pressable, ScrollView, TextInput, FlatList, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useMiniAppsStore, MiniApp } from '../../src/store/miniAppsStore';
import { useAuthStore } from '../../src/store';
import { showToast } from '../../src/store/toastStore';

export default function MiniAppsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { apps, isLoading, loadApps, createApp, deleteApp } = useMiniAppsStore();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji] = useState('🎮');
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadApps(); }, []);

  const handleCreate = async () => {
    if (!name.trim() || !url.trim() || !user?.id) {
      Alert.alert('Ошибка', 'Заполните название и URL');
      return;
    }
    setCreating(true);
    const { error } = await createApp({
      creator_id: user.id,
      name: name.trim(),
      description: description.trim(),
      emoji: emoji || '🎮',
      url: url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`,
    });
    setCreating(false);
    if (error) {
      Alert.alert('Ошибка', error);
    } else {
      showToast('Мини-приложение создано', 'check');
      setShowCreate(false);
      setName(''); setDescription(''); setUrl(''); setEmoji('🎮');
    }
  };

  const handleOpen = (app: MiniApp) => {
    router.push({ pathname: '/mini-app', params: { url: encodeURIComponent(app.url), name: app.name, emoji: app.emoji } });
  };

  const handleDelete = (app: MiniApp) => {
    Alert.alert('Удалить?', app.name, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => { deleteApp(app.id); showToast('Удалено', 'trash-2'); } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="body" weight="bold">Мини-приложения</Text>
        <Pressable onPress={() => setShowCreate(!showCreate)}>
          <Feather name="plus" size={22} color={theme.colors.accent.primary} />
        </Pressable>
      </View>

      {/* Create form */}
      {showCreate && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <Pressable onPress={() => { const emojis = ['🎮', '🛒', '📊', '🎵', '📝', '🔧', '🌐', '💬', '📸', '🎯']; setEmoji(emojis[Math.floor(Math.random() * emojis.length)]); }} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.colors.background.elevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border.light }}>
              <Text style={{ fontSize: 22 }} allowFontScaling={false}>{emoji}</Text>
            </Pressable>
            <TextInput value={name} onChangeText={setName} placeholder="Название" placeholderTextColor={theme.colors.text.tertiary} style={{ flex: 1, backgroundColor: theme.colors.background.elevated, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.colors.text.primary, borderWidth: 1, borderColor: theme.colors.border.light }} />
          </View>
          <TextInput value={description} onChangeText={setDescription} placeholder="Описание (необязательно)" placeholderTextColor={theme.colors.text.tertiary} style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.colors.text.primary, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border.light }} />
          <TextInput value={url} onChangeText={setUrl} placeholder="https://..." placeholderTextColor={theme.colors.text.tertiary} autoCapitalize="none" keyboardType="url" style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.colors.text.primary, marginBottom: 12, borderWidth: 1, borderColor: theme.colors.border.light }} />
          <Pressable onPress={handleCreate} disabled={creating} style={{ backgroundColor: theme.colors.accent.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', opacity: creating ? 0.6 : 1 }}>
            <Text variant="body" weight="semibold" color="#FFFFFF">{creating ? 'Создание...' : 'Создать'}</Text>
          </Pressable>
        </View>
      )}

      {/* Apps list */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      ) : (
        <FlatList
          data={apps}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ fontSize: 40 }}>🎮</Text>
              <Text variant="body" color={theme.colors.text.tertiary} style={{ marginTop: 12 }}>Нет мини-приложений</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 4 }}>Нажмите + чтобы создать</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => handleOpen(item)} onLongPress={() => { if (user?.id === item.creator_id) handleDelete(item); }} delayLongPress={500} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 16, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border.light }}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.colors.accent.primary + '15', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
                <Text style={{ fontSize: 22 }} allowFontScaling={false}>{item.emoji}</Text>
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text variant="body" weight="semibold">{item.name}</Text>
                {item.description ? <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>{item.description}</Text> : null}
              </View>
              <Feather name="chevron-right" size={18} color={theme.colors.text.tertiary} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
