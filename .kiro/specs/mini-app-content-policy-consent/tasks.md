# Implementation Plan: Окно согласия с правилами контента мини-приложений

## Overview

План преобразует дизайн в последовательность инкрементальных задач для код-агента. Каждая задача опирается на предыдущие и завершается интеграцией: сначала i18n-ключи и HTTPS-утилита, затем модальный компонент согласия, затем «единые ворота» в `mini-apps.tsx`, затем правки юридических страниц `docs/`. Тесты вынесены в опциональные подзадачи (`*`) и располагаются рядом с реализуемой логикой.

UI-часть (`src/`, новый компонент, i18n) поставляется через OTA (`eas update`), без нового нативного билда и без новых нативных разрешений. Юридические страницы (`docs/`) поставляются через GitHub Pages при push в `main`. Эти два канала независимы.

## Tasks

- [x] 1. Добавить i18n-ключи и HTTPS-утилиту
  - [x] 1.1 Добавить i18n-ключи `mini_apps.consent.*` в обе локали
    - В `src/i18n/locales/en.ts` и `src/i18n/locales/ru.ts` добавить пространство ключей `mini_apps.consent.*` с **идентичным набором ключей** в обоих файлах
    - Ключи: `title`, `intro`, `prohibited_heading`, `prohibited_body`, `stores`, `san_policies`, `terms_link`, `privacy_link`, `accept`, `accept_edit`, `decline`, `accept_a11y`, `decline_a11y`, `terms_link_a11y`, `privacy_link_a11y`, `link_error`
    - Английские и русские значения взять из таблицы дизайна (раздел «Список i18n-ключей»); каждое значение — непустая строка
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x]* 1.2 Property-тест паритета ключей локализации
    - **Property 7: Паритет ключей локализации Consent_Dialog** — множество ключей `mini_apps.consent.*` в `en` точно равно множеству в `ru`, и каждое значение в обоих словарях — непустая строка
    - **Validates: Requirements 5.2, 5.3, 5.4**
    - fast-check, `{ numRuns: 100 }`, тег-комментарий `// Feature: mini-app-content-policy-consent, Property 7: ...`

  - [x] 1.3 Реализовать HTTPS-only утилиту открытия юридических ссылок
    - Создать `src/components/mini-apps/openLegalLink.ts` с функцией `openLegalLink(url: string, onError?: () => void): Promise<boolean>`
    - Если `url` не начинается с `https://` (регистронезависимо) — вызвать `onError?.()`, вернуть `false`, не вызывать `Linking.openURL`
    - Если HTTPS — вызвать `Linking.openURL(url)`; при исключении вызвать `onError?.()` и вернуть `false`; при успехе вернуть `true`
    - _Requirements: 9.5, 9.6, 9.7, 3.6, 3.7_

  - [x]* 1.4 Property-тест HTTPS-only открытия ссылок
    - **Property 6: Открытие юридических ссылок строго по HTTPS** — `Linking.openURL` вызывается тогда и только тогда, когда схема `https`; для `http`, `ftp`, `file`, `javascript`, относительных и пустых URL функция возвращает `false`, не вызывает `Linking.openURL` и вызывает `onError`
    - **Validates: Requirements 9.5, 9.6**
    - Генератор `arbitraryUrl` с варьируемой схемой; мок `Linking.openURL`; fast-check `{ numRuns: 100 }`, тег-комментарий

