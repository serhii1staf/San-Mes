import { Redirect } from 'expo-router';

/**
 * The Home feed was removed (this app is messenger-first now), but the `(tabs)`
 * group STILL needs a resolvable default leaf: deleting this file entirely left
 * `/(tabs)` with nothing to render and produced a black screen after the OTA.
 *
 * So `index` stays as a route, but it renders nothing of its own — it redirects
 * to Messages. That guarantees:
 *   • `/(tabs)` always resolves (the group has a default child again);
 *   • any lingering link to `/(tabs)` or `/(tabs)/index` lands on Messages
 *     instead of the "page unavailable" / black screen;
 *   • `CustomTabBar` hides this route (it filters out `index` alongside
 *     `profile`), so there is no ghost tab button.
 *
 * `<Redirect>` is expo-router's documented redirect primitive — it behaves like
 * `router.replace` but runs during render, so there is no mount-then-navigate
 * flash. Same pattern as `app/post/[id].tsx`.
 *
 * In normal use this never even mounts: `unstable_settings.initialRouteName` in
 * the tabs layout anchors the group directly on Messages. This file is the
 * safety net for every other way the group can be reached.
 */
export default function TabsIndexRedirect() {
  return <Redirect href="/(tabs)/messages" />;
}
