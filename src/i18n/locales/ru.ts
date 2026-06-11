// Russian dictionary (source-of-truth language).
//
// Key naming convention: domain.specific_thing — keep keys short and stable.
// Add new keys here first, then mirror in en.ts.

const ru: Record<string, string> = {
  // ─── Common ────────────────────────────────────────────────────────────
  'common.save': 'Сохранить',
  'common.cancel': 'Отмена',
  'common.delete': 'Удалить',
  'common.edit': 'Редактировать',
  'common.share': 'Поделиться',
  'common.report': 'Пожаловаться',
  'common.copy': 'Копировать',
  'common.close': 'Закрыть',
  'common.back': 'Назад',
  'common.done': 'Готово',
  'common.ok': 'OK',
  'common.retry': 'Повторить',
  'common.continue': 'Продолжить',
  'common.confirm': 'Подтвердить',
  'common.error': 'Ошибка',
  'common.loading': 'Загрузка',
  'common.search': 'Поиск',
  'common.send': 'Отправить',
  'common.empty': 'Пусто',

  // ─── Tabs ──────────────────────────────────────────────────────────────
  'tab.home': 'Главная',
  'tab.search': 'Поиск',
  'tab.create': 'Создать',
  'tab.messages': 'Сообщения',
  'tab.profile': 'Профиль',

  // ─── Feed ──────────────────────────────────────────────────────────────
  'feed.title': 'San',
  'feed.empty': 'Пока нет публикаций',
  'feed.empty_hint': 'Подпишись на людей или создай свой первый пост',
  'feed.offline': 'Оффлайн',
  'feed.update_ready': 'Готово',
  'feed.update_title': 'Обновление',
  'feed.update_restart': 'Перезапустить',

  // ─── Profile ───────────────────────────────────────────────────────────
  'profile.posts': 'Посты',
  'profile.replies': 'Ответы',
  'profile.media': 'Медиа',
  'profile.likes': 'Лайки',
  'profile.followers': 'подписчиков',
  'profile.following': 'подписок',
  'profile.posts_count': 'постов',
  'profile.no_posts': 'Ещё нет публикаций',
  'profile.empty_section': 'Пока пусто',
  'profile.qr_title': 'Мой QR-код',
  'profile.qr_close_hint': 'Нажмите чтобы закрыть',
  'profile.edit': 'Редактировать',
  'profile.repost_from': 'репост от {name}',
  'profile.delete_post_title': 'Удалить пост?',
  'profile.delete_post_msg': 'Это действие нельзя отменить',

  // ─── Splash ────────────────────────────────────────────────────────────
  'splash.greeting': 'Привет, {name}',

  // ─── Settings root ─────────────────────────────────────────────────────
  'settings.title': 'Настройки',
  'settings.section.behavior': 'Поведение',
  'settings.section.appearance': 'Оформление',
  'settings.section.account': 'Аккаунт',
  'settings.section.about': 'О приложении',
  'settings.haptic': 'Тактильная отдача',
  'settings.browser': 'Браузер',
  'settings.browser.in_app': 'Встроенный',
  'settings.browser.external': 'Внешний',
  'settings.appearance': 'Внешний вид',
  'settings.fonts': 'Шрифты',
  'settings.widget_home': 'Виджет на главном',
  'settings.storage': 'Хранилище',
  'settings.privacy': 'Приватность',
  'settings.device_key': 'Ключ устройства',
  'settings.mini_apps': 'Мини-приложения',
  'settings.language': 'Язык',
  'settings.logout': 'Выйти',

  // ─── Settings → Browser ────────────────────────────────────────────────
  'browser_settings.title': 'Браузер',
  'browser_settings.in_app_label': 'Встроенный браузер',
  'browser_settings.position_label': 'Положение мини-виджета',
  'browser_settings.position_top': 'Сверху',
  'browser_settings.position_bottom': 'Снизу',
  'browser_settings.position_hint':
    'Когда вы сворачиваете браузер или мини-приложение, плашка с названием сайта появится в выбранном месте. Нажмите по ней чтобы вернуться, крестик — чтобы закрыть сессию.',

  // ─── Settings → Language ───────────────────────────────────────────────
  'language.title': 'Язык',
  'language.hint': 'Выберите язык интерфейса. Изменения применяются сразу.',
  'language.system': 'Системный',

  // ─── Browser pill / band ───────────────────────────────────────────────
  'browser.pill_default': 'Браузер',

  // ─── Auth ──────────────────────────────────────────────────────────────
  'auth.login': 'Войти',
  'auth.register': 'Регистрация',
  'auth.welcome': 'Добро пожаловать',
  'auth.username': 'Имя пользователя',
  'auth.password': 'Пароль',
  'auth.display_name': 'Отображаемое имя',
  'auth.no_account': 'Нет аккаунта?',
  'auth.have_account': 'Уже есть аккаунт?',
};

export default ru;
