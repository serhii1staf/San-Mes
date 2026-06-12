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
  'auth.welcome_title': 'Welcome!',
  'auth.welcome_subtitle': 'Stay in touch, share moments, and always be online.',
  'auth.signin': 'Sign in',
  'auth.signup': 'Sign up',
  'auth.username': 'Username',
  'auth.password': 'Password',
  'auth.display_name': 'Display name',
  'auth.no_account': "Don't have an account?",
  'auth.have_account': 'Already have an account?',
  'auth.policy_prefix': 'By signing in you accept the',
  'auth.policy_terms': 'Terms of Use',
  'auth.policy_and': 'and',
  'auth.policy_privacy': 'Privacy Policy',

  // ─── Login ─────────────────────────────────────────────────────────────
  'login.title': 'Welcome back!',
  'login.subtitle': 'Enter your device key and PIN to sign in.',
  'login.device_key_label': 'Device key',
  'login.pin_label': '4-digit code',
  'login.error.invalid': 'Invalid key or PIN',
  'login.create_account': 'Create one',

  // ─── Register ──────────────────────────────────────────────────────────
  'register.emoji_title': 'Pick an emoji!',
  'register.emoji_subtitle': "Finally, let's choose an emoji.",
  'register.emoji_pick': 'Pick emoji',
  'register.emoji_immutable': "The chosen emoji can't be changed",
  'register.name_title': "Let's get to know you!",
  'register.name_subtitle': 'Enter your name and pick a unique username.',
  'register.name_placeholder': 'Your name',
  'register.bio_label': 'About you',
  'register.bio_placeholder': 'Share your interests or just write a few words about yourself...',
  'register.pin_title': 'Create a PIN',
  'register.pin_subtitle': '4 digits to sign in',
  'register.confirm_pin_title': 'Repeat the PIN',
  'register.confirm_pin_subtitle': 'Enter the PIN once more',
  'register.error.pins_mismatch': "PINs don't match",

  // ─── Notifications ─────────────────────────────────────────────────────
  'notifications.title': 'Notifications',
  'notifications.empty': 'No notifications',
  'notifications.tag_reply': 'Reply',
  'notifications.tag_gif': 'GIF',
  'notifications.tag_photo': 'Photo',
  'notifications.tag_link': 'Link',
  'notifications.verb.like': 'liked your post',
  'notifications.verb.comment': 'commented on your post',
  'notifications.verb.follow': 'followed you',

  // ─── Comments ──────────────────────────────────────────────────────────
  'comments.title': 'Comments',
  'comments.empty': 'No comments yet',
  'comments.placeholder': 'Comment...',
  'comments.reply': 'Reply',
  'comments.editing': 'Editing',
  'comments.reply_to': 'Reply to @{username}',
  'comments.delete_title': 'Delete comment?',
  'comments.time_now': 'now',
  'comments.time_min': '{n}m',
  'comments.time_hour': '{n}h',
  'comments.time_day': '{n}d',
  'comments.repost_label': 'reposted',

  // ─── Toasts ────────────────────────────────────────────────────────────
  'toast.copied': 'Copied',
  'toast.link_copied': 'Link copied',
  'toast.report_sent': 'Report sent',
  'toast.post_deleted': 'Post deleted',
  'toast.saved': 'Saved',

  // ─── Report categories ─────────────────────────────────────────────────
  'report.title': 'Report reason',
  'report.cat.spam': 'Spam',
  'report.cat.violence': 'Violence',
  'report.cat.misinformation': 'Misinformation',
  'report.cat.fraud': 'Fraud',
  'report.cat.harassment': 'Harassment',
  'report.cat.copyright': 'Copyright infringement',
  'report.cat.other': 'Other',

  // ─── Edit profile ──────────────────────────────────────────────────────
  'edit_profile.title': 'Edit',
  'edit_profile.add_banner': 'Add a banner',
  'edit_profile.change_emoji': 'Change emoji',
  'edit_profile.name_label': 'Name',
  'edit_profile.name_placeholder': 'Your name',
  'edit_profile.username_label': 'Username',
  'edit_profile.bio_label': 'About',
  'edit_profile.bio_placeholder': 'Tell us about yourself',
  'edit_profile.chars_left': '{count} characters left',
  'edit_profile.links': 'Links',
  'edit_profile.add_link': 'Add a link',
  'edit_profile.emoji_title': 'Emoji',
  'edit_profile.link_website': 'Website',
  'edit_profile.link_edit_title': 'Edit link',
  'edit_profile.link_add_title': 'Add link',
  'edit_profile.link_type': 'Type',
  'edit_profile.link_save': 'Save',
  'edit_profile.link_add': 'Add',

  // ─── Emoji categories ──────────────────────────────────────────────────
  'emoji.cat.mood': 'Mood',
  'emoji.cat.animals': 'Animals',
  'emoji.cat.nature': 'Nature',
  'emoji.cat.food': 'Food',
  'emoji.cat.activities': 'Activities',
  'emoji.cat.symbols': 'Symbols',
  'emoji.cat.objects': 'Objects',

  // ─── Post menu ─────────────────────────────────────────────────────────
  'post_menu.default_content': 'Post',
  'post_menu.copy_link': 'Copy link',
  'post_menu.share': 'Share',
  'post_menu.save': 'Save',
  'post_menu.delete': 'Delete post',
  'post_menu.report': 'Report',

  // ─── Account switcher ──────────────────────────────────────────────────
  'account_switcher.title': 'Accounts',
  'account_switcher.active': 'Active',
  'account_switcher.add': 'Add account',
  'account_switcher.not_found': 'Account not found',
  'account_switcher.error.fill_fields': 'Enter the device key and a 4-digit PIN',
  'account_switcher.error.wrong_pin': 'Wrong PIN',
  'account_switcher.limit_title': 'Limit',
  'account_switcher.limit_msg': 'Maximum 3 accounts',
  'account_switcher.device_key_placeholder': 'Device key',
  'account_switcher.pin_placeholder': 'PIN (4 digits)',
  'account_switcher.signing_in': 'Signing in...',
};

export default en;
