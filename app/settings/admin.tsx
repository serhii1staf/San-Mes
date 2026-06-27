import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, ScrollView, Pressable, TextInput, Alert, Modal, FlatList, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { parseImageUrls, adminDeletePost } from '../../src/lib/supabase';
import { apiGet, apiPatch } from '../../src/services/apiClient';
import { kvGetStringRawSync, kvSetStringRaw, kvDeleteRaw } from '../../src/services/kvStore';
import { useFeedStore } from '../../src/store/feedStore';
import { accountKey } from '../../src/services/cacheService';
import { formatTimeAgo } from '../../src/utils/mockData';
import { t as tStatic, useT, useI18nStore } from '../../src/i18n/store';

// The admin key is NEVER hardcoded in the client bundle. The operator enters it
// once; after a successful validation request it is persisted to the on-device
// secure store (raw MMKV key, not account-scoped) under `admin_key` and read
// back into component state on subsequent visits.
const ADMIN_KEY_STORAGE_KEY = 'admin_key';
const STATUS_ENDPOINT = 'https://san-m-app.com/api/admin/status';

interface ServiceStatus {
  key: string;
  name: string;
  status: 'online' | 'degraded' | 'offline';
  latencyMs: number;
  detail: string;
}
interface UsageItem {
  key: string;
  label: string;
  used: number;
  limit: number;
  unit: string;
  extra?: string;
  measured: boolean;
}
interface StatusResponse {
  generatedAt: string;
  services: ServiceStatus[];
  usage?: UsageItem[];
  metrics: { profiles: number | null; posts: number | null; comments: number | null; dbLatencyMs: number; storageBytes?: number; storageObjects?: number };
}

const BADGES = [
  { key: 'developer', label: 'admin.badge.developer', color: '#6366F1', icon: 'code' },
  { key: 'admin', label: 'admin.badge.admin', color: '#EF4444', icon: 'shield' },
  { key: 'moderator', label: 'admin.badge.moderator', color: '#F59E0B', icon: 'eye' },
  { key: 'verified', label: 'admin.badge.verified', color: '#10B981', icon: 'check-circle' },
  { key: 'vip', label: 'admin.badge.vip', color: '#8B5CF6', icon: 'star' },
  { key: 'creator', label: 'admin.badge.creator', color: '#EC4899', icon: 'film' },
];

