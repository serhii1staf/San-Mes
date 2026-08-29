// Report a photo's measured shape back to the server, so history stops resizing for everyone.
//
// ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
//
// Migration 0006 puts `img_w` / `img_h` on `messages`, so every message sent from now on tells the
// recipient the photo's shape and the bubble mounts at the right size on its first frame. It can do
// nothing for messages that already exist — the server never saw those images. On the live database
// that is 286 image-bearing messages out of 980, and those are exactly the ones the report is about,
// because the symptom shows up while scrolling UP through old history.
//
// The reader, however, does learn the shape: `SingleChatImage.handleLoad` measures the decoded photo
// and writes it into `imageDimsCache`, which is how the SECOND view of any photo is already jump-free
// today. That knowledge just never left the device. This sends it, once, so the peer's next scroll and
// this device's next reinstall both start correct.
//
// The server write is write-once (`AND img_w IS NULL`), so this can only fill a hole — it can never
// overwrite what a sender sent, and two readers racing is a harmless no-op.
//
// ── WHY IT BUFFERS ─────────────────────────────────────────────────────────
//
// The trigger is a scroll. A first pass through a media-heavy conversation decodes a run of photos in
// quick succession, and one request per photo would put a burst of writes behind the scroll gesture —
// which is the thing being fixed, not something to add to. So measurements accumulate and go out in
// one batched call.
//
// The buffer is flushed on a QUIET timer rather than a fixed interval: `FLUSH_QUIET_MS` after the last
// measurement, or immediately once `MAX_BATCH` have piled up, whichever comes first. So a scroll that
// keeps producing photos ships full batches as it goes, and a scroll that stops ships the remainder
// shortly after.
//
// ── WHY IT SELF-TERMINATES ─────────────────────────────────────────────────
//
// Each message is reported at most once per process (`reported`), and once reported the local
// `imageDimsCache` holds its size — so on the next view `seeded` is true and `handleLoad` no longer
// measures at all. After the server has the value, the history fetch carries it and nothing on any
// device measures that photo again. So the total work is bounded by "photos in this account's history
// that nobody has measured yet", once, ever — not by anything that repeats.

import { apiPost } from './apiClient';

/** Wait after the last measurement before shipping a partial batch. */
const FLUSH_QUIET_MS = 1500;

/**
 * Batch size that forces an immediate flush. Matches the server's per-call cap, so a full buffer maps
 * to exactly one accepted request with nothing silently truncated.
 */
const MAX_BATCH = 50;

/**
 * Ceiling on how many message ids we remember having reported.
 *
 * Bounds the Set for a very long session. Overflow simply clears it, which risks re-reporting a
 * message later in the same session — harmless, because the server write is a no-op once the value is
 * set. Preferred over an LRU because the failure mode of the cheap option is one redundant no-op call.
 */
const MAX_REPORTED = 2000;

interface Item {
  id: string;
  w: number;
  h: number;
}

const pending = new Map<string, Item>();
const reported = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.size === 0) return;
  const items = Array.from(pending.values()).slice(0, MAX_BATCH);
  for (const it of items) pending.delete(it.id);
  // Fire-and-forget. A failed backfill costs nothing visible: the local cache already holds the size,
  // so this device is jump-free either way, and the next reader will try again. `apiPost` resolves
  // rather than throwing, so the catch is only for a module-resolution failure.
  void (async () => {
    try {
      await apiPost('/v1/messages/dims', { items });
    } catch {
      // best-effort
    }
  })();
  // Anything that arrived beyond the cap stays queued; schedule the remainder.
  if (pending.size > 0) schedule();
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(flush, FLUSH_QUIET_MS);
}

/**
 * Record that `messageId`'s first image measured `w` x `h`.
 *
 * Safe to call from a render-path callback: it does one Map write and arms a timer. Callers should
 * only call it when they actually MEASURED something the server did not supply — passing through a
 * value that came from the server would report it straight back.
 *
 * `messageId` must be the SERVER's uuid. A local optimistic id (`m-<timestamp>`) is rejected here
 * rather than at the server, so an unsent message never occupies a buffer slot.
 */
export function reportImageDims(messageId: string | undefined | null, w: number, h: number): void {
  if (!messageId || messageId.startsWith('m-')) return;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  if (reported.has(messageId)) return;
  reported.add(messageId);
  if (reported.size > MAX_REPORTED) reported.clear();
  pending.set(messageId, { id: messageId, w: Math.round(w), h: Math.round(h) });
  if (pending.size >= MAX_BATCH) flush();
  else schedule();
}

/** Test seam: drop the buffer, the dedupe set and any armed timer. */
export function __resetImageDimsReporterForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  pending.clear();
  reported.clear();
}
