import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Serves the legal / info pages required by the App Store & Google Play:
 *   /privacy — Privacy Policy
 *   /terms   — Terms of Use
 *   /help    — Help / About
 * All three are static HTML rendered from this single handler.
 */

const APP_NAME = 'San';
const CONTACT_EMAIL = 'support@san-m-app.com';
const LAST_UPDATED = '6 июня 2026';

function page(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — ${APP_NAME}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f0f; color: #e8e8e8; line-height: 1.6; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 48px 24px 80px; }
    .logo { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
    .logo .badge { width: 44px; height: 44px; border-radius: 12px; background: #F09458; display: flex; align-items: center; justify-content: center; font-weight: 800; color: #fff; font-size: 20px; }
    .logo span { font-size: 20px; font-weight: 700; }
    h1 { font-size: 30px; font-weight: 700; margin-bottom: 8px; color: #fff; }
    .updated { color: #888; font-size: 14px; margin-bottom: 32px; }
    h2 { font-size: 19px; font-weight: 600; margin: 28px 0 10px; color: #fff; }
    p, li { color: #bbb; font-size: 15px; margin-bottom: 10px; }
    ul { padding-left: 22px; }
    a { color: #F09458; text-decoration: none; }
    .nav { margin-top: 40px; padding-top: 24px; border-top: 1px solid #222; display: flex; gap: 18px; flex-wrap: wrap; }
    .nav a { font-size: 14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="logo"><div class="badge">И</div><span>${APP_NAME}</span></div>
    ${bodyHtml}
    <div class="nav">
      <a href="/help">О приложении</a>
      <a href="/privacy">Конфиденциальность</a>
      <a href="/terms">Условия использования</a>
    </div>
  </div>
</body>
</html>`;
}

const PRIVACY = page('Политика конфиденциальности', `
  <h1>Политика конфиденциальности</h1>
  <div class="updated">Последнее обновление: ${LAST_UPDATED}</div>
  <p>${APP_NAME} уважает вашу конфиденциальность. Эта политика описывает, какие данные мы собираем и как их используем.</p>
  <h2>Какие данные мы собираем</h2>
  <ul>
    <li>Имя, юзернейм, эмодзи-аватар и информацию профиля, которые вы указываете при регистрации.</li>
    <li>Публикации, комментарии, сообщения и медиа, которые вы создаёте в приложении.</li>
    <li>Технические данные устройства, необходимые для работы приложения (идентификатор устройства для входа).</li>
  </ul>
  <h2>Как мы используем данные</h2>
  <ul>
    <li>Для предоставления функций приложения: лента, чаты, профили, мини-приложения.</li>
    <li>Для синхронизации и кэширования контента, чтобы приложение работало быстро и офлайн.</li>
    <li>Мы не продаём ваши персональные данные третьим лицам.</li>
  </ul>
  <h2>Хранение данных</h2>
  <p>Данные хранятся на защищённых серверах и локально на вашем устройстве для офлайн-доступа. Каждый аккаунт изолирован.</p>
  <h2>Удаление данных</h2>
  <p>Вы можете удалить свой аккаунт и связанные данные в настройках приложения или написав нам на <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
  <h2>Контакты</h2>
  <p>По вопросам конфиденциальности: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
`);

const TERMS = page('Условия использования', `
  <h1>Условия использования</h1>
  <div class="updated">Последнее обновление: ${LAST_UPDATED}</div>
  <p>Используя ${APP_NAME}, вы соглашаетесь с настоящими условиями.</p>
  <h2>Допустимое использование</h2>
  <ul>
    <li>Запрещён контент, нарушающий законы, разжигающий ненависть, насилие или эксплуатацию.</li>
    <li>Запрещены спам, мошенничество и выдача себя за других людей.</li>
    <li>Вы несёте ответственность за контент, который публикуете.</li>
  </ul>
  <h2>Модерация</h2>
  <p>Мы вправе удалять контент и блокировать аккаунты, нарушающие эти условия. В приложении есть функции жалоб и блокировки пользователей.</p>
  <h2>Аккаунт</h2>
  <p>Вход осуществляется по ключу устройства и PIN-коду. Храните их в безопасности — мы не сможем восстановить утерянный доступ.</p>
  <h2>Отказ от ответственности</h2>
  <p>Приложение предоставляется «как есть». Мы стремимся к стабильной работе, но не гарантируем отсутствие сбоев.</p>
  <h2>Контакты</h2>
  <p>Вопросы: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
`);

const HELP = page('О приложении', `
  <h1>San — социальная сеть</h1>
  <div class="updated">Присоединяйтесь к современному сообществу</div>
  <p>${APP_NAME} — это лёгкая и быстрая социальная сеть: лента публикаций, личные чаты, эмодзи-аватары, мини-приложения и виджеты на главном экране.</p>
  <h2>Возможности</h2>
  <ul>
    <li>Публикации с фото, лайки, комментарии и репосты.</li>
    <li>Личные сообщения с отправкой фото и поиском по переписке.</li>
    <li>Полностью работает офлайн с мгновенной загрузкой из кэша.</li>
    <li>Несколько аккаунтов на одном устройстве с изоляцией данных.</li>
    <li>Смена иконки приложения и виджет ленты на главном экране.</li>
  </ul>
  <h2>Поддержка</h2>
  <p>Нужна помощь? Напишите нам: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
`);

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = (req.url || '').toLowerCase();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.statusCode = 200;
  if (url.includes('/terms')) {
    res.end(TERMS);
  } else if (url.includes('/help')) {
    res.end(HELP);
  } else {
    res.end(PRIVACY);
  }
}