export default function AdminScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  // Holds the validated admin key for the lifetime of the unlocked session.
  // A ref (not just state) so the data-loading callbacks read the freshest
  // value without a stale closure right after unlock / hydration.
  const adminKeyRef = useRef<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPostModal, setShowPostModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [showStatus, setShowStatus] = useState(false);
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const resp = await fetch(STATUS_ENDPOINT, {
        headers: { 'x-admin-key': adminKeyRef.current ?? '' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(tStatic('admin.error.server_returned', undefined, { code: String(resp.status) }));
      const json = (await resp.json()) as StatusResponse;
      setStatusData(json);
    } catch (e: any) {
      setStatusError(e?.message || tStatic('admin.error.load_status'));
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const openStatus = () => {
    setShowStatus(true);
    loadStatus();
  };

  // Validate the entered key against a real admin endpoint before trusting it.
  // We deliberately use the plain `fetch` status endpoint (NOT the apiClient
  // helpers) because apiClient treats a 401 as "the user's session died" and
  // logs them out of the whole app — which would be wrong for a mistyped admin
  // key. Only on a 200 do we persist the key to the secure on-device store.
  const handleUnlock = async () => {
    const candidate = password.trim();
    if (!candidate || unlocking) return;
    setUnlocking(true);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const resp = await fetch(STATUS_ENDPOINT, {
        headers: { 'x-admin-key': candidate },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (resp.ok) {
        kvSetStringRaw(ADMIN_KEY_STORAGE_KEY, candidate);
        adminKeyRef.current = candidate;
        setPassword('');
        setAuthenticated(true);
        loadUsers();
      } else if (resp.status === 401 || resp.status === 403) {
        Alert.alert(t('common.error'), t('admin.error.wrong_password'));
      } else {
        Alert.alert(t('common.error'), tStatic('admin.error.server_returned', undefined, { code: String(resp.status) }));
      }
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || t('admin.error.load_status'));
    } finally {
      setUnlocking(false);
    }
  };

  // Forget the stored admin key and return to the locked gate. Clears all
  // in-memory admin data so nothing lingers after "logout".
  const handleAdminLogout = () => {
    kvDeleteRaw(ADMIN_KEY_STORAGE_KEY);
    adminKeyRef.current = null;
    setAuthenticated(false);
    setPassword('');
    setUsers([]);
    setSelectedUser(null);
    setUserPosts([]);
    setShowStatus(false);
    setStatusData(null);
  };

  // On mount: if a validated admin key was previously persisted, hydrate it
  // and open the panel straight away. Reading the raw MMKV value is synchronous.
  useEffect(() => {
    const stored = kvGetStringRawSync(ADMIN_KEY_STORAGE_KEY);
    if (stored) {
      adminKeyRef.current = stored;
      setAuthenticated(true);
      loadUsers();
    }
    // loadUsers is a stable useCallback([]); run this once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    // Phase 5: admin reads route through the Worker behind the
    // X-Admin-Key header (the operator-supplied admin key, held in
    // adminKeyRef after unlock). Returns the same row shape Supabase did.
    const { data } = await apiGet<any[]>('/v1/admin/profiles?limit=50', {
      headers: { 'X-Admin-Key': adminKeyRef.current ?? '' },
    });
    if (data) setUsers(data);
    setLoading(false);
  }, []);

  const loadUserPosts = useCallback(async (userId: string) => {
    setLoading(true);
    const { data } = await apiGet<any[]>(
      `/v1/admin/profiles/${encodeURIComponent(userId)}/posts?limit=30`,
      { headers: { 'X-Admin-Key': adminKeyRef.current ?? '' } },
    );
    if (data) setUserPosts(data);
    setLoading(false);
  }, []);

  const handleSelectUser = (user: any) => {
    setSelectedUser(user);
    loadUserPosts(user.id);
  };

  const handleDeletePost = async (postId: string) => {
    Alert.alert(t('admin.delete_post_title'), t('admin.delete_post_msg'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: async () => {
        // Delete from server (+ images + reposts + likes + comments)
        const { error } = await adminDeletePost(postId, adminKeyRef.current ?? '');
        if (error) {
          Alert.alert(t('common.error'), error);
          return;
        }

        // Remove from local state
        setUserPosts(prev => prev.filter(p => p.id !== postId));
        setShowPostModal(false);
        setSelectedPost(null);

        // Remove from Zustand feed store
        useFeedStore.getState().removePost(postId);

        // Remove from AsyncStorage caches
        try {
          const feedCached = await AsyncStorage.getItem(accountKey('@san:feed_posts'));
          if (feedCached) {
            const posts = JSON.parse(feedCached).filter((p: any) => p.id !== postId);
            await AsyncStorage.setItem(accountKey('@san:feed_posts'), JSON.stringify(posts));
          }
          const myCached = await AsyncStorage.getItem(accountKey('@san:my_posts'));
          if (myCached) {
            const posts = JSON.parse(myCached).filter((p: any) => p.id !== postId);
            await AsyncStorage.setItem(accountKey('@san:my_posts'), JSON.stringify(posts));
          }
        } catch {}
      }},
    ]);
  };

  const handleToggleVerify = async (userId: string, currentlyVerified: boolean) => {
    await apiPatch(
      `/v1/admin/profiles/${encodeURIComponent(userId)}`,
      { is_verified: !currentlyVerified },
      { headers: { 'X-Admin-Key': adminKeyRef.current ?? '' } },
    );
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_verified: !currentlyVerified } : u));
    if (selectedUser?.id === userId) setSelectedUser({ ...selectedUser, is_verified: !currentlyVerified });
  };

  const handleSetBadge = async (userId: string, badge: string | null) => {
    await apiPatch(
      `/v1/admin/profiles/${encodeURIComponent(userId)}`,
      { badge },
      { headers: { 'X-Admin-Key': adminKeyRef.current ?? '' } },
    );
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, badge } : u));
    if (selectedUser?.id === userId) setSelectedUser({ ...selectedUser, badge });
  };

  // Password screen
  if (!authenticated) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, justifyContent: 'center', paddingHorizontal: 32 }}>
        <Pressable onPress={() => router.back()} style={{ position: 'absolute', top: insets.top + 12, left: 16 }}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <Feather name="shield" size={40} color={theme.colors.accent.primary} />
          <Text variant="subheading" weight="bold" style={{ marginTop: 12 }}>{t('admin.title')}</Text>
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 4 }}>{t('admin.password_subtitle')}</Text>
        </View>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder={t('admin.password_placeholder')}
          placeholderTextColor={theme.colors.text.tertiary}
          secureTextEntry
          autoFocus
          style={{
            backgroundColor: theme.colors.background.elevated,
            borderRadius: 14,
            paddingHorizontal: 16,
            paddingVertical: 14,
            fontSize: 16,
            color: theme.colors.text.primary,
            borderWidth: 1,
            borderColor: theme.colors.border.light,
            marginBottom: 16,
          }}
          onSubmitEditing={handleUnlock}
        />
        <Pressable onPress={handleUnlock} disabled={unlocking} style={{ backgroundColor: theme.colors.accent.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', opacity: unlocking ? 0.6 : 1 }}>
          {unlocking ? <ActivityIndicator color="#FFFFFF" /> : <Text variant="body" weight="semibold" color="#FFFFFF">{t('auth.signin')}</Text>}
        </Pressable>
      </View>
    );
  }

  // User posts view
  if (selectedUser) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 16, gap: 12 }}>
          <Pressable onPress={() => { setSelectedUser(null); setUserPosts([]); }}>
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Avatar emoji={selectedUser.emoji || '😊'} size="sm" />
          <View style={{ flex: 1 }}>
            <Text variant="body" weight="semibold">{selectedUser.display_name}</Text>
            <Text variant="caption" color={theme.colors.text.tertiary}>@{selectedUser.username}</Text>
          </View>
        </View>

        {/* Badge & Verify controls */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <Pressable onPress={() => handleToggleVerify(selectedUser.id, selectedUser.is_verified)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: selectedUser.is_verified ? '#10B98120' : theme.colors.background.secondary }}>
              <Feather name="check-circle" size={14} color={selectedUser.is_verified ? '#10B981' : theme.colors.text.tertiary} />
              <Text variant="caption" color={selectedUser.is_verified ? '#10B981' : theme.colors.text.tertiary}>{selectedUser.is_verified ? t('admin.verified') : t('admin.verify')}</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <Pressable onPress={() => handleSetBadge(selectedUser.id, null)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: !selectedUser.badge ? theme.colors.accent.primary + '20' : theme.colors.background.secondary }}>
              <Text variant="caption" color={!selectedUser.badge ? theme.colors.accent.primary : theme.colors.text.tertiary}>{t('admin.no_badge')}</Text>
            </Pressable>
            {BADGES.map(b => (
              <Pressable key={b.key} onPress={() => handleSetBadge(selectedUser.id, b.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: selectedUser.badge === b.key ? b.color + '20' : theme.colors.background.secondary }}>
                <Feather name={b.icon as any} size={12} color={selectedUser.badge === b.key ? b.color : theme.colors.text.tertiary} />
                <Text variant="caption" color={selectedUser.badge === b.key ? b.color : theme.colors.text.tertiary}>{t(b.label)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Posts list */}
        {loading ? <ActivityIndicator style={{ marginTop: 40 }} /> : (
          <FlatList
            data={userPosts}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            // Admin panel — list can hit hundreds of items per user. Tight
            // virtualization keeps the initial render cheap and the scroll
            // smooth even on the largest accounts.
            removeClippedSubviews
            initialNumToRender={8}
            maxToRenderPerBatch={4}
            windowSize={6}
            renderItem={({ item, index }) => {
              const imgs = parseImageUrls(item.image_url);
              return (
                <Pressable onPress={() => { setSelectedPost(item); setShowPostModal(true); }} style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 16, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border.light }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {imgs[0] && <CachedImage uri={imgs[0]} style={{ width: 50, height: 50, borderRadius: 10 }} resizeMode="cover" priority={index < 4 ? 'normal' : 'low'} />}
                    <View style={{ flex: 1 }}>
                      <Text variant="caption" numberOfLines={2} color={theme.colors.text.secondary}>{item.content || t('admin.no_text')}</Text>
                      <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10, marginTop: 4 }}>{formatTimeAgo(item.created_at)}</Text>
                    </View>
                    <Pressable onPress={() => handleDeletePost(item.id)} style={{ padding: 6 }}>
                      <Feather name="trash-2" size={16} color="#FF3B30" />
                    </Pressable>
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 40 }}>{t('admin.no_posts')}</Text>}
          />
        )}

        {/* Post detail modal */}
        <Modal visible={showPostModal} transparent animationType="fade" onRequestClose={() => setShowPostModal(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 16 }}>
            <View style={{ backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 24, padding: 20, maxHeight: '80%' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
                <Text variant="body" weight="semibold">{t('admin.post')}</Text>
                <Pressable onPress={() => setShowPostModal(false)}><Feather name="x" size={22} color={theme.colors.text.primary} /></Pressable>
              </View>
              {selectedPost && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 8 }}>ID: {selectedPost.id}</Text>
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 12 }}>{formatTimeAgo(selectedPost.created_at)}</Text>
                  {selectedPost.content && <Text variant="body" style={{ marginBottom: 12 }}>{selectedPost.content}</Text>}
                  {parseImageUrls(selectedPost.image_url).map((uri: string, i: number) => (
                    <CachedImage key={i} uri={uri} style={{ width: '100%', height: 200, borderRadius: 12, marginBottom: 8 }} resizeMode="cover" />
                  ))}
                  <Pressable onPress={() => handleDeletePost(selectedPost.id)} style={{ backgroundColor: '#FF3B3015', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 }}>
                    <Text variant="body" weight="semibold" color="#FF3B30">{t('admin.delete_post_btn')}</Text>
                  </Pressable>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // Services / Status view
  if (showStatus) {
    const dot = (s: string) => (s === 'online' ? '#10B981' : s === 'degraded' ? '#F59E0B' : '#EF4444');
    const dotLabel = (s: string) => (s === 'online' ? t('admin.status.online') : s === 'degraded' ? t('admin.status.degraded') : t('admin.status.offline'));
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 16, gap: 12 }}>
          <Pressable onPress={() => setShowStatus(false)}>
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Feather name="activity" size={20} color={theme.colors.accent.primary} />
          <Text variant="body" weight="bold" style={{ flex: 1 }}>{t('admin.services_title')}</Text>
          <Pressable onPress={loadStatus} hitSlop={8} style={{ padding: 4 }}>
            <Feather name="refresh-cw" size={18} color={theme.colors.text.secondary} />
          </Pressable>
        </View>

        {statusLoading && !statusData ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : statusError ? (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <Feather name="alert-triangle" size={28} color="#F59E0B" />
            <Text variant="body" color={theme.colors.text.secondary} align="center" style={{ marginTop: 12 }}>{statusError}</Text>
            <Pressable onPress={loadStatus} style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.colors.accent.primary }}>
              <Text variant="caption" color="#FFFFFF" weight="semibold">{t('common.retry')}</Text>
            </Pressable>
          </View>
        ) : statusData ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {/* Services */}
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 8, marginTop: 4 }}>{t('admin.section.services')}</Text>
            {statusData.services.map((s) => (
              <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border.light, gap: 12 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot(s.status) }} />
                <View style={{ flex: 1 }}>
                  <Text variant="body" weight="semibold" numberOfLines={1}>{s.name}</Text>
                  <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ marginTop: 2 }}>{s.detail}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text variant="caption" weight="semibold" color={dot(s.status)}>{dotLabel(s.status)}</Text>
                  {s.latencyMs > 0 && <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10, marginTop: 2 }}>{s.latencyMs} {t('admin.unit.ms')}</Text>}
                </View>
              </View>
            ))}

            {/* Usage bars */}
            {statusData.usage && statusData.usage.length > 0 && (
              <>
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 8, marginTop: 16 }}>{t('admin.section.usage')}</Text>
                {statusData.usage.map((u) => (
                  <UsageBar key={u.key} theme={theme} item={u} t={t} />
                ))}
              </>
            )}

            {/* Metrics */}
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 8, marginTop: 16 }}>{t('admin.section.database')}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <MetricCard theme={theme} label={t('admin.metric.profiles')} value={statusData.metrics.profiles} />
              <MetricCard theme={theme} label={t('admin.metric.posts')} value={statusData.metrics.posts} />
              <MetricCard theme={theme} label={t('admin.metric.comments')} value={statusData.metrics.comments} />
            </View>

            <View style={{ marginTop: 16, backgroundColor: theme.colors.background.elevated, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: theme.colors.border.light }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text variant="caption" color={theme.colors.text.tertiary}>{t('admin.metric.db_latency')}</Text>
                <Text variant="caption" weight="semibold">{statusData.metrics.dbLatencyMs} {t('admin.unit.ms')}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="caption" color={theme.colors.text.tertiary}>{t('admin.metric.updated')}</Text>
                <Text variant="caption" weight="semibold">{new Date(statusData.generatedAt).toLocaleTimeString(useI18nStore.getState().locale === 'en' ? 'en-US' : 'ru-RU')}</Text>
              </View>
            </View>
          </ScrollView>
        ) : null}
      </View>
    );
  }

  // Users list
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 16, gap: 12 }}>
        <Pressable onPress={() => router.back()}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Feather name="shield" size={20} color={theme.colors.accent.primary} />
        <Text variant="body" weight="bold" style={{ flex: 1 }}>{t('admin.panel_title')}</Text>
        <Pressable onPress={openStatus} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: theme.colors.accent.primary + '18' }}>
          <Feather name="activity" size={14} color={theme.colors.accent.primary} />
          <Text variant="caption" weight="semibold" color={theme.colors.accent.primary}>{t('admin.services_btn')}</Text>
        </Pressable>
        <Pressable onPress={handleAdminLogout} hitSlop={8} accessibilityLabel="Forget admin key" style={{ padding: 6, borderRadius: 10, backgroundColor: '#FF3B3018' }}>
          <Feather name="log-out" size={16} color="#FF3B30" />
        </Pressable>
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} /> : (
        <FlatList
          data={users}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          // Admin user list — hundreds of rows, each with an Avatar +
          // badge + 3 Pressables. Default virtualization rendered every
          // row on the open-screen frame on a populated DB.
          removeClippedSubviews
          initialNumToRender={8}
          maxToRenderPerBatch={4}
          windowSize={6}
          renderItem={({ item }) => {
            const badge = BADGES.find(b => b.key === item.badge);
            return (
              <Pressable onPress={() => handleSelectUser(item)} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 16, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border.light, gap: 12 }}>
                <Avatar emoji={item.emoji || '😊'} size="sm" />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text variant="body" weight="semibold" numberOfLines={1}>{item.display_name}</Text>
                    {item.is_verified && <Feather name="check-circle" size={12} color="#10B981" />}
                    {badge && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: badge.color + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                        <Feather name={badge.icon as any} size={9} color={badge.color} />
                        <Text style={{ fontSize: 9, color: badge.color, fontWeight: '600' }}>{t(badge.label)}</Text>
                      </View>
                    )}
                  </View>
                  <Text variant="caption" color={theme.colors.text.tertiary}>@{item.username}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={theme.colors.text.tertiary} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

function MetricCard({ theme, label, value }: { theme: any; label: string; value: number | null }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.elevated, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: theme.colors.border.light, alignItems: 'center' }}>
      <Text variant="subheading" weight="bold" style={{ fontSize: 22 }}>{value ?? '—'}</Text>
      <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} ${tStatic('storage.unit.b')}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} ${tStatic('storage.unit.kb')}`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} ${tStatic('storage.unit.mb')}`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} ${tStatic('storage.unit.gb')}`;
}

function UsageBar({ theme, item, t }: { theme: any; item: { label: string; used: number; limit: number; unit: string; extra?: string; measured: boolean }; t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string }) {
  const ratio = item.limit > 0 ? Math.min(item.used / item.limit, 1) : 0;
  const pct = Math.round(ratio * 100);
  const color = ratio > 0.9 ? '#EF4444' : ratio > 0.7 ? '#F59E0B' : '#10B981';
  const fmt = item.unit === 'bytes' ? formatBytes : (x: number) => String(x);
  return (
    <View style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border.light }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text variant="caption" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>{item.label}{!item.measured ? ' ~' : ''}</Text>
        <Text variant="caption" weight="semibold" color={color}>{pct}%</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{t('admin.usage.of', undefined, { used: fmt(item.used), total: fmt(item.limit) })}</Text>
        {item.extra ? <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11 }}>{item.extra}</Text> : null}
      </View>
    </View>
  );
}
