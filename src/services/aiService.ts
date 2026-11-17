import { useThemeStore, ACCENT_COLORS } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useAccountsStore } from '../store/accountsStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { kvGetJSONSync, kvGetStringSync, kvSetJSON, kvSetString } from './kvStore';
import { t, useI18nStore } from '../i18n/store';

const API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
// SECURITY: this key ships inside the app bundle, so anyone can extract it. It should live behind
// a server proxy (the Worker) and be rotated; tracked as an open item, not fixed here.
const API_KEY = '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';
// Tried in order. NVIDIA retires hosted models on a schedule: `meta/llama-3.3-70b-instruct`
// answers 410 Gone since 2026-08-26, and with a single hard-coded model that turned every San AI
// request into «Ошибка подключения». A retired model (404/410) is skipped for the rest of the
// session; one that is merely unavailable (400/5xx) is skipped for that request only.
// Measured 2026-11-17 with the real system prompt, thinking disabled: super 0.8–3 s, ultra
// 0.9–5 s, lightning 0.7–1.5 s, all emitting the [ACTION:...] tags correctly.
const MODELS = [
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
];
const retiredModels = new Set<string>();
export const AI_DAILY_LIMIT = 50;
const DAILY_LIMIT = AI_DAILY_LIMIT;

// Per-account keys (kvStore prefixes them with the active account). They used to be global
// AsyncStorage keys, so switching account showed the previous account's AI conversation.
const USAGE_KEY = 'ai_usage';
const HISTORY_KEY = 'ai_chat_history';
const CONSENT_KEY = 'ai_consent_v1';
const LEGACY_HISTORY_KEY = '@san:ai_chat';
const LEGACY_USAGE_KEY = '@san:ai_usage';

// ─── Consent ─────────────────────────────────────────────────────────────────
//
// Replies come from a third-party model host (NVIDIA). Before the first request the user is told
// exactly what is sent and agrees; nothing is sent without that. Stored per account.

export function hasAiConsent(): boolean {
  return kvGetStringSync(CONSENT_KEY) === '1';
}

