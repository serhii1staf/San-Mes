/**
 * Attach a realtime channel for as long as some screen needs it, and detach it after the last one
 * lets go.
 *
 * Subscribing attaches an Ably channel; unsubscribing a listener does NOT detach it. The chat,
 * typing and comment screens only ever unsubscribed, so every chat opened in a session stayed
 * attached until the app went to the background: four chats opened and closed left eight attached
 * channels (`chat:<id>` + `typing:chat:<id>` each), measured on the emulator. Ably kept delivering
 * those channels' messages and typing events to this device with no listener left to read them,
 * which costs inbound traffic, a JSON parse per event, and Ably message quota.
 *
 * A screen takes a lease when it subscribes and releases it on cleanup. The count is per channel
 * object, so two screens on the same channel (a chat pushed on top of itself, the two comment
 * subscriptions) keep it attached until both are gone, and a client rebuilt after an account switch
 * gets its own count.
 *
 * The detach waits `DETACH_GRACE_MS`. Leaving a chat and coming straight back is common (an
 * accidental back swipe), and an effect re-running for its own reasons releases and re-leases in the
 * same tick; neither should cost a detach and a re-attach round trip.
 *
 * Publishing needs no lease: Ably v2 publishes on a detached channel without attaching it
 * (`RealtimeChannel.publish` only checks the connection and that the channel is not failed or
 * suspended), which is what the send paths rely on after the screen has gone.
 */
import type * as Ably from 'ably';

type Channel = Ably.RealtimeChannel;

/** How long a released channel stays attached in case a screen takes it again. */
export const DETACH_GRACE_MS = 2000;

const holders = new Map<Channel, number>();
const pendingDetach = new Map<Channel, ReturnType<typeof setTimeout>>();

export type ChannelLease = {
  channel: Channel;
  /** Idempotent: a second call does nothing. */
  release: () => void;
};

export function leaseChannel(realtime: Ably.Realtime, name: string): ChannelLease {
  const channel = realtime.channels.get(name);
  const queued = pendingDetach.get(channel);
  if (queued) {
    clearTimeout(queued);
    pendingDetach.delete(channel);
  }
  holders.set(channel, (holders.get(channel) || 0) + 1);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const left = (holders.get(channel) || 1) - 1;
    if (left > 0) {
      holders.set(channel, left);
      return;
    }
    holders.delete(channel);
    const timer = setTimeout(() => {
      pendingDetach.delete(channel);
      if (holders.has(channel)) return;
      detachQuietly(channel);
    }, DETACH_GRACE_MS);
    pendingDetach.set(channel, timer);
  };

  return { channel, release };
}

function detachQuietly(channel: Channel): void {
  try {
    const state = channel.state;
    // Nothing to undo for a channel that never attached, already left, or failed.
    if (state !== 'attached' && state !== 'attaching' && state !== 'suspended') return;
    // Rejects when the connection is already closed (logout, background disconnect). The channel
    // goes with the connection in that case, so there is nothing to report.
    channel.detach().catch(() => {});
  } catch {
    // Same: a client torn down underneath us leaves nothing attached.
  }
}

/** Test seam. */
export function __channelLeaseStateForTests(): { held: number; pending: number } {
  return { held: holders.size, pending: pendingDetach.size };
}

/** Test seam: cancel pending detaches and forget every lease. */
export function __resetChannelLeasesForTests(): void {
  for (const t of pendingDetach.values()) clearTimeout(t);
  pendingDetach.clear();
  holders.clear();
}
