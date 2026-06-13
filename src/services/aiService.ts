import { useThemeStore, ACCENT_COLORS } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const API_KEY = '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';
const MODEL = 'meta/llama-3.3-70b-instruct';
const DAILY_LIMIT = 50;
const RATE_KEY = '@san:ai_usage';
const CHAT_HISTORY_KEY = '@san:ai_chat';

// ─── Rate Limiting ───────────────────────────────────────────────────────────

interface UsageData { date: string; count: number; }

export async function getRemainingRequests(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(RATE_KEY);
    if (!raw) return DAILY_LIMIT;
    const data: UsageData = JSON.parse(raw);
    const today = new Date().toISOString().split('T')[0];
    if (data.date !== today) return DAILY_LIMIT;
    return Math.max(0, DAILY_LIMIT - data.count);
  } catch { return DAILY_LIMIT; }
}

async function incrementUsage(): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  try {
    const raw = await AsyncStorage.getItem(RATE_KEY);
    let data: UsageData = { date: today, count: 0 };
    if (raw) {
      data = JSON.parse(raw);
      if (data.date !== today) data = { date: today, count: 0 };
    }
    if (data.count >= DAILY_LIMIT) return false;
    data.count++;
    await AsyncStorage.setItem(RATE_KEY, JSON.stringify(data));
    return true;
  } catch { return true; }
}

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const user = useAuthStore.getState().user;
  const themeState = useThemeStore.getState();
  const currentTheme = ACCENT_COLORS.find(c => c.key === themeState.accent);

  return `Ты — San AI, ассистент приложения San. Отвечай на русском, коротко и по делу. Ты дружелюбный и понимаешь контекст.

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

О San: соцсеть, посты, чаты, мини-приложения, оффлайн, форматирование. Данные в безопасности.`;
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
        await supabase.from('profiles').update({ display_name: action.value }).eq('id', user.id);
        useAuthStore.getState().updateProfile({ displayName: action.value });
        return true;
      }
      case 'emoji': {
        const user = useAuthStore.getState().user;
        if (!user) return false;
        await supabase.from('profiles').update({ emoji: action.value }).eq('id', user.id);
        useAuthStore.getState().updateProfile({ emoji: action.value });
        return true;
      }
      case 'username': {
        const user = useAuthStore.getState().user;
        if (!user) return false;
        const clean = action.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
        if (!clean) return false;
        const { error } = await supabase.from('profiles').update({ username: clean }).eq('id', user.id);
        if (error) return false;
        useAuthStore.getState().updateProfile({ username: clean });
        return true;
      }
      case 'bio': {
        const user = useAuthStore.getState().user;
        if (!user) return false;
        await supabase.from('profiles').update({ bio: action.value }).eq('id', user.id);
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
        await supabase.from('profiles').update({ links }).eq('id', user.id);
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
  // Check rate limit
  const allowed = await incrementUsage();
  if (!allowed) {
    return 'Лимит запросов на сегодня исчерпан (50/день). Попробуй завтра!';
  }

  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: buildSystemPrompt() }, ...messages],
    temperature: 0.6,
    max_tokens: 300,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 429) return 'Слишком много запросов. Подожди немного.';
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Не удалось получить ответ.';
  } catch (e: any) {
    clearTimeout(timeout);
    if (e?.name === 'AbortError') return 'Превышено время ожидания. Попробуй ещё раз.';
    throw e;
  }
}

// ─── Chat Persistence ────────────────────────────────────────────────────────

export async function saveChatHistory(messages: AIMessage[]): Promise<void> {
  try {
    // Keep last 50 messages
    const toSave = messages.slice(-50);
    await AsyncStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(toSave));
  } catch {}
}

export async function loadChatHistory(): Promise<AIMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}