export function grantAiConsent(): void {
  kvSetString(CONSENT_KEY, '1');
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

interface UsageData { date: string; count: number; }

const today = () => new Date().toISOString().split('T')[0];

export function getRemainingRequestsSync(): number {
  const data = kvGetJSONSync<UsageData | null>(USAGE_KEY, null);
  if (!data || data.date !== today()) return DAILY_LIMIT;
  return Math.max(0, DAILY_LIMIT - (Number(data.count) || 0));
}

export async function getRemainingRequests(): Promise<number> {
  return getRemainingRequestsSync();
}

function incrementUsage(): boolean {
  const d = today();
  let data = kvGetJSONSync<UsageData | null>(USAGE_KEY, null);
  if (!data || data.date !== d) data = { date: d, count: 0 };
  if (data.count >= DAILY_LIMIT) return false;
  kvSetJSON(USAGE_KEY, { date: d, count: data.count + 1 });
  return true;
}

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const user = useAuthStore.getState().user;
  const themeState = useThemeStore.getState();
  const currentTheme = ACCENT_COLORS.find(c => c.key === themeState.accent);

  const replyLanguage = useI18nStore.getState().locale === 'en' ? 'английском (English)' : 'русском';

  return `Ты — San AI, ассистент приложения San. Отвечай на ${replyLanguage}, если пользователь сам не пишет на другом языке; коротко и по делу. Ты дружелюбный и понимаешь контекст.

Текущий пользователь: ${user?.displayName || 'Пользователь'} (@${user?.username || 'user'}), эмодзи: ${user?.emoji || '😊'}
Текущая тема: ${currentTheme?.label || 'Стандартная'} (${themeState.accent}), режим: ${themeState.mode}

СТРОГИЕ ПРАВИЛА:
1. НЕ выполняй действия если пользователь НЕ ПРОСИЛ явно. "Привет" — это НЕ просьба.
2. Если пользователь говорит "не меняй"/"не надо" — НЕ включай теги.
3. Включай тег ТОЛЬКО при прямой просьбе: "смени", "поменяй", "сделай", "хочу".
4. Если сомневаешься — СПРОСИ.
5. НИКОГДА не используй белый (#FFFFFF) или очень светлые цвета как основной цвет темы.
6. ОДНА тема за один ответ. Либо [ACTION:theme:...] (переключение на встроенную), ЛИБО [ACTION:custom_theme:...] (создание новой). НИКОГДА не добавляй оба тега в одном ответе.
7. Если создаёшь НОВУЮ тему — используй ТОЛЬКО [ACTION:custom_theme:Название:#hex]. НЕ дублируй её через [ACTION:theme:...].
8. Если переключаешь на СУЩЕСТВУЮЩУЮ тему из списка — используй ТОЛЬКО [ACTION:theme:ключ]. НЕ добавляй custom_theme.
9. Тег — ЕДИНСТВЕННЫЙ способ что-то изменить. Без тега ничего не произойдёт. НИКОГДА не пиши «готово», «применена», «включён», если в этом же ответе нет нужного тега.

Теги действий (ТОЛЬКО при явной просьбе):
[ACTION:theme:ключ] — применить существующую тему
[ACTION:custom_theme:название:hex_цвет] — создать новую тему с указанным цветом (НЕ белый, НЕ светлый!)
[ACTION:mode:dark] или [ACTION:mode:light] — режим
[ACTION:name:Имя] — сменить имя
[ACTION:emoji:🎭] — сменить эмодзи
[ACTION:username:nick] — сменить юзернейм
[ACTION:bio:текст] — сменить био
[ACTION:links:url1,url2,url3] — добавить ссылки в профиль (до 3, через запятую)
[ACTION:font:inter|system|serif|mono] — шрифт

Существующие темы (используй их в первую очередь): ${ACCENT_COLORS.map(c => `${c.key}(${c.label})`).join(', ')}

Если ни одна тема не подходит — создай кастомную через [ACTION:custom_theme:Название:hex]. Цвет должен быть насыщенным, НЕ белым, НЕ слишком светлым. Примеры хороших цветов: #6B4EFF, #FF6B6B, #4ECDC4, #2D3436.

Примеры правильного использования (ВНИМАНИЕ к правилам 6-8):
✅ Переключить: "Готово, тема Шалфей применена!" + [ACTION:theme:sage]
✅ Создать новую: "Создал тему Sunset Vibes!" + [ACTION:custom_theme:Sunset Vibes:#FF6A88]
❌ НЕПРАВИЛЬНО: [ACTION:theme:sage] + [ACTION:custom_theme:Mint:#4ECDC4]   ← никогда не отправляй ОБА
❌ НЕПРАВИЛЬНО: [ACTION:custom_theme:Sunset:#FF6A88] + [ACTION:theme:sunset]   ← дубликат, не нужен

Подбор по настроению:
- Спокойный → sage, mint, arctic, teal
- Энергичный → coral, sunset, cherry, crimson
- Минималистичный → slate, indigo, sapphire
- Тёплый → peach, gold, amber, copper
- Природный → forest, emerald, olive
- Романтичный → rose, lavender, berry, plum

О San: мессенджер с чатами, профилями с публикациями, музыкой и мини-приложениями.`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ParsedAction[];
  timestamp: number;
}

export interface ParsedAction {
  type: 'theme' | 'custom_theme' | 'mode' | 'name' | 'emoji' | 'username' | 'bio' | 'font' | 'links';
  value: string;
  applied?: boolean;
  /**
   * Per-message persistence for the AI-theme icon-picker carousel.
   * Only meaningful on `theme` / `custom_theme` actions that successfully
   * applied. Three states:
   *   - `undefined` — user has not yet engaged with the icon prompt; the
   *     bubble re-mount renders the carousel as fresh.
   *   - `string`    — user picked this pixel-icon id; bubble renders the
   *     compact "Icon applied · <title> · Undo" confirmation row.
   *   - `null`      — user explicitly declined an icon (Undo was tapped);
   *     bubble renders a "No icon · Re-pick" row that, when tapped, sets
   *     this back to `undefined` to reopen the carousel.
   * Persisted alongside the rest of the action via `saveChatHistory`.
   */
  appliedIconId?: string | null;
}