- [x] 3. Реализовать компонент `MiniAppConsentDialog`
  - [x] 3.1 Каркас модального компонента и презентация текста правил
    - Создать `src/components/mini-apps/MiniAppConsentDialog.tsx` на базе `react-native` `Modal` в стиле существующих оверлеев (прозрачный backdrop, карточка, `ModalStatusBar` для iOS)
    - Реализовать `MiniAppConsentDialogProps`: `visible`, `mode: 'publish' | 'edit'`, `onAccept`, `onDecline`
    - Объявить модуль-уровневые HTTPS-литералы `TERMS_URL = 'https://legal.san-m-app.com/terms.html'` и `PRIVACY_URL = 'https://legal.san-m-app.com/privacy.html'`
    - Рендерить заголовок, intro и текст о запрещённом контенте, о политиках Apple App Store / Google Play и о Terms/Privacy San строго из ключей `mini_apps.consent.*` (без хардкода); метка Accept зависит от `mode` (`accept`/`accept_edit`)
    - Закрытие по фону / `onRequestClose` трактовать как Decline
    - _Requirements: 1.3, 3.1, 3.2, 3.3, 5.1, 5.5_

  - [x] 3.2 Ссылки Terms/Privacy и кнопки Accept/Decline
    - Две нажимаемые ссылки (Terms, Privacy) с `accessibilityRole="link"`, вызывающие `openLegalLink(TERMS_URL | PRIVACY_URL, onError)`; `onError` показывает `mini_apps.consent.link_error` и оставляет диалог открытым без изменения состояния согласия
    - Accept и Decline — два визуально различимых `Pressable` (Accept — акцентный, Decline — вторичный), вызывающие `onAccept` / `onDecline`
    - _Requirements: 3.4, 3.5, 3.6, 3.7_

  - [x] 3.3 Доступность диалога
    - При открытии перемещать фокус Screen_Reader на заголовок через `AccessibilityInfo.setAccessibilityFocus` на `ref` заголовка; контейнер с `accessibilityViewIsModal` для удержания фокуса
    - Непустые `accessibilityLabel` для Accept (`accept_a11y`), Decline (`decline_a11y`) и ссылок (`terms_link_a11y`, `privacy_link_a11y`)
    - Резервные встроенные метки на случай пустого i18n-значения — элемент остаётся активируемым
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x]* 3.4 Рендер-тесты компонента (примеры)
    - Диалог рендерит Accept, Decline и текст правил; тексты о магазинах и о Terms/Privacy San
    - Ссылки имеют `accessibilityRole="link"` и непустые метки; нажатие вызывает `openLegalLink` с правильным URL
    - Accept/Decline имеют непустые `accessibilityLabel`
    - Рендер при `locale='ru'` и `locale='en'` даёт разные строки без сырых ключей
    - Открытие вызывает `AccessibilityInfo.setAccessibilityFocus` на заголовке; контейнер имеет `accessibilityViewIsModal`
    - _Requirements: 1.3, 3.1, 3.2, 3.3, 3.4, 3.5, 5.1, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 4. Checkpoint — убедиться, что компонент и утилита собираются и тесты проходят
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Интегрировать «единые ворота» согласия в `app/settings/mini-apps.tsx`
  - [x] 5.1 Состояние ворот и `handleSavePress` (валидация + открытие)
    - Добавить состояние `consentVisible: boolean` и `pendingMode: 'publish' | 'edit'`
    - Разбить `handleCreate` на `handleSavePress`: при пустых `name`/`url` (вкл. whitespace) или отсутствии `user?.id` показать `Alert(common.error, mini_apps.error.fill_fields)` и НЕ открывать диалог; иначе установить `pendingMode` (`edit` если `editingApp`, иначе `publish`) и `setConsentVisible(true)`
    - Переключить кнопку формы с `onPress={handleCreate}` на `onPress={handleSavePress}`
    - До решения пользователя не выполнять ни одного сетевого вызова
    - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 4.5_

  - [x] 5.2 `handleConsentAccept` — маршрутизация отправки (неразрушающий PATCH для edit)
    - При Accept: `setConsentVisible(false)`, `setCreating(true)`, нормализовать URL (`https://`-префикс при отсутствии схемы)
    - Для `edit` — вызвать неразрушающий `updateApp(editingApp.id, { name, description, emoji, url })` вместо `deleteApp + createApp`
    - Для `publish` — вызвать `createApp({ creator_id, name, description, emoji, url })`
    - При успехе — `showToast` и `resetForm`; при `{ error }` — `setCreating(false)`, `Alert(common.error, error)` и НЕ вызывать `resetForm` (черновик/изменения сохранены)
    - _Requirements: 1.5, 2.3, 2.5, 4.1, 4.2, 4.6_

  - [x] 5.3 `handleConsentDecline` и монтаж диалога
    - `handleConsentDecline`: `setConsentVisible(false)`, без сетевых вызовов, без изменения полей формы
    - Смонтировать `<MiniAppConsentDialog visible={consentVisible} mode={pendingMode} onAccept={handleConsentAccept} onDecline={handleConsentDecline} />` на экране
    - _Requirements: 1.6, 2.4, 4.3, 4.4_

  - [x] 5.4 HTTPS-ссылки Terms/Privacy внизу формы
    - Добавить внизу формы две нажимаемые HTTPS-ссылки на Terms_Page и Privacy_Page через `openLegalLink`
    - _Requirements: 9.1, 9.2_

  - [x]* 5.5 Property-тест: gating (нет отправки без Accept)
    - Извлечь чистую логику ворот (`handleSavePress`/`handleConsentAccept`/`handleConsentDecline` с инъекцией мока `createApp`/`updateApp`)
    - **Property 1: Gating — нет отправки в worker без явного Accept** — для любого валидного состояния и режима до Accept `createApp` и `updateApp` вызваны 0 раз, а Save переводит диалог в открытое состояние
    - **Validates: Requirements 1.1, 1.2, 2.1, 2.2, 4.3, 4.5**
    - Генератор `validMiniAppForm`; fast-check `{ numRuns: 100 }`, тег-комментарий

  - [x]* 5.6 Property-тест: Accept → ровно один корректный вызов
    - **Property 2: Accept приводит ровно к одному корректному вызову отправки** — `createApp` с нормализованным `{name, description, emoji, url}` для `publish` либо `updateApp(editingApp.id, updates)` для `edit`, диалог закрывается
    - **Validates: Requirements 1.5, 2.3, 4.1, 4.2**
    - fast-check `{ numRuns: 100 }`, тег-комментарий

  - [x]* 5.7 Property-тест: Decline сохраняет черновик и не обращается к сети
    - **Property 3: Decline сохраняет черновик и не обращается к сети** — 0 вызовов `createApp`/`updateApp`, диалог закрыт, снимок полей (`name`, `description`, `emoji`, `url`, `editingApp`) неизменён
    - **Validates: Requirements 1.6, 2.4, 4.4**
    - fast-check `{ numRuns: 100 }`, тег-комментарий

  - [x]* 5.8 Property-тест: невалидные поля не открывают диалог
    - **Property 4: Невалидные поля не открывают диалог и не вызывают сеть** — при пустых/whitespace `name` или `url` показывается ошибка заполнения, диалог остаётся закрытым, 0 сетевых вызовов
    - **Validates: Requirements 1.4**
    - Генератор `invalidField`; fast-check `{ numRuns: 100 }`, тег-комментарий

  - [x]* 5.9 Property-тест: ошибка отправки сохраняет данные
    - **Property 5: Ошибка отправки после Accept сохраняет введённые данные** — при `{ error }` от store показывается сообщение об ошибке, поля без изменений, `resetForm` не вызывается
    - **Validates: Requirements 2.5, 4.6**
    - fast-check `{ numRuns: 100 }`, тег-комментарий

  - [x]* 5.10 Рендер-тест экрана: HTTPS-ссылки
    - Mini_Apps_Screen отображает нажимаемые HTTPS-ссылки на Terms/Privacy; нажатие вызывает `openLegalLink` с корректным URL
    - _Requirements: 9.1, 9.2_

