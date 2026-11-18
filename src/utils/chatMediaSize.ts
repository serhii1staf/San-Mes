import { Dimensions } from 'react-native';

/**
 * The widths chat photos are requested at. Shared, because the width is part of the image cache key
 * (see `proxiedImageUrl` and src/services/mediaVariants.ts): a surface that shows the same photo at a
 * different width downloads and decodes a second copy. The long-press preview of a chat asked for its
 * own sizes, so every peek re-fetched photos the chat had already shown, which read as "it reloads".
 *
 * The arithmetic is the chat bubble's (app/chat/[id].tsx): the screen, minus the message row's
 * margins (16 each side) and the time column (46), minus the bubble's own horizontal padding (28).
 */
const SCREEN_WIDTH = Dimensions.get('window').width;
const BUBBLE_MAX_W = SCREEN_WIDTH - 16 * 2 - 46;

/** A single photo or GIF in a chat bubble. */
export const CHAT_IMG_MAX_W = Math.min(Math.round(SCREEN_WIDTH * 0.66), 270, BUBBLE_MAX_W - 28);

/** One tile of a multi-photo bubble. */
export const CHAT_MULTI_IMG_SIZE = 120;
