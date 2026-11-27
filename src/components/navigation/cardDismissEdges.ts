/**
 * Strips at the screen edges that grab a chat or a profile and drag it away (CardDismissSurface).
 *
 * In a file of their own so the chat bubble's gestures (src/hooks/useMessageGestures.ts) can stay
 * out of the right one without importing the surface.
 */
export const CARD_EDGE_LEFT = 28;
/** Narrower on the right: swipe-to-reply starts on outgoing bubbles that end 8 pt from this edge. */
export const CARD_EDGE_RIGHT = 20;
