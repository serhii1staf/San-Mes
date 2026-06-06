# Implementation Plan: per-account-cache

## Overview

План закрывает оставшиеся утечки «сырых» ключей AsyncStorage и закрепляет единый паттерн cache-first рендеринга. Инфраструктура (`cacheService.ts`, `syncThrottle.ts`, `_layout.tsx`, `AccountSwitcher.tsx`) уже реализована и не переписывается. Работа состоит в том, чтобы на экранах-нарушителях обернуть базовые ключи в `accountKey()`, загейтить фоновые загрузки через `shouldSync()`, сделать persist-ключ mini-apps пер-аккаунтным, и подтвердить корректность через property-based тесты на 9 свойств из дизайна.

Все задачи используют TypeScript (язык существующего кода). Тестовые подзадачи помечены `*` и являются опциональными.

## Tasks

- [x] 1. Устранить утечку «сырого» ключа на экране ленты
  - [x] 1.1 Перевести `app/(tabs)/index.tsx` на пер-аккаунтный ключ ленты
    - Импортировать `accountKey` из `src/services/cacheService` и `shouldSync` из `src/services/syncThrottle`.
    - Обернуть все ~4 обращения к `FEED_CACHE_KEY = '@san:feed_posts'` в `accountKey(FEED_CACHE_KEY)`: чтение в `useFocusEffect`, чтение в mount-`useEffect`, запись в `loadFeed`, запись в `handleRefresh`.
    - Перед фоновой сетевой загрузкой в `loadFeed` добавить гейт `if (await shouldSync('feed')) { ... }`; при `false` пропустить сеть и оставить кэш.
    - Сохранить существующий вызов `resetThrottle('feed')` в `handleRefresh` (pull-to-refresh).
    - Показывать спиннер (`isLoading`) только при отсутствии кэша; при наличии кэша вызывать `setIsLoading(false)` до сетевого запроса.
    - _Requirements: 2.1, 5.1, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 12.4_

- [x] 2. Устранить утечку «сырого» ключа на экране профиля
  - [x] 2.1 Перевести `app/(tabs)/profile.tsx` на пер-аккаунтный ключ my-posts
    - Импортировать `accountKey`, `shouldSync`, `resetThrottle`.
    - Обернуть оба обращения к `MY_POSTS_CACHE_KEY = '@san:my_posts'` (mount-чтение + запись после `loadMyPosts`) в `accountKey(MY_POSTS_CACHE_KEY)`.
    - Загейтить фоновую `loadMyPosts` через `shouldSync('my_posts')`.
    - В `onRefresh` (pull-to-refresh) вызвать `resetThrottle('my_posts')` перед загрузкой.
    - Сохранить cache-first рендер: если `userPosts.length > 0` в сторе — рисовать сразу без спиннера.
    - _Requirements: 2.2, 5.1, 5.4, 6.1, 6.2, 6.3, 6.4_

- [x] 3. Устранить утечки «сырых» ключей в мутациях постов
  - [x] 3.1 Перевести `app/(tabs)/create.tsx` на пер-аккаунтные ключи
    - Импортировать `accountKey`.
    - В ветке редактирования поста: обернуть чтение+запись фид-кэша (`'@san:feed_posts'`) и my-posts-кэша (`'@san:my_posts'`) в `accountKey(...)`.
    - В ветке создания поста: обернуть запись нового поста в фид-кэш и my-posts-кэш (`slice(0, 20)`) в `accountKey(...)`. Всего ~3 места.
    - Сохранить существующие `.catch(() => {})` на прямых вызовах AsyncStorage.
    - _Requirements: 2.3, 11.3_

  - [x] 3.2 Перевести `app/settings/admin.tsx` на пер-аккаунтные ключи
    - Импортировать `accountKey`.
    - Обернуть удаление поста из фид-кэша (`'@san:feed_posts'`) и из my-posts-кэша (`'@san:my_posts'`) в `accountKey(...)`. Всего 2 места.
    - _Requirements: 2.4_

- [x] 4. Сделать историю поиска account-scoped
  - [x] 4.1 Перевести `app/(tabs)/search.tsx` на пер-аккаунтный ключ истории
    - Импортировать `accountKey`.
    - Обернуть все три операции с `SEARCH_HISTORY_KEY = '@san:search_history'` в `accountKey(SEARCH_HISTORY_KEY)`: `loadHistory` (read), сохранение истории (write), `clearHistory` (remove).
    - _Requirements: 3.1, 3.3, 3.4_

- [x] 5. Сделать persist-ключ mini-apps пер-аккаунтным
  - [x] 5.1 Добавить кастомный `StateStorage` в `src/store/miniAppsStore.ts`
    - Импортировать `accountKey` из `src/services/cacheService` и `AsyncStorage`.
    - Реализовать объект `StateStorage` (`getItem`/`setItem`/`removeItem`), оборачивающий `name` в `accountKey(name)`.
    - Передать этот storage в `persist(..., { name: 'mini-apps-cache', storage: createJSONStorage(() => customStorage) })`, сохранив базовое имя `'mini-apps-cache'`.
    - _Requirements: 3.1, 3.2, 3.4_

- [x] 6. Checkpoint — проверка после устранения утечек
  - Запустить `npm run ts:check`, убедиться в отсутствии ошибок типов на изменённых файлах. Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Подготовить окружение property-based тестов
  - [ ] 7.1* Установить и настроить fast-check + мок AsyncStorage
    - Установить dev-зависимость `fast-check`.
    - Настроить мок `@react-native-async-storage/async-storage` через `@react-native-async-storage/async-storage/jest/async-storage-mock` (in-memory) в jest-конфигурации/setup.
    - Каждый property-тест помечать комментарием-тегом: `// Feature: per-account-cache, Property {N}: {краткий текст свойства}`. Минимум 100 итераций (`{ numRuns: 100 }`).
    - _Requirements: 1.1, 12.3_

