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
1. НЕ выполняй действия если пользователь НЕ ПРОСИЛ явно. "Привет" — это НЕ просьба менять тему.
2. Если пользователь говорит "не меняй" или "не надо" — НЕ включай теги действий.
3. Включай тег [ACTION:...] ТОЛЬКО когда пользователь ПРЯМО просит: "смени тему", "поменяй имя", "сделай тёмную" и т.п.
4. Если сомневаешься — СПРОСИ, а не делай.

Формат тегов (включай ТОЛЬКО при явной просьбе):
[ACTION:theme:ключ_темы] — сменить цветовую тему
[ACTION:mode:dark] или [ACTION:mode:light] — переключить режим
[ACTION:name:Новое Имя] — сменить имя
[ACTION:emoji:🎭] — сменить эмодзи
[ACTION:username:new_username] — сменить юзернейм
[ACTION:bio:Новое описание] — сменить био
[ACTION:font:inter] — сменить шрифт (inter, system, serif, mono)

Ключи тем: ${ACCENT_COLORS.map(c => c.key).join(', ')}
Названия: ${ACCENT_COLORS.map(c => `${c.key}=${c.label}`).join(', ')}

Подбор по настроению (предлагай, но НЕ применяй без подтверждения):
- Спокойный → sage, mint, arctic, teal
- Энергичный → coral, sunset, cherry, crimson
- Минималистичный → slate, indigo, sapphire
- Тёплый → peach, gold, amber, copper
- Природный → forest, emerald, olive
- Романтичный → rose, lavender, berry, plum

Пример правильного поведения:
Пользователь: "Привет" → "Привет! Чем могу помочь?" (БЕЗ тегов!)
Пользователь: "Хочу спокойную тему" → "Вот, попробуй! [ACTION:theme:sage]"
Пользователь: "Не надо менять" → "Хорошо, оставляю как есть!" (БЕЗ тегов!)

О San: социальная сеть, посты, чаты, мини-приложения, оффлайн, форматирование. Данные в безопасности.`;
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
  type: 'theme' | 'mode' | 'name' | 'emoji' | 'username' | 'bio' | 'font';
  value: string;
  applied?: boolean;
}

// ─── Action Parsing ──────────────────────────────────────────────────────────

export function parseActions(text: string): { cleanText: string; actions: ParsedAction[] } {
  const actions: ParsedAction[] = [];
  const cleanText = text.replace(/\[ACTION:(\w+):([^\]]+)\]/g, (_, type, value) => {
    actions.push({ type: type as ParsedAction['type'], value });
    return '';
  }).trim();
  return { cleanText, actions };
}

// ─── Action Execution ────────────────────────────────────────────────────────

export async function applyAction(action: ParsedAction): Promise<boolean> {
  try {
    switch (action.type) {
      case 'theme': {
        const theme = ACCENT_COLORS.find(c => c.key === action.value);
        if (theme) { useThemeStore.getState().setAccent(action.value); return true; }
        return false;
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
    temperature: 0.7,
    max_tokens: 1024,
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
