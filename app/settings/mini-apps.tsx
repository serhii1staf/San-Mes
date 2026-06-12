import React, { useState, useEffect } from 'react';
import { View, Pressable, TextInput, FlatList, Alert, ActivityIndicator, Text as RNText, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useMiniAppsStore, MiniApp } from '../../src/store/miniAppsStore';
import { useAuthStore } from '../../src/store';
import { showToast } from '../../src/store/toastStore';
import { useT } from '../../src/i18n/store';

export default function MiniAppsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { user } = useAuthStore();
  const { apps, isLoading, loadApps, createApp, deleteApp } = useMiniAppsStore();
  const [showCreate, setShowCreate] = useState(false);
  const [editingApp, setEditingApp] = useState<MiniApp | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji] = useState('🎮');
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadApps(); }, []);

  const resetForm = () => {
    setName(''); setDescription(''); setUrl(''); setEmoji('🎮');
    setEditingApp(null); setShowCreate(false);
  };

  const handleCreate = async () => {
    if (!name.trim() || !url.trim() || !user?.id) {
      Alert.alert(t('common.error'), t('mini_apps.error.fill_fields'));
      return;
    }
    setCreating(true);

    if (editingApp) {
      // Update: delete old + create new
      await deleteApp(editingApp.id);
      const { error } = await createApp({
        creator_id: user.id,
        name: name.trim(),
        description: description.trim(),
        emoji: emoji || '🎮',
        url: url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`,
      });
      setCreating(false);
      if (error) { Alert.alert(t('common.error'), error); return; }
      showToast(t('toast.saved'), 'check');
    } else {
      const { error } = await createApp({
        creator_id: user.id,
        name: name.trim(),
        description: description.trim(),
        emoji: emoji || '🎮',
        url: url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`,
      });
      setCreating(false);
      if (error) { Alert.alert(t('common.error'), error); return; }
      showToast(t('mini_apps.toast.created'), 'check');
    }
    resetForm();
  };

  const handleEdit = (app: MiniApp) => {
    setEditingApp(app);
    setName(app.name);
    setDescription(app.description);
    setEmoji(app.emoji);
    setUrl(app.url);
    setShowCreate(true);
  };

  const handleOpen = (app: MiniApp) => {
    router.push({ pathname: '/mini-app', params: { url: encodeURIComponent(app.url), name: app.name, emoji: app.emoji } });
  };

  const handleDelete = (app: MiniApp) => {
    Alert.alert(t('mini_apps.delete_title'), app.name, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => { deleteApp(app.id); showToast(t('mini_apps.toast.deleted'), 'trash-2'); } },
    ]);
  };

  const bgColor = theme.colors.background.primary;
  const bgTransparent = bgColor + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Gradient fade header */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, height: headerGradientHeight }} pointerEvents="box-none">
        <LinearGradient colors={[bgColor, bgColor, bgTransparent]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 8 }} pointerEvents="auto">
          <Pressable onPress={() => router.back()} style={{ borderRadius: 17, overflow: 'hidden' }}>
            <BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="chevron-left" size={18} color="#FFFFFF" />
            </BlurView>
          </Pressable>
          <Text variant="body" weight="bold">{t('mini_apps.title')}</Text>
          <Pressable onPress={() => { if (showCreate) resetForm(); else setShowCreate(true); }} style={{ borderRadius: 17, overflow: 'hidden' }}>
            <BlurView intensity={80} tint="dark" style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name={showCreate ? 'x' : 'plus'} size={18} color="#FFFFFF" />
            </BlurView>
          </Pressable>
        </View>
      </View>

      {/* Create/Edit form */}
      {showCreate && (
        <View style={{ paddingHorizontal: 20, paddingTop: headerContentHeight + 16, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <Pressable onPress={() => { const emojis = ['🎮', '🛒', '📊', '🎵', '📝', '🔧', '🌐', '💬', '📸', '🎯', '🏠', '💰', '🎬', '📱', '🔍']; setEmoji(emojis[Math.floor(Math.random() * emojis.length)]); }} style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: theme.colors.background.elevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border.light, overflow: 'visible' }}>
              <RNText style={{ fontSize: 24 }} allowFontScaling={false}>{emoji}</RNText>
            </Pressable>
            <TextInput value={name} onChangeText={setName} placeholder={t('mini_apps.name_placeholder')} placeholderTextColor={theme.colors.text.tertiary} style={{ flex: 1, backgroundColor: theme.colors.background.elevated, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.colors.text.primary, borderWidth: 1, borderColor: theme.colors.border.light }} />
          </View>
          <TextInput value={description} onChangeText={setDescription} placeholder={t('mini_apps.description_placeholder')} placeholderTextColor={theme.colors.text.tertiary} style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.colors.text.primary, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border.light }} />
          <TextInput value={url} onChangeText={setUrl} placeholder="https://..." placeholderTextColor={theme.colors.text.tertiary} autoCapitalize="none" keyboardType="url" style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: theme.colors.text.primary, marginBottom: 12, borderWidth: 1, borderColor: theme.colors.border.light }} />
          <Pressable onPress={handleCreate} disabled={creating} style={{ backgroundColor: theme.colors.accent.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', opacity: creating ? 0.6 : 1 }}>
            <Text variant="body" weight="semibold" color="#FFFFFF">{creating ? t('mini_apps.saving') : (editingApp ? t('common.save') : t('mini_apps.create'))}</Text>
          </Pressable>
        </View>
      )}

      {/* Apps list */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      ) : (
        <FlatList
          data={apps}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: showCreate ? 16 : headerContentHeight + 16, paddingBottom: 40 }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <RNText style={{ fontSize: 40 }} allowFontScaling={false}>🎮</RNText>
              <Text variant="body" color={theme.colors.text.tertiary} style={{ marginTop: 12 }}>{t('mini_apps.empty')}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 4 }}>{t('mini_apps.empty_hint')}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => handleOpen(item)} onLongPress={() => { if (user?.id === item.creator_id) handleDelete(item); }} delayLongPress={500} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 16, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border.light }}>
              <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: theme.colors.accent.primary + '15', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
                <RNText style={{ fontSize: 24 }} allowFontScaling={false}>{item.emoji}</RNText>
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text variant="body" weight="semibold">{item.name}</Text>
                {item.description ? <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>{item.description}</Text> : null}
              </View>
              {user?.id === item.creator_id && (
                <Pressable onPress={() => handleEdit(item)} hitSlop={8} style={{ padding: 6, marginRight: 4 }}>
                  <Feather name="edit-2" size={14} color={theme.colors.text.tertiary} />
                </Pressable>
              )}
              <Feather name="chevron-right" size={18} color={theme.colors.text.tertiary} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
