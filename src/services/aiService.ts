import { useThemeStore, ACCENT_COLORS } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const API_KEY = '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';
const MODEL = 'z-ai/glm-5.1';
const DAILY_LIMIT = 50;
const RATE_KEY = '@san:ai_usage';

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

  return `Ты — San AI, ассистент приложения San. Отвечай на русском, коротко и по делу. Ты дружелюбный, умный и понимаешь контекст.

Текущий пользователь: ${user?.displayName || 'Пользователь'} (@${user?.username || 'user'}), эмодзи: ${user?.emoji || '😊'}
Текущая тема: ${currentTheme?.label || 'Стандартная'} (${themeState.accent}), режим: ${themeState.mode}

Ты можешь выполнять действия через специальные теги. Используй их ТОЛЬКО когда пользователь явно просит что-то изменить:

[ACTION:theme:ключ] — сменить цветовую тему
[ACTION:mode:dark] или [ACTION:mode:light] — сменить режим (тёмный/светлый)
[ACTION:name:значение] — сменить имя
[ACTION:emoji:значение] — сменить эмодзи аватара
[ACTION:username:значение] — сменить юзернейм
[ACTION:bio:значение] — сменить описание профиля
[ACTION:font:inter|system|serif|mono] — сменить шрифт

Доступные темы: ${ACCENT_COLORS.map(c => `${c.key} (${c.label})`).join(', ')}

Ассоциации тем:
- Спокойствие: sage, mint, arctic, teal
- Энергия: coral, sunset, cherry, crimson, amber
- Минимализм: slate, indigo, sapphire, ocean
- Тепло: peach, gold, copper, sand
- Природа: forest, emerald, olive
- Романтика: rose, lavender, berry, plum, violet

Ты также знаешь:
- San — это социальная сеть с постами, чатами, мини-приложениями
- Данные хранятся безопасно, не передаются третьим лицам
- Приложение поддерживает оффлайн-режим, форматирование текста, верификацию

Если пользователь просто общается — общайся. Если описывает настроение — предложи тему. Если просит изменить что-то — выполни. Можешь предлагать несколько вариантов тем.`;
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
  const timeout = setTimeout(() => controller.abort(), 30000);

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
