import { useThemeStore, ACCENT_COLORS } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../lib/supabase';

const API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const API_KEY = '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';
const MODEL = 'z-ai/glm-5.1';

const SYSTEM_PROMPT = `Ты — San AI, умный ассистент внутри приложения San (социальная сеть). Отвечай коротко, дружелюбно, на русском.

Ты можешь выполнять действия:
1. СМЕНИТЬ ТЕМУ — переключить цветовую тему приложения. Доступные темы: ${ACCENT_COLORS.map(c => c.key + ' (' + c.label + ')').join(', ')}
2. СМЕНИТЬ ИМЯ — изменить отображаемое имя пользователя
3. СМЕНИТЬ ЭМОДЗИ — изменить эмодзи-аватар пользователя
4. СМЕНИТЬ ЮЗЕРНЕЙМ — изменить @username
5. СМЕНИТЬ БИО — изменить описание профиля

Когда пользователь просит выполнить действие, ответь в формате:
[ACTION:тип:значение]

Примеры:
- Пользователь: "Хочу тему поярче" → Ответ: "Попробуй вот эту! [ACTION:theme:coral]"
- Пользователь: "Поменяй имя на Алекс" → Ответ: "Готово! [ACTION:name:Алекс]"
- Пользователь: "Поставь эмодзи кота" → Ответ: "Мяу! [ACTION:emoji:🐱]"
- Пользователь: "Юзернейм alex123" → Ответ: "Сделано! [ACTION:username:alex123]"
- Пользователь: "Напиши в био: люблю кодить" → Ответ: "Обновил! [ACTION:bio:люблю кодить]"

Если пользователь описывает настроение или стиль, подбери подходящую тему:
- Спокойный/расслабленный → sage, mint, arctic
- Энергичный/яркий → coral, sunset, cherry, crimson
- Тёмный/минималистичный → slate, indigo, sapphire
- Тёплый/уютный → peach, gold, amber, copper, sand
- Природный → forest, emerald, olive, teal
- Романтичный → rose, lavender, berry, plum, violet

Если не уверен что хочет пользователь — спроси. Не выполняй действия без явного запроса.
Ты знаешь политику конфиденциальности San: данные хранятся в Supabase, шифрование на уровне транспорта, никакие данные не передаются третьим лицам.`;

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ParsedAction[];
  timestamp: number;
}

export interface ParsedAction {
  type: 'theme' | 'name' | 'emoji' | 'username' | 'bio';
  value: string;
  applied?: boolean;
}

export function parseActions(text: string): { cleanText: string; actions: ParsedAction[] } {
  const actions: ParsedAction[] = [];
  const cleanText = text.replace(/\[ACTION:(\w+):([^\]]+)\]/g, (_, type, value) => {
    actions.push({ type: type as ParsedAction['type'], value });
    return '';
  }).trim();
  return { cleanText, actions };
}

export async function applyAction(action: ParsedAction): Promise<boolean> {
  try {
    switch (action.type) {
      case 'theme': {
        const theme = ACCENT_COLORS.find(c => c.key === action.value);
        if (theme) {
          useThemeStore.getState().setAccent(action.value);
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
        const { error } = await supabase.from('profiles').update({ username: action.value }).eq('id', user.id);
        if (error) return false;
        useAuthStore.getState().updateProfile({ username: action.value });
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
  } catch {
    return false;
  }
}

export async function sendMessage(messages: { role: string; content: string }[]): Promise<string> {
  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    temperature: 0.7,
    max_tokens: 512,
  };

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'Не удалось получить ответ';
}
