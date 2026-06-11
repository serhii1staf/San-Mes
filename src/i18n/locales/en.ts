// English dictionary. Keep key set in sync with ru.ts.

const en: Record<string, string> = {
  // ─── Common ────────────────────────────────────────────────────────────
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.share': 'Share',
  'common.report': 'Report',
  'common.copy': 'Copy',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.done': 'Done',
  'common.ok': 'OK',
  'common.retry': 'Retry',
  'common.continue': 'Continue',
  'common.confirm': 'Confirm',
  'common.error': 'Error',
  'common.loading': 'Loading',
  'common.search': 'Search',
  'common.send': 'Send',
  'common.empty': 'Empty',

  // ─── Tabs ──────────────────────────────────────────────────────────────
  'tab.home': 'Home',
  'tab.search': 'Search',
  'tab.create': 'Create',
  'tab.messages': 'Messages',
  'tab.profile': 'Profile',

  // ─── Feed ──────────────────────────────────────────────────────────────
  'feed.title': 'San',
  'feed.empty': 'No posts yet',
  'feed.empty_hint': 'Follow people or create your first post',
  'feed.offline': 'Offline',
  'feed.update_ready': 'Ready',
  'feed.update_title': 'Update',
  'feed.update_restart': 'Restart',

  // ─── Profile ───────────────────────────────────────────────────────────
  'profile.posts': 'Posts',
  'profile.replies': 'Replies',
  'profile.media': 'Media',
  'profile.likes': 'Likes',
  'profile.followers': 'followers',
  'profile.following': 'following',
  'profile.posts_count': 'posts',
  'profile.no_posts': 'No posts yet',
  'profile.empty_section': 'Nothing here yet',
  'profile.qr_title': 'My QR code',
  'profile.qr_close_hint': 'Tap to close',
  'profile.edit': 'Edit',
  'profile.repost_from': 'reposted from {name}',
  'profile.delete_post_title': 'Delete post?',
  'profile.delete_post_msg': 'This action cannot be undone',

  // ─── Splash ────────────────────────────────────────────────────────────
  'splash.greeting': 'Hi, {name}',

  // ─── Settings root ─────────────────────────────────────────────────────
  'settings.title': 'Settings',
  'settings.section.behavior': 'Behavior',
  'settings.section.appearance': 'Appearance',
  'settings.section.account': 'Account',
  'settings.section.about': 'About',
  'settings.haptic': 'Haptic feedback',
  'settings.browser': 'Browser',
  'settings.browser.in_app': 'In-app',
  'settings.browser.external': 'External',
  'settings.appearance': 'Appearance',
  'settings.fonts': 'Fonts',
  'settings.widget_home': 'Home-screen widget',
  'settings.storage': 'Storage',
  'settings.privacy': 'Privacy',
  'settings.device_key': 'Device key',
  'settings.mini_apps': 'Mini apps',
  'settings.language': 'Language',
  'settings.logout': 'Log out',

  // ─── Settings → Browser ────────────────────────────────────────────────
  'browser_settings.title': 'Browser',
  'browser_settings.in_app_label': 'In-app browser',
  'browser_settings.position_label': 'Mini-widget position',
  'browser_settings.position_top': 'Top',
  'browser_settings.position_bottom': 'Bottom',
  'browser_settings.position_hint':
    "When you minimise the browser or a mini-app, a small pill with the site's name appears in the chosen spot. Tap to return; the X dismisses the session.",

  // ─── Settings → Language ───────────────────────────────────────────────
  'language.title': 'Language',
  'language.hint': 'Pick the interface language. Changes apply instantly.',
  'language.system': 'System',

  // ─── Browser pill / band ───────────────────────────────────────────────
  'browser.pill_default': 'Browser',

  // ─── Auth ──────────────────────────────────────────────────────────────
  'auth.login': 'Log in',
  'auth.register': 'Sign up',
  'auth.welcome': 'Welcome',
  'auth.username': 'Username',
  'auth.password': 'Password',
  'auth.display_name': 'Display name',
  'auth.no_account': "Don't have an account?",
  'auth.have_account': 'Already have an account?',
};

export default en;
