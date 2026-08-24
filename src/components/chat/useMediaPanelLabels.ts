import { useMemo } from 'react';
import { useT } from '../../i18n/store';
import type { MediaPanelProps } from './MediaPanel';

/**
 * The media panel's strings, in one place.
 *
 * Both the chat screen and the comments screen mount `MediaPanel`, and each used to build this object
 * inline in its JSX. That was survivable at four strings and stopped being so the moment the add-GIF
 * dialog brought it to thirteen: two inline copies of a growing label set is a guarantee that one of
 * them will be missing a key, and the type error is the LUCKY outcome — a mismatched fallback string
 * would have shipped silently.
 *
 * Memoized on the translator, so the panel's props keep a stable identity. That matters: `MediaPanel` is
 * memoized, and an object literal in its props gave it a new identity on every render of a very busy
 * parent — every keyboard frame, every reply toggle — for a picker whose labels only change with the
 * language.
 */
export function useMediaPanelLabels(): MediaPanelProps['labels'] {
  const t = useT();
  return useMemo(
    () => ({
      gif: t('media.tab.gif'),
      emoji: t('media.tab.emoji'),
      copy: t('media.action.copy'),
      send: t('media.action.send'),
      addGif: {
        title: t('gif.add.title'),
        hint: t('gif.add.hint'),
        placeholder: t('gif.add.placeholder'),
        paste: t('gif.add.paste'),
        add: t('gif.add.action'),
        cancel: t('common.cancel'),
        find: t('gif.add.find'),
        errNotHttps: t('gif.add.err_https'),
        errNotMedia: t('gif.add.err_not_media'),
        errPackNotFound: t('gif.add.err_pack_not_found'),
        errPackEmpty: t('gif.add.err_pack_empty'),
        errPackAuth: t('gif.add.err_pack_auth'),
        errPackNotConfigured: t('gif.add.err_pack_not_configured'),
        added: t('gif.add.added'),
        foundOne: t('gif.add.found_one'),
        foundPack: t('gif.add.found_pack'),
        animatedNote: t('gif.add.animated_note'),
      },
    }),
    [t],
  );
}
