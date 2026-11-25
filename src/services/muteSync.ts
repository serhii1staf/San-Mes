/**
 * Muted chats are muted on the server too, so a closed app stops getting pushes for them.
 *
 * The chat-list menu toggles `chatSettingsStore.muted`, a device-wide list of conversation ids. That
 * list silences the in-app alert and the foreground banner, but pushes are sent by the Worker, which
 * did not know about it: a closed app still got a push for every message of a muted chat. The Worker
 * now keeps a mute flag per participant (`PUT` / `DELETE /v1/conversations/:id/mute`, migration 0010)
 * and sends no push to a participant who muted.
 *
 * WHAT IS KEPT IN STEP
 *
 * The local list stays the source of truth on this device. Per account (the kv namespace), MMKV holds
 * `confirmed`, the ids this device has told the server are muted, and `foreign`, the ids the server
 * refused for this account (the local list is device-wide, so it can hold another signed-in account's
 * chats). A pass mutes what is local but not confirmed and unmutes what is confirmed but no longer
 * local. So:
 *
 *   - chats muted before this existed are sent on the first pass;
 *   - a toggle made offline is sent by a later pass (reconnect, next foreground, next toggle);
 *   - an unmute made on another device is not undone here: this device only unmutes what it
 *     confirmed itself.
 *
 * Nothing here is on a hot path. A pass with nothing to send reads one MMKV key and returns.
 */
import { AppState } from 'react-native';
import { useChatSettingsStore } from '../store/chatSettingsStore';
import { useAuthStore } from '../store/authStore';
import { useConnectivityStore } from './connectivityMonitor';
import { kvGetJSONSync, kvSetJSON } from './kvStore';
import { apiDelete, apiPut } from './apiClient';

const KEY = 'chat_mute_server';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MuteState {
  confirmed: string[];
  foreign: string[];
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function readState(): MuteState {
  const v = kvGetJSONSync<Partial<MuteState> | null>(KEY, null);
  return { confirmed: strings(v?.confirmed), foreign: strings(v?.foreign) };
}

/**
 * The server's "not your chat": final, so retrying cannot change the answer. "not found" is NOT one:
 * it is also what a Worker without these routes answers, and a mute must not be written off for that.
 */
function isRefusal(error: string): boolean {
  return /forbidden|invalid conversation id/i.test(error);
}

let running = false;
let rerun = false;

/** Bring the server's mutes in line with the local list. Never throws; a failed pass is retried by the next trigger. */
export async function reconcileChatMutes(): Promise<void> {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      await pass();
    } while (rerun);
  } catch {
    // The state is saved as far as it got; the next trigger carries on from there.
  } finally {
    running = false;
  }
}

async function pass(): Promise<void> {
  const uid = useAuthStore.getState().user?.id;
  if (!uid) return;
  if (!useConnectivityStore.getState().isOnline) return;
  const local = new Set((useChatSettingsStore.getState().muted ?? []).filter((id) => UUID.test(id)));
  const state = readState();
  const confirmed = new Set(state.confirmed);
  // A refusal is forgotten once the chat is no longer muted here, so the list cannot only grow.
  const foreign = new Set(state.foreign.filter((id) => local.has(id)));
  const toMute = [...local].filter((id) => !confirmed.has(id) && !foreign.has(id));
  const toUnmute = [...confirmed].filter((id) => !local.has(id));
  if (toMute.length === 0 && toUnmute.length === 0 && foreign.size === state.foreign.length) return;

  const save = () => {
    // Signed into another account while a request was out: this state is not that account's, and
    // the kv namespace has already moved to it.
    if (useAuthStore.getState().user?.id !== uid) return;
    kvSetJSON(KEY, { confirmed: [...confirmed], foreign: [...foreign] });
  };
  for (const id of toUnmute) {
    const { error } = await apiDelete(`/v1/conversations/${encodeURIComponent(id)}/mute`);
    if (error && !isRefusal(error)) {
      save();
      return;
    }
    confirmed.delete(id);
  }
  for (const id of toMute) {
    const { error } = await apiPut(`/v1/conversations/${encodeURIComponent(id)}/mute`);
    if (error) {
      if (!isRefusal(error)) {
        save();
        return;
      }
      foreign.add(id);
      continue;
    }
    confirmed.add(id);
  }
  save();
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Coalesces a burst of triggers (several toggles in a row) into one pass. */
function schedule(ms = 800): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void reconcileChatMutes();
  }, ms);
}

/**
 * Keep the server's mutes in step from now on: a pass now, then after every change to the local
 * list, on reconnect, on an account switch and on every return to the foreground. Returns the stop.
 */
export function startMuteSync(): () => void {
  const stops: (() => void)[] = [];
  stops.push(useChatSettingsStore.subscribe((s, prev) => {
    if (s.muted !== prev.muted) schedule();
  }));
  stops.push(useConnectivityStore.subscribe((s, prev) => {
    if (s.isOnline && !prev.isOnline) schedule();
  }));
  stops.push(useAuthStore.subscribe((s, prev) => {
    if (s.user?.id && s.user.id !== prev.user?.id) schedule();
  }));
  const app = AppState.addEventListener('change', (next) => {
    if (next === 'active') schedule();
  });
  stops.push(() => app.remove());
  schedule(0);
  return () => {
    for (const stop of stops) stop();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
