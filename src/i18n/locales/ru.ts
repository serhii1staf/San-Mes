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
  'auth.welcome_title': 'Добро пожаловать!',
  'auth.welcome_subtitle': 'Общайтесь, делитесь моментами и будьте всегда на связи.',
  'auth.signin': 'Войти',
  'auth.signup': 'Зарегистрироваться',
  'auth.username': 'Имя пользователя',
  'auth.password': 'Пароль',
  'auth.display_name': 'Отображаемое имя',
  'auth.no_account': 'Нет аккаунта?',
  'auth.have_account': 'Уже есть аккаунт?',
  'auth.policy_prefix': 'При входе в приложение вы принимаете',
  'auth.policy_terms': 'Политику использования',
  'auth.policy_and': 'и',
  'auth.policy_privacy': 'Политику конфиденциальности',

  // ─── Login ─────────────────────────────────────────────────────────────
  'login.title': 'С возвращением!',
  'login.subtitle': 'Введите ключ устройства и код для входа.',
  'login.device_key_label': 'Ключ устройства',
  'login.pin_label': '4-значный код',
  'login.error.invalid': 'Неверный ключ или код',
  'login.create_account': 'Создать',

  // ─── Register ──────────────────────────────────────────────────────────
  'register.emoji_title': 'Установите Эмодзи!',
  'register.emoji_subtitle': 'Наконец, давайте выберем эмодзи.',
  'register.emoji_pick': 'Выбрать эмодзи',
  'register.emoji_immutable': 'Выбранный эмодзи нельзя изменить',
  'register.name_title': 'Давайте Знакомиться!',
  'register.name_subtitle': 'Введите своё имя и выберите уникальный юзернейм.',
  'register.name_placeholder': 'Ваше имя',
  'register.bio_label': 'Информация о себе',
  'register.bio_placeholder': 'Расскажите о своих интересах или просто напиши пару слов о себе...',
  'register.pin_title': 'Придумай код',
  'register.pin_subtitle': '4 цифры для входа',
  'register.confirm_pin_title': 'Повтори код',
  'register.confirm_pin_subtitle': 'Введи код ещё раз',
  'register.error.pins_mismatch': 'Коды не совпадают',

  // ─── Notifications ─────────────────────────────────────────────────────
  'notifications.title': 'Уведомления',
  'notifications.empty': 'Нет уведомлений',
  'notifications.tag_reply': 'Ответ',
  'notifications.tag_gif': 'Гифка',
  'notifications.tag_photo': 'Фото',
  'notifications.tag_link': 'Ссылка',
  'notifications.verb.like': 'оценил(а) ваш пост',
  'notifications.verb.comment': 'прокомментировал(а) ваш пост',
  'notifications.verb.follow': 'подписался(ась) на вас',

  // ─── Comments ──────────────────────────────────────────────────────────
  'comments.title': 'Комментарии',
  'comments.empty': 'Пока нет комментариев',
  'comments.placeholder': 'Комментарий...',
  'comments.reply': 'Ответить',
  'comments.editing': 'Редактирование',
  'comments.reply_to': 'Ответ @{username}',
  'comments.delete_title': 'Удалить комментарий?',
  'comments.time_now': 'сейчас',
  'comments.time_min': '{n}м',
  'comments.time_hour': '{n}ч',
  'comments.time_day': '{n}д',
  'comments.repost_label': 'сделал(а) репост',

  // ─── Toasts ────────────────────────────────────────────────────────────
  'toast.copied': 'Скопировано',
  'toast.link_copied': 'Ссылка скопирована',
  'toast.report_sent': 'Жалоба отправлена',
  'toast.post_deleted': 'Пост удалён',
  'toast.saved': 'Сохранено',

  // ─── Report categories ─────────────────────────────────────────────────
  'report.title': 'Причина жалобы',
  'report.cat.spam': 'Спам',
  'report.cat.violence': 'Насилие',
  'report.cat.misinformation': 'Ложная информация',
  'report.cat.fraud': 'Мошенничество',
  'report.cat.harassment': 'Оскорбления',
  'report.cat.copyright': 'Нарушение авторских прав',
  'report.cat.other': 'Другое',

  // ─── Edit profile ──────────────────────────────────────────────────────
  'edit_profile.title': 'Редактировать',
  'edit_profile.add_banner': 'Добавить баннер',
  'edit_profile.change_emoji': 'Изменить эмодзи',
  'edit_profile.name_label': 'Имя',
  'edit_profile.name_placeholder': 'Ваше имя',
  'edit_profile.username_label': 'Имя пользователя',
  'edit_profile.bio_label': 'О себе',
  'edit_profile.bio_placeholder': 'Расскажите о себе',
  'edit_profile.chars_left': '{count} символов осталось',
  'edit_profile.links': 'Ссылки',
  'edit_profile.add_link': 'Добавить ссылку',
  'edit_profile.emoji_title': 'Эмодзи',
  'edit_profile.link_website': 'Сайт',
  'edit_profile.link_edit_title': 'Редактировать ссылку',
  'edit_profile.link_add_title': 'Добавить ссылку',
  'edit_profile.link_type': 'Тип',
  'edit_profile.link_save': 'Сохранить',
  'edit_profile.link_add': 'Добавить',

  // ─── Emoji categories ──────────────────────────────────────────────────
  'emoji.cat.mood': 'Настроение',
  'emoji.cat.animals': 'Животные',
  'emoji.cat.nature': 'Природа',
  'emoji.cat.food': 'Еда',
  'emoji.cat.activities': 'Активности',
  'emoji.cat.symbols': 'Символы',
  'emoji.cat.objects': 'Объекты',

  // ─── Post menu ─────────────────────────────────────────────────────────
  'post_menu.default_content': 'Публикация',
  'post_menu.copy_link': 'Скопировать ссылку',
  'post_menu.share': 'Поделиться',
  'post_menu.save': 'Сохранить',
  'post_menu.delete': 'Удалить пост',
  'post_menu.report': 'Пожаловаться',

  // ─── Account switcher ──────────────────────────────────────────────────
  'account_switcher.title': 'Аккаунты',
  'account_switcher.active': 'Активный',
  'account_switcher.add': 'Добавить аккаунт',
  'account_switcher.not_found': 'Аккаунт не найден',
  'account_switcher.error.fill_fields': 'Введите ключ устройства и 4-значный PIN',
  'account_switcher.error.wrong_pin': 'Неверный PIN',
  'account_switcher.limit_title': 'Лимит',
  'account_switcher.limit_msg': 'Максимум 3 аккаунта',
  'account_switcher.device_key_placeholder': 'Ключ устройства',
  'account_switcher.pin_placeholder': 'PIN (4 цифры)',
  'account_switcher.signing_in': 'Вход...',
};

export default ru;
