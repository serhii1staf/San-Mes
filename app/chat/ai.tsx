import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Pressable, TextInput, FlatList, ActivityIndicator, Dimensions, Text as RNText, Platform, LayoutAnimation, UIManager, InteractionManager, Animated, Alert, Share } from 'react-native';
import type { ScrollViewProps } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { ChatKeyboardScrollView } from '../../src/components/ui/ChatKeyboardScrollView';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useLiquidGlassActive, NativeGlassView, GlassBg } from '../../src/components/ui/LiquidGlass';
import { FormattedText } from '../../src/components/ui/FormattedText';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { EmojiPickerModal } from '../../src/components/ui/EmojiPickerModal';
import { MiniAppConsentDialog } from '../../src/components/mini-apps/MiniAppConsentDialog';
import { useThemeStore, ACCENT_COLORS } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store';
import { useMiniAppsStore, MiniApp } from '../../src/store/miniAppsStore';
import { sendMessage, parseActions, applyAction, AIMessage, ParsedAction, getRemainingRequests, saveChatHistory, loadChatHistory } from '../../src/services/aiService';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';
import { showToast } from '../../src/store/toastStore';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { ThemeIconCarousel } from '../../src/components/pixel-icons/ThemeIconCarousel';
import { buildMiniAppShareUrl } from '../../src/utils/miniAppShare';
import { useChatKeyboardMode } from '../../src/hooks/useChatKeyboardMode';

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

interface MessageBubbleProps {
  message: AIMessage;
  onActionUpdate: (
    messageId: string,
    type: ParsedAction['type'],
    patch: Partial<ParsedAction>,
  ) => void;
}

function MessageBubble({ message, onActionUpdate }: MessageBubbleProps) {
  const theme = useTheme();
  const isUser = message.role === 'user';
  // Deduplicate actions of same type (show only last). `theme` and
  // `custom_theme` share a single "theme-class" bucket — otherwise an
  // AI reply that emits both (a built-in switch + a brand-new theme)
  // would render as two pills, which the user perceives as a duplicate.
  const themeBucket = (a: ParsedAction) =>
    a.type === 'theme' || a.type === 'custom_theme' ? 'theme-class' : a.type;
  const uniqueActions = message.actions
    ? message.actions.filter((a, i, arr) => arr.findIndex(x => themeBucket(x) === themeBucket(a)) === i)
    : undefined;
  // The (single) theme-class action that fed the bubble — used by
  // ThemeIconCarousel to pick a hex color and offer matching pixel
  // icons. Only renders when the action successfully applied.
  const themeAction = uniqueActions?.find(
    a => (a.type === 'theme' || a.type === 'custom_theme') && a.applied,
  );
  const themeHex = React.useMemo(() => {
    if (!themeAction) return null;
    if (themeAction.type === 'custom_theme') {
      // value format: "Name:#hex"
      const parts = themeAction.value.split(':');
      const c = parts[1]?.trim();
      return c && c.startsWith('#') ? c : null;
    }
    // type === 'theme' — resolve key against built-ins + ai-themes
    const all = [...ACCENT_COLORS, ...useThemeStore.getState().aiThemes];
    return all.find(x => x.key === themeAction.value)?.color ?? null;
  }, [themeAction]);
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
      {themeAction && themeHex ? (
        <ThemeIconCarousel
          hex={themeHex}
          appliedIconId={themeAction.appliedIconId}
          messageId={message.id}
          actionType={themeAction.type}
          onActionUpdate={onActionUpdate}
        />
      ) : null}
    </View>
  );
}

// Memo comparator: include `actions` reference equality so that an
// `onActionUpdate` patch (which produces a fresh `actions` array) flows
// down to ThemeIconCarousel. Content/id alone weren't enough — the
// carousel's persisted `appliedIconId` lives on `actions[i]`.
const MemoMessageBubble = React.memo(
  MessageBubble,
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.actions === next.message.actions &&
    prev.onActionUpdate === next.onActionUpdate,
);

// ─── Mini-app commands flow types ────────────────────────────────────────────
//
// A small inline state-machine drives the conversational create / edit
// experience. Bubbles still use the canonical `AIMessage` shape so the
// existing chat history persistence keeps working untouched — we only add
// a thin optional `kind` tag for the management-list bubble, which renders
// a live list directly off `useMiniAppsStore` (so it stays fresh after a
// create / edit / delete elsewhere in the app).
type ChatItem = AIMessage & { kind?: 'manage_list' };

type FlowStep =
  | 'idle'
  // Create flow: name → emoji → url
  | 'create_name'
  | 'create_emoji'
  | 'create_url'
  // Edit flow (same three steps; carries an `editingId` in `draft`)
  | 'edit_name'
  | 'edit_emoji'
  | 'edit_url';

interface FlowDraft {
  editingId?: string; // present iff this is an edit, not a create
  name: string;
  emoji: string;
  url: string;
  description: string;
}

const EMPTY_DRAFT: FlowDraft = { name: '', emoji: '🎮', url: '', description: '' };

type CommandId = 'create' | 'manage';
interface CommandDef { id: CommandId; icon: string; label: string; description: string }

interface ManageListBubbleProps {
  ownerId: string | undefined;
  onEdit: (app: MiniApp) => void;
  onDelete: (app: MiniApp) => void;
  onShare: (app: MiniApp) => void;
}