/**
 * A transcript message as the model should see it. Replies are stored with their [ACTION:...]
 * tags parsed out (`cleanText`), so the history sent back read «Готово, тема применена!» with no
 * tag, and the model copied that: the next theme request came back as text only and changed
 * nothing. Putting the tags back keeps the history consistent with the format it must produce.
 */
export function toModelMessage(m: AIMessage): { role: string; content: string } {
  if (m.role !== 'assistant' || !m.actions || m.actions.length === 0) {
    return { role: m.role, content: m.content };
  }
  const tags = m.actions.map((a) => `[ACTION:${a.type}:${a.value}]`).join(' ');
  return { role: m.role, content: `${m.content} ${tags}`.trim() };
}

// ─── Action Parsing ──────────────────────────────────────────────────────────

export function parseActions(text: string): { cleanText: string; actions: ParsedAction[] } {
  const actions: ParsedAction[] = [];
  // Parse custom_theme first (3 parts)
  let cleaned = text.replace(/\[ACTION:custom_theme:([^:]+):([^\]]+)\]/g, (_, name, color) => {
    actions.push({ type: 'custom_theme', value: `${name.trim()}:${color.trim()}` });
    return '';
  });
  // Parse regular actions
  cleaned = cleaned.replace(/\[ACTION:(\w+):([^\]]+)\]/g, (_, type, value) => {
    actions.push({ type: type.trim() as ParsedAction['type'], value: value.trim() });
    return '';
  });
  // Also catch backtick-wrapped actions (model sometimes wraps in code)
  cleaned = cleaned.replace(/`\[ACTION:(\w+):([^\]]+)\]`/g, (_, type, value) => {
    actions.push({ type: type.trim() as ParsedAction['type'], value: value.trim() });
    return '';
  });
  // Catch ACTION without brackets (model sometimes forgets brackets)
  cleaned = cleaned.replace(/ACTION:(\w+):([^\s\]`]+)/g, (_, type, value) => {
    if (!actions.find(a => a.type === type.trim() && a.value === value.trim())) {
      actions.push({ type: type.trim() as ParsedAction['type'], value: value.trim() });
    }
    return '';
  });
  return { cleanText: cleaned.trim(), actions };
}

// ─── Action Execution ────────────────────────────────────────────────────────

export async function applyAction(action: ParsedAction): Promise<boolean> {
  try {
    switch (action.type) {
      case 'theme': {
        const allThemes = [...ACCENT_COLORS, ...useThemeStore.getState().aiThemes];
        const theme = allThemes.find(c => c.key === action.value);
        if (theme) {
          useThemeStore.getState().setAccent(action.value);
          // Auto-switch to dark mode for better theme visibility
          useThemeStore.getState().setMode('dark');
          return true;
        }
        return false;
      }
      case 'custom_theme': {
        // Format: "Название:hex_цвет"
        const parts = action.value.split(':');
        if (parts.length < 2) return false;
        const name = parts[0].trim();
        const color = parts[1].trim();
        if (!color.startsWith('#') || color.length < 4) return false;
        // Reject white/very light colors
        const hex = color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16) || 0;
        const g = parseInt(hex.substring(2, 4), 16) || 0;
        const b = parseInt(hex.substring(4, 6), 16) || 0;
        if (r > 240 && g > 240 && b > 240) return false; // pure white — reject

        const key = 'ai-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const darkBg = `#${Math.max(10, Math.floor(r * 0.1)).toString(16).padStart(2, '0')}${Math.max(10, Math.floor(g * 0.1)).toString(16).padStart(2, '0')}${Math.max(10, Math.floor(b * 0.1)).toString(16).padStart(2, '0')}`;
        const darkElevated = `#${Math.max(20, Math.floor(r * 0.15)).toString(16).padStart(2, '0')}${Math.max(20, Math.floor(g * 0.15)).toString(16).padStart(2, '0')}${Math.max(20, Math.floor(b * 0.15)).toString(16).padStart(2, '0')}`;
        const darkSecondary = `#${Math.max(14, Math.floor(r * 0.12)).toString(16).padStart(2, '0')}${Math.max(14, Math.floor(g * 0.12)).toString(16).padStart(2, '0')}${Math.max(14, Math.floor(b * 0.12)).toString(16).padStart(2, '0')}`;
        const darkBorder = `#${Math.max(30, Math.floor(r * 0.2)).toString(16).padStart(2, '0')}${Math.max(30, Math.floor(g * 0.2)).toString(16).padStart(2, '0')}${Math.max(30, Math.floor(b * 0.2)).toString(16).padStart(2, '0')}`;

        const newTheme = {
          key, label: `✨ ${name}`, color,
          light: '#F8F8F8', darkBg, darkElevated, darkSecondary, darkBorder,
        };
        useThemeStore.getState().addAiTheme(newTheme);
        useThemeStore.getState().setAccent(key);
        useThemeStore.getState().setMode('dark');
        return true;
      }
      case 'mode': {
        if (action.value === 'dark' || action.value === 'light') {
          useThemeStore.getState().setMode(action.value);
          return true;
        }
        return false;
      }
      case 'font': {
        const valid = ['inter', 'system', 'serif', 'mono'];
        if (valid.includes(action.value)) {
          useThemeStore.getState().setFontFamily(action.value as any);
          return true;
        }
        return false;
      }
      case 'name': {
        const user = useAuthStore.getState().user;
        if (!user) return false;
        const { updateProfile } = await import('../lib/supabase');
        await updateProfile(user.id, { display_name: action.value });
        useAuthStore.getState().updateProfile({ displayName: action.value });
        return true;
      }
      case 'emoji': {
        const user = useAuthStore.getState().user;
        if (!user) return false;
        const { updateProfile } = await import('../lib/supabase');
        await updateProfile(user.id, { emoji: action.value });
        useAuthStore.getState().updateProfile({ emoji: action.value });
        return true;
      }
      case 'username': {
        const user = useAuthStore.getState().user;
        if (!user) return false;
        const clean = action.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
        if (!clean) return false;
        const { updateProfile } = await import('../lib/supabase');
        const { error } = await updateProfile(user.id, { username: clean });
        if (error) return false;
        useAuthStore.getState().updateProfile({ username: clean });
        return true;
      }
      case 'bio': {
        const user = useAuthStore.getState().user;
        if (!user) return false;
        const { updateProfile } = await import('../lib/supabase');
        await updateProfile(user.id, { bio: action.value });
        useAuthStore.getState().updateProfile({ bio: action.value });
        return true;
      }
      case 'links': {
        const user = useAuthStore.getState().user;
        if (!user) return false;
        // Parse links from value: "url1,url2,url3" or "url1 url2 url3"
        const urls = action.value.split(/[,\s]+/).filter(u => u.startsWith('http'));
        const links = urls.map(url => {
          const lower = url.toLowerCase();
          let type = 'website';
          if (lower.includes('t.me') || lower.includes('telegram')) type = 'telegram';
          else if (lower.includes('instagram.com')) type = 'instagram';
          else if (lower.includes('github.com')) type = 'github';
          else if (lower.includes('twitter.com') || lower.includes('x.com')) type = 'twitter';
          else if (lower.includes('youtube.com')) type = 'youtube';
          else if (lower.includes('tiktok.com')) type = 'tiktok';
          else if (lower.includes('discord')) type = 'discord';
          return { type, url };
        });
        if (links.length === 0) return false;
        const { updateProfile } = await import('../lib/supabase');
        await updateProfile(user.id, { links } as any);
        useAuthStore.getState().updateProfile({ links } as any);
        return true;
      }
      default:
        return false;
    }
  } catch { return false; }
}