- [ ] 8. Property-тесты на логику построения ключей (`cacheService`)
  - [ ]* 8.1 Property-тест изоляции account-scoped ключей
    - **Property 1: Account-scoped ключи изолированы между аккаунтами**
    - Генерировать пары различных id аккаунтов и account-scoped базовые ключи; проверять различие `accountKey` для разных аккаунтов и детерминизм для одного.
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 2.5, 3.4, 9.4**

  - [ ]* 8.2 Property-тест отсутствия namespacing для Global_Shared_Data
    - **Property 2: Global_Shared_Data не неймспейсится**
    - Генерировать ключи с префиксами из `GLOBAL_KEY_PREFIXES` (`@san:profile:`, `@san:all_profiles`) + произвольные id; проверять, что `namespaced(key)` возвращает ключ без изменений.
    - **Validates: Requirements 1.3, 4.1, 4.2, 4.3, 4.4**

  - [ ]* 8.3 Property-тест round-trip записи/чтения в рамках одного аккаунта
    - **Property 3: Запись и чтение account-scoped значения — round-trip в рамках одного аккаунта**
    - Генерировать id + базовый ключ + сериализуемое значение; проверять `cacheSet`→`cacheGet` эквивалентность.
    - **Validates: Requirements 1.2, 1.5, 11.2**

  - [ ]* 8.4 Property-тест изоляции чтения под чужим аккаунтом
    - **Property 4: Чтение под чужим аккаунтом не видит данные другого аккаунта**
    - Записать значение под аккаунтом A, читать тот же базовый ключ под аккаунтом B (B ≠ A); проверять возврат fallback.
    - **Validates: Requirements 1.5, 2.5, 3.4, 9.4, 14.4**

  - [ ]* 8.5 Property-тест anon-фоллбэка при пустом id
    - **Property 5: Anon fallback при пустом id**
    - Генерировать null/undefined/'' как id в `setCacheAccount`; проверять, что `accountKey(baseKey)` использует `anon` (`@acc:anon:${baseKey}`).
    - **Validates: Requirements 14.1, 14.2, 14.3**

  - [ ]* 8.6 Property-тест ограничения ленты MAX_FEED_POSTS
    - **Property 8: Лента ограничена MAX_FEED_POSTS**
    - Генерировать массивы постов произвольной длины; проверять, что сохранённый размер ≤ 200 и сохранены новейшие по `created_at`.
    - **Validates: Requirements 12.3**

  - [ ]* 8.7 Property-тест устойчивости cache-helpers к сбоям AsyncStorage
    - **Property 9: Cache-helpers устойчивы к сбоям AsyncStorage**
    - Принудительно вызывать сбой чтения/записи мока и невалидный JSON; проверять возврат fallback и отсутствие throw.
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4**

- [ ] 9. Property-тесты на тайминг троттла (`syncThrottle`)
  - [ ]* 9.1 Property-тест подавления синхронизации внутри окна
    - **Property 6: shouldSync подавляет повторную синхронизацию внутри окна**
    - Генерировать ключ + интервал + смещения времени (мок `Date.now`); проверять, что после `true` повторный `shouldSync` внутри окна возвращает `false`, а после истечения окна — снова `true`.
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.5, 12.4**

  - [ ]* 9.2 Property-тест снятия подавления через resetThrottle
    - **Property 7: resetThrottle снимает подавление**
    - Для подавлённого ключа вызывать `resetThrottle(key)`; проверять, что следующий `shouldSync(key)` возвращает `true`.
    - **Validates: Requirements 6.4, 11.1**

- [ ] 10. Unit/example тесты на мутации экранов
  - [ ]* 10.1 Unit-тесты для `create.tsx` и `admin.tsx`
    - На моках AsyncStorage: после создания/редактирования поста кэш под `accountKey('@san:feed_posts')` и `accountKey('@san:my_posts')` содержит изменения; удаление в `admin.tsx` убирает пост из обоих namespaced-кэшей.
    - _Requirements: 2.3, 2.4, 11.3_

  - [ ]* 10.2 Unit-тесты для `search.tsx`
    - На моках AsyncStorage: добавление в историю и `clearHistory` затрагивают только `accountKey('@san:search_history')` активного аккаунта.
    - _Requirements: 3.3, 3.4_

- [ ] 11. Final checkpoint — проверка полного покрытия
  - Запустить `npm test` и `npm run ts:check`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Задачи, помеченные `*`, опциональны и могут быть пропущены для ускоренного MVP; основная имплементация (задачи без `*`) обязательна.
- Каждая задача ссылается на конкретные пункты требований для трассируемости.
- Property-тесты валидируют 9 универсальных свойств корректности из раздела Correctness Properties дизайна; UI-рендеринг без видимой перезагрузки и переключение аккаунтов проверяются интеграционно/вручную и не входят в кодовые задачи.
- Инфраструктура (`cacheService.ts`, `syncThrottle.ts`, `_layout.tsx`, `AccountSwitcher.tsx`) не изменяется — фича только устраняет «сырые» ключи и закрепляет паттерн рендеринга.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "3.2", "4.1", "5.1"] },
    { "id": 1, "tasks": ["7.1"] },
    { "id": 2, "tasks": ["8.1", "8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "9.1", "9.2", "10.1", "10.2"] }
  ]
}
```