- [x] 6. Checkpoint — убедиться, что интеграция работает и тесты проходят
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Обновить `docs/terms.html` — раздел о запрещённом контенте мини-приложений
  - [x] 7.1 Раздел Mini_App в обоих языковых блоках
    - В блок `data-lang="en"` добавить раздел о Mini_App: явный запрет публиковать Prohibited_Content + список категорий (illegal content, child sexual exploitation, hate speech, harassment, violence, malicious code, intellectual-property infringement) + требование соответствия политикам Apple App Store и Google Play
    - В блок `data-lang="ru"` добавить зеркальный раздел с тем же набором категорий и упоминанием политик магазинов (смысловой паритет)
    - Перечень категорий согласовать с текстом Consent_Dialog и существующим §2 «Acceptable use»
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 7.2 Дата и перекрёстная навигация
    - Обновить `Last updated` / `Последнее обновление` в обоих блоках на дату публикации в формате ISO `YYYY-MM-DD`
    - Подтвердить, что блок `.nav` содержит относительную HTTPS-ссылку на `privacy.html`
    - _Requirements: 7.5, 9.3_

- [x] 8. Обновить `docs/privacy.html` — раздел о пользовательском контенте мини-приложений
  - [x] 8.1 Раздел Mini_App в обоих языковых блоках
    - В блок `data-lang="en"` добавить раздел `Mini apps and user content`: категории контента, ответственность пользователя за публикуемый контент, механизмы жалоб и блокировки (reporting & blocking), срок реагирования на жалобы — 24 часа
    - В блок `data-lang="ru"` добавить зеркальный раздел с тем же набором тем (паритет содержания)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 8.2 Дата и перекрёстная навигация
    - Обновить оба поля `.updated` на формат ISO `YYYY-MM-DD`
    - Подтвердить, что блок `.nav` содержит относительную HTTPS-ссылку на `terms.html`
    - _Requirements: 8.5, 9.4_

- [x] 9. Финальный checkpoint — убедиться, что все тесты проходят
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Задачи, помеченные `*`, опциональны (property- и рендер-тесты) и могут быть пропущены для ускоренного MVP; основные задачи реализации не пропускаются.
- Каждая задача ссылается на конкретные требования для трассируемости.
- Property-тесты используют **fast-check** поверх Jest, минимум **100 итераций** (`{ numRuns: 100 }`), каждое свойство — один тест с тег-комментарием `// Feature: mini-app-content-policy-consent, Property {N}: {текст}`.
- Логика ворот тестируется через чистый извлечённый редьюсер/хелперы с моками `createApp`/`updateApp`, без сети и без рендера нативного дерева.
- Путь редактирования переведён с деструктивного `deleteApp + createApp` на неразрушающий `updateApp` (PATCH).
- **Поставка**: JS/UI-часть отгружается через OTA (`eas update`) — без нового нативного билда и без новых нативных разрешений; страницы `docs/` публикуются через GitHub Pages при push в `main` на `https://legal.san-m-app.com/`. Эти каналы независимы.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "7.1", "8.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "3.1", "7.2", "8.2"] },
    { "id": 2, "tasks": ["3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 5, "tasks": ["5.5", "5.6", "5.7", "5.8", "5.9", "5.10"] }
  ]
}
```
