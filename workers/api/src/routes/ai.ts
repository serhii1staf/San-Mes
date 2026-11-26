// San AI, through the Worker.
//
// POST /v1/ai/complete   Body: { model, messages: [{ role, content }] }
//                        → { status, text }: NVIDIA's HTTP status and the reply text (null unless 200)
//
// ── WHY THIS ROUTE EXISTS ───────────────────────────────────────────────────────────────────────
//
// The app called NVIDIA directly with an API key compiled into the bundle (src/services/aiService.ts),
// so anyone could unpack the app, take the key and spend the account's quota on anything. The key
// now lives only here, as a Worker secret, and the app sends its request to this route with its own
// session token. A request is limited to the San AI models, to San AI's own generation settings, and
// to a daily count per account kept in D1 (`ai_usage`, migration 0011), on top of the per-minute
// limit every heavy route has (guards.ts).
//
// What passes through is what the app already sent to NVIDIA (disclosed in the consent prompt and in
// the privacy policy §4). Nothing of it is stored or logged here; the only thing kept is the count.

import { fail, ok } from '../http';
import { register } from '../router';
import { queryOne, type Env } from '../db';

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

/**
 * Largest request body. The app sends its system prompt (about 4 KB) and the last 8 messages; the
 * shared 64 KB cap of `readJson` could refuse eight long Cyrillic messages, which went through when
 * the app called NVIDIA itself.
 */
const MAX_BODY = 256 * 1024;

async function readBody(req: Request): Promise<{ model?: unknown; messages?: unknown } | null> {
  const declared = Number(req.headers.get('Content-Length') || '0');
  if (Number.isFinite(declared) && declared > MAX_BODY) return null;
  try {
    const text = await req.text();
    if (!text || text.length > MAX_BODY) return null;
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as { model?: unknown; messages?: unknown }) : null;
  } catch {
    return null;
  }
}

/** The models San AI may ask for: the same list as `MODELS` in the app, which decides the order. */
const MODELS = new Set([
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
]);

/**
 * Requests per account per UTC day. The app stops at 50 a day by its own clock (`AI_DAILY_LIMIT`);
 * this is the server's limit for a client that does not, set a little higher so a day boundary in a
 * different time zone never refuses a request the app thinks is allowed. Each model tried counts.
 */
const DAILY_LIMIT = 150;

const MAX_MESSAGES = 60;
const MAX_CONTENT = 12000;
const UPSTREAM_TIMEOUT_MS = 40000;

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function readMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string') return null;
    out.push({ role, content: content.slice(0, MAX_CONTENT) });
  }
  return out;
}

/**
 * Counts this request against the account's day and says whether it is still within it. `bucket`
 * keeps another feature's count apart in the same table (its rows are `<bucket>:<day>`), so voice
 * input does not use up San AI's requests.
 */
async function withinDailyLimit(env: Env, userId: string, bucket = '', limit = DAILY_LIMIT): Promise<boolean> {
  const date = new Date().toISOString().slice(0, 10);
  const day = bucket ? `${bucket}:${date}` : date;
  try {
    const row = await queryOne<{ count: number }>(
      env,
      `INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1)
         ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1
       RETURNING count`,
      [userId, day],
    );
    return !row || Number(row.count) <= limit;
  } catch {
    // The count is a guard, not the feature: a failed write lets the request through, like the
    // rate limits do.
    return true;
  }
}

register('POST', '/v1/ai/complete', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  if (!env.NVIDIA_API_KEY) return fail(req, 'ai_not_configured', 503);

  const body = await readBody(req);
  if (!body) return fail(req, 'invalid body', 400);
  const model = typeof body.model === 'string' ? body.model : '';
  if (!MODELS.has(model)) return fail(req, 'invalid model', 400);
  const messages = readMessages(body.messages);
  if (!messages) return fail(req, 'invalid messages', 400);

  if (!(await withinDailyLimit(env, authedUserId))) return fail(req, 'daily_limit', 429);

  let upstream: Response;
  try {
    upstream = await fetch(NVIDIA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        // San AI's own settings (see `requestCompletion` in the app), fixed here so the key cannot be
        // used for anything longer or different.
        temperature: 0.3,
        max_tokens: 400,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
    return fail(req, timedOut ? 'upstream_timeout' : 'upstream_unreachable', 504);
  }

  if (!upstream.ok) {
    // The status decides what the app does next (busy, skip a retired model, try the next one), so
    // it is passed on; NVIDIA's error body is not.
    return ok(req, { status: upstream.status, text: null });
  }
  let text: string | null = null;
  try {
    const data = (await upstream.json()) as { choices?: { message?: { content?: unknown } }[] };
    const raw = data?.choices?.[0]?.message?.content;
    text = typeof raw === 'string' ? raw : null;
  } catch {
    return ok(req, { status: 502, text: null });
  }
  return ok(req, { status: 200, text });
});

// ── Voice input ─────────────────────────────────────────────────────────────────────────────────
//
// POST /v1/ai/transcribe   Body: { audio: base64 of the recording (AAC in .m4a, or WAV), lang?: 'ru' … }
//                          → { text }
//
// The chat composer's voice input (src/services/dictation.ts in the app) records while the user speaks
// and sends the recording here once, when they stop. Whisper large-v3-turbo on Workers AI (Cloudflare's
// hosting of the open model, zero data retention) turns it into text. Nothing of it is stored or logged
// here: the recording is passed through and only the text goes back; the only thing kept is the count.
//
// Why not the phone's own recogniser: that was the first version, and it was rejected for exactly
// what the feature was asked for, "the built-in one always misunderstands speech and phrases it
// strangely". Checked on Workers AI (Nov 2026): WAV and AAC/M4A both decode, and a spoken English
// test sentence came back word for word, numbers and punctuation included.

