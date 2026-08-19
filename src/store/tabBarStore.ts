import { create } from 'zustand';

/**
 * tabBarStore — lets a screen temporarily take over the bottom of the display.
 *
 * The only consumer today is the chat list's selection ("Изм.") mode: while the
 * user is picking conversations, the floating tab bar is replaced by a contextual
 * action bar (Delete / Archive / Read). Keeping both would stack two floating
 * bars on top of each other and, on small devices, push the action bar under the
 * home indicator.
 *
 * WHY A STORE AND NOT A NAVIGATION OPTION: `Tabs` renders `CustomTabBar` outside
 * the focused screen's tree, so the screen cannot reach it through props or
 * context. A one-field store is the smallest thing that crosses that boundary,
 * and it keeps `CustomTabBar` subscribed to exactly one boolean instead of
 * re-rendering on unrelated navigation state.
 *
 * IMPORTANT — hide by MOVING, never by fading. `expo-glass-effect` documents that
 * an `opacity` of 0 on a `GlassView` *or any of its parents* stops the glass from
 * rendering at all (expo/expo#41024), and the bar's backdrop is exactly such a
 * GlassView. Animating the bar off-screen on `translateY` sidesteps that
 * entirely, costs nothing (a GPU transform, no relayout) and leaves the glass
 * intact for when it slides back.
 *
 * Screens MUST restore visibility on unmount/blur — see the chat list's cleanup
 * effect — so backing out mid-selection can never leave the app with no tab bar.
 */
interface TabBarState {
  /** True while a screen is presenting its own bottom bar instead. */
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

export const useTabBarStore = create<TabBarState>((set) => ({
  hidden: false,
  setHidden: (hidden) => set((s) => (s.hidden === hidden ? s : { hidden })),
}));