function ManageListBubble({ ownerId, onEdit, onDelete, onShare }: ManageListBubbleProps) {
  const theme = useTheme();
  const t = useT();
  // Live selector so creating / deleting elsewhere updates this bubble
  // without us having to invalidate it from the parent.
  const apps = useMiniAppsStore((s) => s.apps);
  const myApps = useMemo(
    () => (ownerId ? apps.filter((a) => a.creator_id === ownerId) : []),
    [apps, ownerId],
  );

  if (myApps.length === 0) {
    return (
      <View style={{ marginTop: 4, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 }}>
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 12, lineHeight: 18 }}>{t('ai_chat.manage.empty')}</Text>
      </View>
    );
  }

  return (
    <View style={{ marginTop: 4, backgroundColor: theme.colors.background.elevated, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border.light, overflow: 'hidden' }}>
      <Text variant="caption" weight="semibold" style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, fontSize: 11, color: theme.colors.text.tertiary }}>{t('ai_chat.manage.title')}</Text>
      {myApps.map((app, i) => (
        <View key={app.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i === 0 ? 0 : 0.5, borderTopColor: theme.colors.border.light }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: theme.colors.accent.primary + '12', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
            <RNText style={{ fontSize: 18 }} allowFontScaling={false}>{app.emoji}</RNText>
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 13 }}>{app.name}</Text>
            {app.description ? (
              <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11, marginTop: 1 }}>{app.description}</Text>
            ) : null}
          </View>
          <Pressable onPress={() => onShare(app)} hitSlop={8} style={{ padding: 6, marginLeft: 4 }}>
            <Feather name="share-2" size={14} color={theme.colors.text.secondary} />
          </Pressable>
          <Pressable onPress={() => onEdit(app)} hitSlop={8} style={{ padding: 6 }}>
            <Feather name="edit-2" size={14} color={theme.colors.text.secondary} />
          </Pressable>
          <Pressable onPress={() => onDelete(app)} hitSlop={8} style={{ padding: 6 }}>
            <Feather name="trash-2" size={14} color="#FF3B30" />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

// Stable FlatList props hoisted to module scope so their identity never
// changes across screen re-renders. Each keystroke re-renders AIChatScreen;
// keeping keyExtractor + the contentContainer style constant avoids FlatList
// re-running prop diffs / a content-container relayout on every render.
const keyExtractor = (item: ChatItem) => item.id;
const LIST_CONTENT_CONTAINER_STYLE = { paddingHorizontal: 16, paddingTop: 8 };

