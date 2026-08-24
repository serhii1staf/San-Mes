import { create } from 'zustand';

/**
 * One share sheet for the whole app, opened from anywhere by a module function.
 *
 * WHY A STORE AND NOT A PROP
 *
 * The share action lives in places that cannot reach a sheet by props: the icon row inside `PostCard`
 * (rendered by a virtualized list, three screens deep), `PostMenuModal`, both profile viewers, the
 * profile menu. Prop-drilling a sheet into `PostCard` would mean threading it through the feed, search,
 * profile and comments lists, and every one of those lists would then hold a callback that changes
 * identity whenever the sheet's state changes — which is exactly the kind of thing that re-renders a
 * whole feed to open a modal.
 *
 * Mounting a sheet per call site is worse: five copies of a fifteen-avatar list, each with its own
 * animation driver, all mounted permanently for a surface that is closed almost always.
 *
 * So: one host at the root (`ShareSheetHost`, next to `<Toast />`), one store, and call sites that say
 * what to share and nothing else. This mirrors `toastStore`, which solved the same problem.
 */

interface ShareTarget {
  /** Absolute https URL. Sent verbatim so the recipient's chat unfurls it into a preview card. */
  url: string;
  /** Optional line sent above the link — the post's own text, when it has one. */
  caption?: string;
}

interface ShareSheetStore {
  target: ShareTarget | null;
  open: (target: ShareTarget) => void;
  close: () => void;
}

export const useShareSheetStore = create<ShareSheetStore>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

/** Share an arbitrary URL. Prefer the typed helpers below so link shapes stay in one place. */
export function openShareSheet(url: string, caption?: string) {
  useShareSheetStore.getState().open({ url, caption });
}

/**
 * Share a post.
 *
 * A LINK, not a copy of the post's content. A copy looks richer for about a day and is then wrong for
 * ever: edit the post, delete it, add a photo, and every forwarded copy still shows the old thing with
 * no way to know it is stale. The link stays the post, and it costs nothing to render well — the chat
 * already unfurls links into preview cards showing the author, text and image.
 */
export function openPostShareSheet(postId: string, caption?: string) {
  openShareSheet(`https://san-m-app.com/post/${postId}`, caption);
}

/** Share a profile. Same reasoning: the link resolves to whatever the profile is when it is opened. */
export function openProfileShareSheet(profileId: string, displayName?: string) {
  openShareSheet(`https://san-m-app.com/profile/${profileId}`, displayName);
}