// ─── API Call ────────────────────────────────────────────────────────────────

export async function sendMessage(messages: { role: string; content: string }[]): Promise<string> {
  // The screen asks first; this is the backstop so no caller can send without consent.
  if (!hasAiConsent()) throw new Error('ai_consent_required');
  // Check rate limit
  const allowed = incrementUsage();
  if (!allowed) {
    return t('ai_chat.error_limit', undefined, { limit: DAILY_LIMIT });
  }

  const full = [{ role: 'system', content: buildSystemPrompt() }, ...messages];
  let lastError: unknown = null;
  for (const model of MODELS) {
    if (retiredModels.has(model)) continue;
    const res = await requestCompletion(model, full);
    switch (res.kind) {
      case 'ok':
        return res.text || t('ai_chat.error_empty');
      case 'busy':
        return t('ai_chat.error_busy');
      case 'timeout':
        return t('ai_chat.error_timeout');
      case 'retired':
        retiredModels.add(model);
        lastError = new Error(`model retired: ${model}`);
        continue;
      case 'unavailable':
        lastError = new Error(`model unavailable: ${model} (${res.status})`);
        continue;
      case 'error':
        throw res.error;
    }
  }
  throw lastError ?? new Error('no AI model available');
}

type CompletionResult =
  | { kind: 'ok'; text: string }
  | { kind: 'busy' }
  | { kind: 'timeout' }
  | { kind: 'retired' }
  | { kind: 'unavailable'; status: number }
  | { kind: 'error'; error: unknown };

