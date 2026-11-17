import { useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';

/**
 * Persist `value` after the current interaction instead of on the frame that changed it, and
 * still write the latest value if the screen unmounts first.
 *
 * The music and AI chats deferred their history writes with `runAfterInteractions` and cancelled
 * the pending write in the effect cleanup. Leaving the chat right after a reply arrived unmounted
 * the screen inside that window, so the newest messages were never saved. Here the cleanup on
 * unmount flushes instead of dropping.
 *
 * The first run is skipped: it would only write back what was just read from storage.
 */
export function useDeferredPersist<T>(value: T, save: (v: T) => void): void {
  const pending = useRef<{ v: T } | null>(null);
  const isFirst = useRef(true);
  const saveRef = useRef(save);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    pending.current = { v: value };
    const handle = InteractionManager.runAfterInteractions(() => {
      const p = pending.current;
      pending.current = null;
      if (p) saveRef.current(p.v);
    });
    return () => handle.cancel();
  }, [value]);

  useEffect(
    () => () => {
      const p = pending.current;
      pending.current = null;
      if (p) {
        try { saveRef.current(p.v); } catch {}
      }
    },
    [],
  );
}