export default function AIChatScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Android: while focused, stop the OS window resize so ONLY our JS-driven
  // input lift moves content (kills the first-focus jump). No-op on iOS.
  useChatKeyboardMode();
  // Mount-time marker — surfaces in the perf-monitor panel so the user can
  // tell at a glance whether opening the AI chat froze on the JS thread
  // (large initial render) or on the navigation transition itself.
  // Skipped at the call site when the monitor is off.
  const mountStart = useRef(Date.now()).current;
  const perfEnabled = useSettingsStore((s) => s.perfMonitorEnabled);
  useEffect(() => {
    if (!perfEnabled) return;
    perfMonitor.markScreenMount('chat/ai', Date.now() - mountStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfEnabled]);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const user = useAuthStore((s) => s.user);

  // ── Mini-app commands flow state ──────────────────────────────────────────
  // Locally-driven state machine. None of these transitions hit the LLM; the
  // flow's prompts are inlined as plain assistant bubbles via `pushBubbles`.
  const [flowStep, setFlowStep] = useState<FlowStep>('idle');
  const [draft, setDraft] = useState<FlowDraft>(EMPTY_DRAFT);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);

  // ── Content-policy consent gate ───────────────────────────────────────────
  // Publishing / updating a mini app from the AI chat must clear the same
  // content-policy consent the settings screen enforces (Apple / Google +
  // San Terms/Privacy) BEFORE any worker call. When the user finishes the
  // url step we stash the resolved submission here and open the dialog; the
  // createApp / updateApp call only fires from the Accept handler.
  const [consentVisible, setConsentVisible] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<{
    isEdit: boolean;
    finalUrl: string;
    name: string;
    emoji: string;
    description: string;
    editingId?: string;
  } | null>(null);

  const COMMANDS: CommandDef[] = useMemo(
    () => [
      { id: 'create', icon: 'plus-square', label: t('ai_chat.command.create_label'), description: t('ai_chat.command.create_desc') },
      { id: 'manage', icon: 'grid', label: t('ai_chat.command.manage_label'), description: t('ai_chat.command.manage_desc') },
    ],
    [t],
  );

  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const INPUT_BAR = 60;
  // Inverted-list keyboard lift — now handled NATIVELY by the official
  // KeyboardChatScrollView (via `renderScrollComponent` below). The library
  // repositions chat content on keyboard open/close with the default "always"
  // (Telegram/WhatsApp) lift, so the old per-frame translateY list-wrapper
  // (which relayout-jumped on the first focus and on dismiss) is gone. The
  // bottom spacer stays a STATIC height — it only reserves room for the
  // floating input bar while the keyboard is closed.
  const LIST_BOTTOM_SPACER = INPUT_BAR + insets.bottom;

  // Stable renderScrollComponent — FlatList requires a stable reference so it
  // doesn't tear down / rebuild the scroll view on every render. The wrapper
  // also receives `inverted` so its internal lift math matches the list.
  const renderScrollComponent = useCallback(
    (p: ScrollViewProps) => <ChatKeyboardScrollView {...p} inverted />,
    [],
  );

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
  // Native iOS-26 liquid glass for the floating back button. White icon over
  // the gradient header, so colorScheme 'dark' matches the profile chrome.
  const glassActive = useLiquidGlassActive();

  useEffect(() => {
    // Defer all the cold-start side-effects (chat history hydrate, remaining
    // requests fetch, special-chats `markOpened`) past the navigation
    // transition so they never compete with the slide-in animation.
    const handle = InteractionManager.runAfterInteractions(() => {
      loadChatHistory().then(saved => { if (saved.length > 0) setMessages(saved); });
      getRemainingRequests().then(setRemaining);
      try { require('../../src/store/specialChatsStore').useSpecialChatsStore.getState().markOpened('ai'); } catch {}
      // Make sure the user's mini-apps list is hydrated — `Управление`
      // bubble reads from this store live, so a stale cache would render
      // an empty list right after mount on devices that haven't opened
      // the settings screen yet this session.
      try { useMiniAppsStore.getState().loadApps(); } catch {}
    });
    return () => handle.cancel();
  }, []);

  // ── Mini-app flow helpers ─────────────────────────────────────────────────
  // Bubble factories. We never persist a transient AI request through these,
  // so each helper just appends to the canonical `messages` state and lets
  // the existing chat-history saver pick the new entries up.
  const nowId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const appendItems = useCallback((items: ChatItem[]) => {
    // Gentle layout transition for conversational-flow bubbles (name → emoji
    // → url prompts, success/cancel/decline notices, the manage list). This
    // helper is used ONLY by the mini-app flow — the regular LLM request path
    // writes to `setMessages` directly — so easing here never touches the AI
    // request path where it could risk jank.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMessages((prev) => {
      const next = [...prev, ...items];
      saveChatHistory(next);
      return next;
    });
  }, []);

  const userBubble = (text: string): ChatItem => ({
    id: nowId(),
    role: 'user',
    content: text,
    timestamp: Date.now(),
  });
  const aiBubble = (text: string, extras: Partial<ChatItem> = {}): ChatItem => ({
    id: nowId(),
    role: 'assistant',
    content: text,
    timestamp: Date.now(),
    ...extras,
  });

  const startCreateFlow = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setFlowStep('create_name');
    appendItems([aiBubble(t('ai_chat.flow.prompt_name'))]);
  }, [appendItems, t]);

  const startManage = useCallback(() => {
    if (!user?.id) {
      appendItems([aiBubble(t('ai_chat.flow.signin_required'))]);
      return;
    }
    appendItems([aiBubble(t('ai_chat.manage.title'), { kind: 'manage_list' })]);
  }, [appendItems, t, user?.id]);

  const startEditFlow = useCallback(
    (app: MiniApp) => {
      setDraft({
        editingId: app.id,
        name: app.name,
        emoji: app.emoji,
        url: app.url,
        description: app.description || '',
      });
      setFlowStep('edit_name');
      appendItems([aiBubble(`${t('ai_chat.flow.prompt_name')} (${app.name})`)]);
    },
    [appendItems, t],
  );

  const handleDeleteApp = useCallback(
    (app: MiniApp) => {
      Alert.alert(t('ai_chat.manage.delete_title'), `${app.emoji} ${app.name}`, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            await useMiniAppsStore.getState().deleteApp(app.id);
            showToast(t('ai_chat.manage.deleted'), 'trash-2');
          },
        },
      ]);
    },
    [t],
  );

  // Share — produces an internal short share URL via buildMiniAppShareUrl.
  // The underlying app.url is intentionally NOT included; the recipient
  // resolves it through the SSR landing page or the in-app deep-link
  // handler depending on whether they have the app installed.
  const handleShareApp = useCallback(
    async (app: MiniApp) => {
      triggerHaptic('light');
      try {
        await Share.share({
          message: `${app.emoji} ${app.name}\n${buildMiniAppShareUrl(app)}`,
        });
      } catch {}
    },
    [],
  );

  const runCommand = useCallback(
    (id: CommandId) => {
      setCommandsOpen(false);
      triggerHaptic('light');
      if (id === 'create') startCreateFlow();
      else if (id === 'manage') startManage();
    },
    [startCreateFlow, startManage],
  );

  // Pick-emoji → advance flow. Used for both create_emoji and edit_emoji.
  const handleEmojiPicked = useCallback(
    (e: string) => {
      setDraft((d) => ({ ...d, emoji: e }));
      setEmojiPickerOpen(false);
      const isEdit = flowStep === 'edit_emoji';
      setFlowStep(isEdit ? 'edit_url' : 'create_url');
      appendItems([userBubble(e), aiBubble(t('ai_chat.flow.prompt_url'))]);
    },
    [flowStep, appendItems, t],
  );

  // Auto-open the emoji modal when entering an emoji step. Closing without a
  // pick cancels the flow back to idle so the user isn't stuck with the
  // text field steering an emoji decision.
  useEffect(() => {
    if (flowStep === 'create_emoji' || flowStep === 'edit_emoji') {
      // NOTE: Do NOT run LayoutAnimation.configureNext here. On weak Android
      // devices, firing a global LayoutAnimation on the exact frame the
      // EmojiPickerModal mounts forces the whole inverted bubble FlatList to
      // be measured/animated on the same frame the Modal's native view is
      // constructed — that collision produced a single catastrophic jank
      // frame (perfMonitor: chat/ai worstFps 2). The modal already runs its
      // own smooth entrance animation (slide + scale + backdrop, native
      // driver) in EmojiPickerModal.tsx, so the "smooth flow" feel is
      // preserved without stacking a full-list layout animation on top.
      //
      // We reach this step from handleSend's name branch, which on the SAME
      // tick fires appendItems → LayoutAnimation.configureNext on the inverted
      // bubble list. Mounting the Modal's native view while that list layout
      // animation is still committing produces a residual single-frame UI
      // thread stall (perfMonitor: ui<30 @ chat/ai, chat/ai worstFps 3).
      // Defer the open by one interaction tick so the bubble-append layout has
      // committed before the Modal mounts. Cancelled on cleanup so a fast
      // Back/cancel (flowStep moving away) never opens a stale picker.
      const handle = InteractionManager.runAfterInteractions(() => setEmojiPickerOpen(true));
      return () => handle.cancel();
    }
    // Close path stays synchronous — Back / cancel / pick must hide the picker
    // immediately with no flicker.
    setEmojiPickerOpen(false);
  }, [flowStep]);

  const cancelFlow = useCallback(() => {
    setFlowStep('idle');
    setDraft(EMPTY_DRAFT);
    setEmojiPickerOpen(false);
    appendItems([aiBubble(t('ai_chat.flow.cancelled'))]);
  }, [appendItems, t]);

  // Step the conversational flow back one prompt. From the first step
  // (create_name / edit_name) Back fully cancels the flow. From the
  // emoji and url steps, Back returns to the previous prompt while
  // preserving the partially-typed draft so the user only re-confirms.
  const handleFlowBack = useCallback(() => {
    triggerHaptic('light');
    switch (flowStep) {
      case 'create_name':
      case 'edit_name':
        // Step 1 → cancel the whole flow.
        cancelFlow();
        return;
      case 'create_emoji':
        // Pre-fill the input with the draft name so re-confirmation is one tap.
        setFlowStep('create_name');
        setEmojiPickerOpen(false);
        if (draft.name) setInput(draft.name);
        appendItems([aiBubble(t('ai_chat.flow.prompt_name'))]);
        return;
      case 'edit_emoji':
        setFlowStep('edit_name');
        setEmojiPickerOpen(false);
        if (draft.name) setInput(draft.name);
        appendItems([aiBubble(`${t('ai_chat.flow.prompt_name')} (${draft.name})`)]);
        return;
      case 'create_url':
        // Bounce back to the emoji step — the auto-open useEffect will
        // re-show the picker. The previously chosen emoji stays in draft.
        setFlowStep('create_emoji');
        appendItems([aiBubble(t('ai_chat.flow.prompt_emoji'))]);
        return;
      case 'edit_url':
        setFlowStep('edit_emoji');
        appendItems([aiBubble(t('ai_chat.flow.prompt_emoji'))]);
        return;
      default:
        return;
    }
  }, [flowStep, draft.name, cancelFlow, appendItems, t]);

  const inFlow =
    flowStep === 'create_name' ||
    flowStep === 'create_emoji' ||
    flowStep === 'create_url' ||
    flowStep === 'edit_name' ||
    flowStep === 'edit_emoji' ||
    flowStep === 'edit_url';

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    triggerHaptic('light');

    // ── Flow branch ────────────────────────────────────────────────────────
    // If a create / edit flow is active, the message bypasses the LLM
    // entirely — it's data for the state machine, never an AI prompt.
    if (flowStep === 'create_name' || flowStep === 'edit_name') {
      const isEdit = flowStep === 'edit_name';
      setDraft((d) => ({ ...d, name: text }));
      setFlowStep(isEdit ? 'edit_emoji' : 'create_emoji');
      appendItems([userBubble(text), aiBubble(t('ai_chat.flow.prompt_emoji'))]);
      return;
    }
    if (flowStep === 'create_url' || flowStep === 'edit_url') {
      const isEdit = flowStep === 'edit_url';
      // Be lenient — accept "example.com" as well as full URLs.
      const looksLikeUrl = /^(https?:\/\/|[\w-]+\.[\w-]+)/i.test(text);
      if (!looksLikeUrl) {
        appendItems([userBubble(text), aiBubble(t('ai_chat.flow.url_invalid'))]);
        return;
      }
      const finalUrl = text.startsWith('http') ? text : `https://${text}`;
      appendItems([userBubble(text)]);

      // Sign-in is required to publish a NEW app — keep this check BEFORE the
      // consent gate so we don't ask an unauthenticated user to agree to a
      // policy for a call that can't succeed. (Edits always have an owner.)
      if (!isEdit && !user?.id) {
        setFlowStep('idle');
        setDraft(EMPTY_DRAFT);
        appendItems([aiBubble(t('ai_chat.flow.signin_required'))]);
        return;
      }

      // Defer createApp / updateApp behind the content-policy consent dialog.
      // No worker call happens here — it fires only from handleConsentAccept.
      // The flow step stays put (the modal covers the input) and the draft is
      // preserved so Accept can read name/emoji/url and Decline can reset.
      setPendingSubmit({
        isEdit,
        finalUrl,
        name: draft.name,
        emoji: draft.emoji,
        description: draft.description,
        editingId: draft.editingId,
      });
      setConsentVisible(true);
      return;
    }
    if (flowStep === 'create_emoji' || flowStep === 'edit_emoji') {
      // The user typed instead of picking from the modal — treat what they
      // sent as the emoji choice. This lets people paste an unusual emoji
      // that isn't in our preset grid.
      const isEdit = flowStep === 'edit_emoji';
      setDraft((d) => ({ ...d, emoji: text }));
      setFlowStep(isEdit ? 'edit_url' : 'create_url');
      setEmojiPickerOpen(false);
      appendItems([userBubble(text), aiBubble(t('ai_chat.flow.prompt_url'))]);
      return;
    }

    // ── Default branch — regular AI request, untouched. ────────────────────
    const userMsg: AIMessage = { id: nowId(), role: 'user', content: text, timestamp: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    saveChatHistory(newMessages);

    setIsLoading(true);
    try {
      const recentMessages = newMessages.slice(-8).map(m => ({ role: m.role, content: m.content }));
      const response = await sendMessage(recentMessages);
      const { cleanText, actions } = parseActions(response);

      // Deduplicate actions (keep last). `theme` and `custom_theme` are
      // bucketed together — otherwise an AI reply that emits both would
      // apply a built-in theme AND create a custom one in the same turn,
      // which the user reads as a duplicate.
      const themeBucket = (a: ParsedAction) =>
        a.type === 'theme' || a.type === 'custom_theme' ? 'theme-class' : a.type;
      const deduped = actions.reduce((acc, a) => { acc.set(themeBucket(a), a); return acc; }, new Map<string, ParsedAction>());
      const uniqueActions = Array.from(deduped.values());

      const appliedActions: ParsedAction[] = [];
      for (const action of uniqueActions) {
        const success = await applyAction(action);
        appliedActions.push({ ...action, applied: success });
        if (success) triggerHaptic('medium');
      }

      const aiMsg: AIMessage = { id: nowId(), role: 'assistant', content: cleanText || (appliedActions.length > 0 ? t('ai_chat.done') : ''), actions: appliedActions.length > 0 ? appliedActions : undefined, timestamp: Date.now() };
      const finalMessages = [...newMessages, aiMsg];
      setMessages(finalMessages);
      saveChatHistory(finalMessages);
      getRemainingRequests().then(setRemaining);
    } catch {
      const errMsg: AIMessage = { id: nowId(), role: 'assistant', content: t('ai_chat.error_connection'), timestamp: Date.now() };
      setMessages(prev => [...prev, errMsg]);
    }
    setIsLoading(false);
  }, [input, isLoading, messages, t, flowStep, draft, user?.id, appendItems]);

  // Accept — the ONLY path from the AI chat that reaches the worker. Mirrors
  // the create_url/edit_url logic that used to run inline: a non-destructive
  // PATCH (updateApp) for edits, createApp for new publishes, then the
  // existing success / error bubble. Resets the flow afterward either way.
  const handleConsentAccept = useCallback(async () => {
    const submit = pendingSubmit;
    setConsentVisible(false);
    setPendingSubmit(null);
    if (!submit) return;

    if (submit.isEdit && submit.editingId) {
      const { error } = await useMiniAppsStore.getState().updateApp(submit.editingId, {
        name: submit.name,
        emoji: submit.emoji,
        url: submit.finalUrl,
      });
      setFlowStep('idle');
      setDraft(EMPTY_DRAFT);
      appendItems([
        aiBubble(error ? t('ai_chat.flow.create_error', undefined, { error }) : t('ai_chat.flow.update_success')),
      ]);
      return;
    }

    if (!user?.id) {
      setFlowStep('idle');
      setDraft(EMPTY_DRAFT);
      appendItems([aiBubble(t('ai_chat.flow.signin_required'))]);
      return;
    }
    const { error } = await useMiniAppsStore.getState().createApp({
      creator_id: user.id,
      name: submit.name,
      description: submit.description,
      emoji: submit.emoji,
      url: submit.finalUrl,
    });
    setFlowStep('idle');
    setDraft(EMPTY_DRAFT);
    appendItems([
      aiBubble(error ? t('ai_chat.flow.create_error', undefined, { error }) : t('ai_chat.flow.create_success')),
    ]);
  }, [pendingSubmit, appendItems, t, user?.id]);

  // Decline (or backdrop dismiss) — NO worker call. Surface a cancellation
  // notice and reset the flow + draft so the user lands cleanly back at idle.
  const handleConsentDecline = useCallback(() => {
    setConsentVisible(false);
    setPendingSubmit(null);
    setFlowStep('idle');
    setDraft(EMPTY_DRAFT);
    appendItems([aiBubble(t('ai_chat.flow.consent_declined'))]);
  }, [appendItems, t]);

  // Inverted data for FlatList — memoized to avoid re-reverse on every keystroke
  const invertedData = React.useMemo(() => [...messages].reverse(), [messages]);

  // ── Commands button — animated label/width (mirrors Music chat) ─────────
  // Collapsed = 40×40 circle (icon-only), expanded = ~140×40 pill with the
  // "Команды" label visible. Single Animated.Value drives label opacity AND
  // width so the text fades out a touch before the pill collapses, which
  // prevents a "squished" frame mid-animation. Width can't go through the
  // native driver, but since this only animates on empty↔non-empty input
  // transitions (≈once per typing session) it's effectively free.
  const commandExpand = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(commandExpand, {
      toValue: input.length === 0 ? 1 : 0,
      duration: 220,
      // INTENTIONAL JS-DRIVEN LAYOUT TWEEN — do not flag.
      // This animates `width` (a layout prop), which physically cannot run on
      // the native driver. A transform (scaleX) or opacity can't replace it
      // without changing the look: the pill REFLOWS from a 110px label-pill to
      // a 40px icon circle, and scaleX would squish the icon/label instead of
      // reflowing. It's a one-shot that fires only on the empty↔non-empty
      // input transition (≈once per typing session), so the JS-thread cost is
      // negligible. Left as-is deliberately.
      useNativeDriver: false,
    }).start();
  }, [input.length === 0]);
  const commandWidth = commandExpand.interpolate({ inputRange: [0, 1], outputRange: [40, 110] });
  const commandLabelW = commandExpand.interpolate({ inputRange: [0, 1], outputRange: [0, 64] });
  const commandLabelML = commandExpand.interpolate({ inputRange: [0, 1], outputRange: [0, 5] });
  const commandLabelOpacity = commandExpand.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });

  // Placeholder reflects the active step — gives the user a hint that the
  // text field is currently scoped to the conversational flow, not the LLM.
  const inputPlaceholder = (() => {
    switch (flowStep) {
      case 'create_name':
      case 'edit_name':
        return t('ai_chat.flow.prompt_name');
      case 'create_emoji':
      case 'edit_emoji':
        return t('ai_chat.flow.prompt_emoji');
      case 'create_url':
      case 'edit_url':
        return t('ai_chat.flow.prompt_url');
      default:
        return t('ai_chat.input_placeholder');
    }
  })();


  // Bubble-up handler from the per-message ThemeIconCarousel. Splices a
  // partial patch into the matching action object and re-saves the full
  // chat history exactly once per user interaction. Stable identity via
  // useCallback + functional setter so MessageBubble's memo doesn't break.
  const handleActionUpdate = useCallback(
    (
      messageId: string,
      type: ParsedAction['type'],
      patch: Partial<ParsedAction>,
    ) => {
      setMessages(prev => {
        let changed = false;
        const updated = prev.map(m => {
          if (m.id !== messageId || !m.actions) return m;
          const newActions = m.actions.map(a => {
            // Bind the patch to the exact action type the carousel
            // is mounted for. There's at most one theme-class action
            // per message (deduped on send) so this matches uniquely.
            if (a.type !== type) return a;
            const merged: ParsedAction = { ...a, ...patch };
            // `appliedIconId: undefined` (when the key is present in the
            // patch) is the "Pick again" reset — strip the field so the
            // persisted JSON stays clean and the carousel re-mounts as
            // fresh on a future open.
            if ('appliedIconId' in patch && patch.appliedIconId === undefined) {
              delete (merged as Partial<ParsedAction>).appliedIconId;
            }
            changed = true;
            return merged;
          });
          return { ...m, actions: newActions };
        });
        if (!changed) return prev;
        // Persist exactly once per call — no debounce, no churn.
        saveChatHistory(updated);
        return updated;
      });
    },
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatItem }) => {
      // Live management list — rendered as a special assistant bubble.
      // Reads from `useMiniAppsStore` directly so it stays fresh after
      // creates / edits / deletes triggered elsewhere in the app.
      if (item.kind === 'manage_list') {
        return (
          <View style={{ alignSelf: 'flex-start', maxWidth: '88%', marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <RNText style={{ fontSize: 14 }} allowFontScaling={false}>🤖</RNText>
              <Text variant="caption" weight="semibold" style={{ fontSize: 11 }}>San AI</Text>
              <VerifiedBadge size={10} />
            </View>
            <View style={{ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', borderRadius: 20, borderBottomLeftRadius: 6, paddingHorizontal: 14, paddingVertical: 10 }}>
              <Text style={{ fontSize: 14, color: theme.colors.text.primary, lineHeight: 20 }}>{item.content}</Text>
            </View>
            <ManageListBubble ownerId={user?.id} onEdit={startEditFlow} onDelete={handleDeleteApp} onShare={handleShareApp} />
          </View>
        );
      }
      return <MemoMessageBubble message={item} onActionUpdate={handleActionUpdate} />;
    },
    [handleActionUpdate, theme.isDark, theme.colors.text.primary, user?.id, startEditFlow, handleDeleteApp, handleShareApp],
  );

  // Memoize the list's header / footer / empty elements so a screen re-render
  // (e.g. every keystroke updating `input`) doesn't hand FlatList three brand
  // new element references and force it to reconcile them. Deps match exactly
  // the values each element reads — no behavior/visual change.
  const listHeader = useMemo(
    () => (
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
        <View style={{ height: LIST_BOTTOM_SPACER }} />
      </>
    ),
    [isLoading, LIST_BOTTOM_SPACER, t],
  );

  const listFooter = useMemo(
    () => <View style={{ height: insets.top + 72 }} />,
    [insets.top],
  );

  const listEmpty = useMemo(
    () => (
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
    ),
    [t, theme.colors.text.tertiary],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 }}>
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.7, 1]} style={{ paddingTop: insets.top + 8, paddingBottom: 20, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} style={glassActive ? { borderRadius: 17 } : { borderRadius: 17, overflow: 'hidden' }}>
              {glassActive ? (
                <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="chevron-left" size={18} color="#FFFFFF" />
                </NativeGlassView>
              ) : chromeReady ? (
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

      {/* Inverted FlatList — newest at bottom. Content repositioning on
          keyboard open/close is handled natively by KeyboardChatScrollView
          via `renderScrollComponent` (default "always" lift). The bottom
          spacer below stays a STATIC height — it only reserves room for the
          floating input bar while the keyboard is closed. */}
      <FlatList
        ref={flatListRef}
        data={invertedData}
        keyExtractor={keyExtractor}
        inverted
        renderScrollComponent={renderScrollComponent}
        contentContainerStyle={LIST_CONTENT_CONTAINER_STYLE}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        removeClippedSubviews={false}
        // Tightened from 12/8/9 — same fix as chat/music. 12 MessageBubbles
        // on first paint piled up on the navigation transition frame.
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={5}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        ListEmptyComponent={listEmpty}
      />

      {/* Static under-input fade — pinned to the screen bottom and kept
          OUTSIDE the KeyboardStickyView so it does NOT ride up with the
          keyboard. Mirrors the user-chat under-input gradient: the solid
          input container is gone, so messages scroll UNDER the input and
          dissolve into the background instead of hitting a hard bar edge. */}
      <LinearGradient
        colors={[theme.colors.background.primary + '00', theme.colors.background.primary + 'B3', theme.colors.background.primary]}
        locations={[0, 0.45, 1]}
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: INPUT_BAR + insets.bottom + 56 }}
      />

      {/* Input — sticks to keyboard (smooth, no lag). No solid backgroundColor:
          the fade above supplies the darkening so the input floats over content
          like the user chat. */}
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Reanimated.View style={[{ paddingHorizontal: 16, paddingTop: 8 }, inputPadStyle]}>
          {/* Commands drawer — anchored ABOVE the input row, slides in via
              LayoutAnimation when toggled. Same pattern as Music chat. */}
          {commandsOpen ? (
            <View style={{ marginBottom: 8, borderRadius: 18, overflow: 'hidden', ...(glassActive ? null : { backgroundColor: theme.colors.background.elevated, borderWidth: 1, borderColor: theme.colors.border.light }) }}>
              {glassActive ? <GlassBg borderRadius={18} colorScheme={theme.isDark ? 'dark' : 'light'} /> : null}
              {COMMANDS.map((c, i) => (
                <Pressable
                  key={c.id}
                  onPress={() => runCommand(c.id)}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 0.5, borderTopColor: theme.colors.border.light }}
                >
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.accent.primary + '15', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                    <Feather name={c.icon as any} size={15} color={theme.colors.accent.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="caption" weight="semibold" style={{ fontSize: 13 }}>{c.label}</Text>
                    <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ fontSize: 11, marginTop: 1 }}>{c.description}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            {/* Commands button — same VISUAL height as the input bubble (40px),
                width animates between full label and icon-only via a single
                Animated.Value. Mirrors `app/chat/music.tsx` so both AI and
                Music chats share the same input-bar geometry.
                When the user is in a conversational flow step, this slot
                instead renders a Back button so the geometry stays put. */}
            {inFlow ? (
              <Pressable
                onPress={handleFlowBack}
                hitSlop={6}
                accessibilityLabel={t('ai_chat.flow.back')}
                style={{
                  width: 40,
                  height: 40,
                  alignSelf: 'flex-end',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 20,
                  // Neutral button — when liquid glass is on, drop the flat
                  // fill/border and the clip so the interactive glass child
                  // can morph outward; otherwise the flat capsule is unchanged.
                  ...(glassActive
                    ? null
                    : { backgroundColor: theme.isDark ? 'rgba(40,40,40,0.95)' : 'rgba(245,245,245,0.95)', borderWidth: 1, borderColor: theme.colors.border.light }),
                }}
              >
                {glassActive ? (
                  <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: 20 }}>
                    <Feather name="arrow-left" size={16} color={theme.colors.text.secondary} />
                  </NativeGlassView>
                ) : (
                  <Feather name="arrow-left" size={16} color={theme.colors.text.secondary} />
                )}
              </Pressable>
            ) : (
              <Animated.View style={{ width: commandWidth, height: 40, alignSelf: 'flex-end', overflow: 'hidden' }}>
                <Pressable
                  onPress={() => { triggerHaptic('light'); setCommandsOpen((v) => !v); }}
                  hitSlop={6}
                  style={{
                    width: '100%',
                    height: '100%',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    // 20 = 50% of 40, so collapsed (40×40) is a perfect circle.
                    // Expanded (110×40) keeps the same 20px radius.
                    borderRadius: 20,
                    // Active (commandsOpen) keeps the solid accent fill. When
                    // idle AND liquid glass is on, drop the flat fill/border and
                    // the clip so the interactive glass child can morph outward;
                    // otherwise the original flat capsule renders unchanged.
                    ...(commandsOpen
                      ? { backgroundColor: theme.colors.accent.primary, borderWidth: 1, borderColor: theme.colors.border.light }
                      : glassActive
                        ? null
                        : { backgroundColor: theme.isDark ? 'rgba(40,40,40,0.95)' : 'rgba(245,245,245,0.95)', borderWidth: 1, borderColor: theme.colors.border.light }),
                  }}
                >
                  {!commandsOpen && glassActive ? (
                    // Idle state → interactive liquid glass holding the icon +
                    // label as CHILDREN so the glass morphs outward on touch.
                    <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={{ width: '100%', height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 20 }}>
                      <Feather name="command" size={16} color={theme.colors.accent.primary} />
                      <Animated.Text
                        numberOfLines={1}
                        allowFontScaling={false}
                        style={{
                          width: commandLabelW,
                          marginLeft: commandLabelML,
                          opacity: commandLabelOpacity,
                          fontSize: 12,
                          fontWeight: '600',
                          color: theme.colors.accent.primary,
                        }}
                      >{t('ai_chat.commands_label')}</Animated.Text>
                    </NativeGlassView>
                  ) : (
                    <>
                      <Feather name="command" size={16} color={commandsOpen ? '#FFFFFF' : theme.colors.accent.primary} />
                      <Animated.Text
                        numberOfLines={1}
                        allowFontScaling={false}
                        style={{
                          width: commandLabelW,
                          marginLeft: commandLabelML,
                          opacity: commandLabelOpacity,
                          fontSize: 12,
                          fontWeight: '600',
                          color: commandsOpen ? '#FFFFFF' : theme.colors.accent.primary,
                        }}
                      >{t('ai_chat.commands_label')}</Animated.Text>
                    </>
                  )}
                </Pressable>
              </Animated.View>
            )}

            {glassActive ? (
              // Input wrap → interactive liquid glass holding the TextInput +
              // send button as CHILDREN, matching ChatInputBar. NO visible
              // border (the glass supplies the edge) and NO overflow clip so
              // the glass can morph outward on touch.
              <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, minHeight: 40 }}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder={inputPlaceholder}
                  placeholderTextColor={theme.colors.text.tertiary}
                  multiline
                  textAlignVertical="center"
                  style={{ flex: 1, fontSize: 14, color: theme.colors.text.primary, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20, alignSelf: 'center' }}
                  onContentSizeChange={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); }}
                />
                <Pressable onPress={handleSend} disabled={!input.trim() || isLoading} style={{ alignSelf: 'flex-end', width: 28, height: 28, borderRadius: 14, backgroundColor: input.trim() ? theme.colors.accent.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginLeft: 8, marginBottom: 1 }}>
                  <Feather name="send" size={13} color={input.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
                </Pressable>
              </NativeGlassView>
            ) : (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, minHeight: 40, backgroundColor: theme.isDark ? 'rgba(40,40,40,0.95)' : 'rgba(245,245,245,0.95)', borderWidth: 1, borderColor: theme.colors.border.light }}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder={inputPlaceholder}
                  placeholderTextColor={theme.colors.text.tertiary}
                  multiline
                  textAlignVertical="center"
                  style={{ flex: 1, fontSize: 14, color: theme.colors.text.primary, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20, alignSelf: 'center' }}
                  onContentSizeChange={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); }}
                />
                <Pressable onPress={handleSend} disabled={!input.trim() || isLoading} style={{ alignSelf: 'flex-end', width: 28, height: 28, borderRadius: 14, backgroundColor: input.trim() ? theme.colors.accent.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginLeft: 8, marginBottom: 1 }}>
                  <Feather name="send" size={13} color={input.trim() ? '#FFFFFF' : theme.colors.text.tertiary} />
                </Pressable>
              </View>
            )}
          </View>
        </Reanimated.View>
      </KeyboardStickyView>

      {/* Emoji picker — auto-shown during the create_emoji / edit_emoji
          steps. Closing without a pick cancels the flow back to idle so
          the user isn't left with the input field steering an emoji
          decision. */}
      <EmojiPickerModal
        visible={emojiPickerOpen}
        onClose={() => {
          if (flowStep === 'create_emoji' || flowStep === 'edit_emoji') {
            cancelFlow();
          } else {
            setEmojiPickerOpen(false);
          }
        }}
        onSelect={handleEmojiPicked}
      />

      {/* Content-policy consent gate — stands between the final url step and
          any createApp / updateApp worker call, matching the settings screen.
          Accept publishes/updates; Decline (or backdrop dismiss) cancels with
          no network call. `mode` follows whichever submission is pending. */}
      <MiniAppConsentDialog
        visible={consentVisible}
        mode={pendingSubmit?.isEdit ? 'edit' : 'publish'}
        onAccept={handleConsentAccept}
        onDecline={handleConsentDecline}
      />
    </View>
  );
}