async function requestCompletion(
  model: string,
  messages: { role: string; content: string }[],
): Promise<CompletionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        // Lower than the old 0.6: at 0.6 the replacement models sometimes wrote «тема применена»
        // and left out the [ACTION:...] tag, so nothing changed.
        temperature: 0.3,
        // Cyrillic costs more tokens per word; 300 cut longer Russian answers mid-list.
        max_tokens: 400,
        // These are reasoning models. With thinking on, the whole budget went to hidden
        // reasoning and `content` came back null after up to 60 s.
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: controller.signal,
    });
    if (response.status === 429) return { kind: 'busy' };
    if (response.status === 404 || response.status === 410) return { kind: 'retired' };
    if (response.status === 400 || response.status >= 500) return { kind: 'unavailable', status: response.status };
    if (!response.ok) return { kind: 'error', error: new Error(`API error: ${response.status}`) };
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    // Belt and braces: drop an inline reasoning block if a model emits one despite the flag.
    const text = typeof raw === 'string' ? raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim() : '';
    return { kind: 'ok', text };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { kind: 'timeout' };
    return { kind: 'error', error: e };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Chat Persistence ────────────────────────────────────────────────────────

/** Synchronous read so the screen opens with its history already on the first frame. */
export function loadChatHistorySync(): AIMessage[] {
  const v = kvGetJSONSync<AIMessage[] | null>(HISTORY_KEY, null);
  return Array.isArray(v) ? v : [];
}

export function saveChatHistory(messages: AIMessage[]): void {
  // Keep last 50 messages
  kvSetJSON(HISTORY_KEY, messages.slice(-50));
}

export async function loadChatHistory(): Promise<AIMessage[]> {
  return loadChatHistorySync();
}

/**
 * The history used to sit under one device-wide key. Move it into the account namespace once,
 * but only on a single-account device: with several accounts there is no telling whose it was,
 * and handing one account another's conversation is the leak this fixes, so it is dropped.
 * Returns the moved history, or null when there was nothing to move.
 */
export async function migrateLegacyAiStorage(): Promise<AIMessage[] | null> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_HISTORY_KEY);
    await AsyncStorage.multiRemove([LEGACY_HISTORY_KEY, LEGACY_USAGE_KEY]);
    if (!raw) return null;
    if (useAccountsStore.getState().accounts.length > 1) return null;
    if (loadChatHistorySync().length > 0) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    saveChatHistory(parsed);
    return parsed as AIMessage[];
  } catch {
    return null;
  }
}