const WHISPER = '@cf/openai/whisper-large-v3-turbo';
/** About 6 MB of base64, i.e. minutes of the app's 32 kbit/s AAC (the app stops at 3 minutes). */
const TRANSCRIBE_MAX_BODY = 6 * 1024 * 1024;
/** Phrases a day (the app sends a dictation phrase by phrase, each at most 24 s). */
const TRANSCRIBE_DAILY_LIMIT = 1500;
/** Characters of context (`initial_prompt`): Whisper reads at most 224 tokens of it. */
const PROMPT_MAX = 300;
const LANGS = new Set(['ru', 'en', 'uk', 'be', 'kk', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'tr']);
/**
 * Whisper's well-known inventions on silence or noise, learned from film subtitles. Dropped only when
 * they are the whole result, so a real sentence that mentions subtitles is kept.
 */
const HALLUCINATIONS = [
  /^продолжение следует\.*$/i,
  /^субтитры (сделал|создавал|подготовил|делал)\b/i,
  /^редактор субтитров\b/i,
  /^спасибо за просмотр[.!]*$/i,
  /^(thanks|thank you) for watching[.!]*$/i,
];

// ── THE FIRST TRANSCRIPTION AFTER A PAUSE WAITED FOR THE MODEL (Nov 2026) ───────────────────────
//
// Measured: the same 8-second clip took 13.1 s the first time after a pause and 1.6 s right after
// (greedy decoding, `beam_size: 1`, was no faster: 2.1 s). The model is unloaded when it has not been
// used for a while, and loading it is most of that first wait. So the app calls
// `POST /v1/ai/transcribe/warm` the moment recording starts: it runs the model on 0.4 s of silence in
// the background and answers at once, and by the time the user has said their sentence the model is
// usually up. It counts against the per-minute limit, not the daily one.

let silentWavB64: string | null = null;
/** 0.4 s of 16 kHz mono 16-bit silence as a WAV file, base64. */
function silentWav(): string {
  if (silentWavB64) return silentWavB64;
  const dataLen = 6400 * 2;
  const bytes = new Uint8Array(44 + dataLen);
  const v = new DataView(bytes.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, dataLen, true);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  silentWavB64 = btoa(bin);
  return silentWavB64;
}

register('POST', '/v1/ai/transcribe/warm', async (req, env, ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  if (!env.AI) return fail(req, 'ai_not_configured', 503);
  const ai = env.AI;
  // No voice activity filter: it would drop the silence before the model ever ran.
  ctx.waitUntil(ai.run(WHISPER, { audio: silentWav(), task: 'transcribe', vad_filter: false }).catch(() => undefined));
  return ok(req, { warming: true });
});

register('POST', '/v1/ai/transcribe', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  if (!env.AI) return fail(req, 'ai_not_configured', 503);

  const declared = Number(req.headers.get('Content-Length') || '0');
  if (Number.isFinite(declared) && declared > TRANSCRIBE_MAX_BODY) return fail(req, 'too_long', 413);
  let audio = '';
  let lang: string | undefined;
  let prompt = '';
  try {
    const raw = await req.text();
    if (!raw) return fail(req, 'invalid body', 400);
    if (raw.length > TRANSCRIBE_MAX_BODY) return fail(req, 'too_long', 413);
    const body = JSON.parse(raw) as { audio?: unknown; lang?: unknown; prompt?: unknown };
    if (typeof body.audio === 'string') audio = body.audio;
    if (typeof body.lang === 'string' && LANGS.has(body.lang)) lang = body.lang;
    if (typeof body.prompt === 'string') prompt = body.prompt.slice(-PROMPT_MAX);
  } catch {
    return fail(req, 'invalid body', 400);
  }
  // A cheap shape check; Workers AI rejects anything that is not audio.
  if (audio.length < 512 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio.slice(-128))) return fail(req, 'invalid audio', 400);

  if (!(await withinDailyLimit(env, authedUserId, 'dictation', TRANSCRIBE_DAILY_LIMIT))) return fail(req, 'daily_limit', 429);

  let result: { text?: unknown } | null = null;
  try {
    result = (await env.AI.run(WHISPER, {
      audio,
      task: 'transcribe',
      ...(lang ? { language: lang } : {}),
      // The text said before this phrase (the app sends a dictation phrase by phrase), so Whisper
      // carries on the sentence instead of starting a new one each time.
      ...(prompt ? { initial_prompt: prompt } : {}),
      // Skips the silence before, between and after the words, where Whisper invents text.
      vad_filter: true,
      // Keeps one misheard phrase from repeating through the rest of a long recording.
      condition_on_previous_text: false,
    })) as { text?: unknown };
  } catch {
    return fail(req, 'transcribe_failed', 502);
  }
  let text = typeof result?.text === 'string' ? result.text.trim() : '';
  if (HALLUCINATIONS.some((re) => re.test(text))) text = '';
  return ok(req, { text });
});
