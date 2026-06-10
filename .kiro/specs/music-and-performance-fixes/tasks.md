# Implementation Plan

## Overview

Методология багфикса: сначала воспроизводим дефекты на НЕисправленном коде (exploratory),
фиксируем сохраняемое поведение (preservation) на unfixed-коде, затем применяем правки и
подтверждаем их теми же тестами (fix-checking) + property-based/unit/integration.
Для багов производительности (Property 5) детерминированного булева оракула нет — они
верифицируются структурно (мемоизация/виртуализация/стабильные колбэки) и профайлером.

## Tasks

- [x] 1. Exploratory: воспроизвести дефекты с булевым оракулом на НЕисправленном коде
  - **Property 1: Bug Condition** — Полный/релевантный поиск и согласованный host (1.1–1.3)
  - **IMPORTANT**: Эти property-based тесты пишутся ДО внесения исправлений
  - **GOAL**: Surface counterexamples, подтверждающие первопричины из design.md
  - Замокать `fetch` для Audius (отдаёт N>1 треков) и `expo-av` (`Audio.Sound.createAsync`/`unloadAsync` со счётчиком активных инстансов и искусственной задержкой)
  - Поиск (1.1/1.2): вызвать текущий `handleSend`/`searchTracks(q, 1)` → наблюдать единственный результат и отсутствие сортировки по релевантности
  - Host (1.3): на unfixed-коде у `Track` нет поля `sourceHost` → инвариант `streamUrl.host === sourceHost` неприменим/падает
  - **Property 4: Bug Condition** — Гонка звука (1.7): два почти одновременных `play(A)`/`play(B)` с задержкой в `createAsync` → `countActiveSoundInstances()` достигает 2
  - **Property 2 (виджет): Bug Condition** — Подмена трека (1.4): орфанный status-колбэк пишет в стор после смены `current` → `isPlaying`/позиция искажаются
  - **Property 3: Bug Condition** — Крестик (1.5): `recent=[A,B,C]`, `current=A` → крестик всё равно отрисован
  - **Property 6: Bug Condition** — Меню (1.11/1.13): 5 быстрых `onLongPress` подряд в профиле → `setContextPost` вызывается многократно, открытий меню > 1
  - **EXPECTED OUTCOME**: тесты ПАДАЮТ на unfixed-коде (это подтверждает наличие багов)
  - **DO NOT** чинить тест или код на этом шаге
  - Зафиксировать найденные counterexamples (`countActiveSoundInstances() == 2`; крестик виден при непустой очереди; >1 открытие меню за окно дребезга)
  - Отметить задачу выполненной, когда тесты написаны, запущены и падения задокументированы
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.11, 1.13_

- [x] 2. Preservation: зафиксировать сохраняемое поведение на НЕисправленном коде
  - **Property 8: Preservation** — Неизменность поведения вне условий багов (¬C(X))
  - **IMPORTANT**: Observation-first — сначала наблюдаем поведение unfixed-кода, затем фиксируем его в тестах
  - Toggle того же трека (3.1): `play(current.id)` при загруженном `sound` → переключает play/pause, `current.id` неизменен — наблюдать и зафиксировать
  - **Property 3 (¬C): Preservation** — Без очереди крестик виден (3.5/Property 3): `recent=[A]`, `current=A` → крестик отображается
  - Выбор из очереди (3.6): тап по элементу очереди воспроизводит именно его
  - Офлайн история (3.4/3.5): при недоступной сети история музыки и кэш списков читаются из MMKV без сбоев
  - Одиночный long-press (3.9/3.10): один long-press открывает то же меню; выбор действия выполняется корректно
  - Написать property-based тесты, покрывающие наблюдённые инварианты по домену входов ¬C(X)
  - **EXPECTED OUTCOME**: тесты ПРОХОДЯТ на unfixed-коде (фиксируют базовое поведение, которое нельзя нарушить)
  - Отметить задачу выполненной, когда тесты написаны, запущены и проходят на unfixed-коде
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

- [x] 3. Переиспользуемые модули (модульность и масштабируемость)

  - [x] 3.1 Создать `src/hooks/useDebouncedCallback.ts`
    - Общий хук debounce/throttle: ведущий вызов сразу, последующие в пределах окна игнорируются
    - Сигнатура `useDebouncedCallback(fn, delayMs): (...args) => void`
    - _Requirements: 2.13_

  - [x] 3.2 Создать `src/hooks/useContextMenuGuard.ts`
    - Унифицировать существующую логику `menuLockRef` из чата/комментариев
    - API `{ open, close, target } = useContextMenuGuard<T>({ lockMs: 500, closeLockMs: 350 })`
    - `open(item)`: если `now < lock` → no-op; иначе lock и `setTarget(prev => prev ?? item)` внутри `requestAnimationFrame`
    - `close()`: `setTarget(null)`; продлить lock на `closeLockMs`
    - _Requirements: 2.11, 2.12, 2.13_

  - [x] 3.3 Добавить контроль аудио (generation-token) в `src/store/musicStore.ts` / `src/services/audioController.ts`
    - Ввести модульные `let playGen = 0` и промис-мьютекс `let playChain: Promise<void> = Promise.resolve()`
    - Инкапсулировать сериализацию `play()` и гарантию единственного активного `Audio.Sound`
    - _Requirements: 2.7_

  - [x] 3.4 Добавить `scoreTrackRelevance` и поле `sourceHost` в `src/services/musicService.ts`
    - В интерфейс `Track` добавить `sourceHost: string`
    - `scoreTrackRelevance(track, query)` — учёт точного/частичного совпадения `title`/`artist`, нормализация регистра/диакритики, приоритет совпадения названия
    - _Requirements: 2.2, 2.3_

  - [x] 3.5 Подготовить мемоизированные карточки-компоненты
    - Ввести `TrackResultCard` (мемоизированная карточка результата поиска) для музыкального чата (текущий `MemoTrackCard` локально объявлен в `app/chat/music.tsx` — вынести в отдельный файл `src/components/ui/TrackResultCard.tsx`)
    - Ввести `UserProfilePostCard` для `app/profile/[id].tsx` по образцу `ProfilePostCard`
    - _Requirements: 2.1, 2.10_

- [x] 4. Блок A — Музыкальный модуль

  - [x] 4.1 Расширить и упорядочить поиск в `src/services/musicService.ts`
    - `mapTrack(t, host)`: записывать `sourceHost: host`, `streamUrl` оставить производным от того же `host` (инвариант Property 1)
    - `searchTracks(query, limit = 20)`: увеличить дефолтный лимит; при недостатке результатов добирать с резервных хостов и объединять по `id` (дедупликация), сохраняя `sourceHost`
    - Применить сортировку `results.sort(by scoreTrackRelevance desc)`
    - Сохранить таймауты/`AbortController` и fallback по хостам (офлайн-устойчивость)
    - _Bug_Condition: isBugCondition_Search(X) → trim(query) ≠ "" AND existsRelevantTracks(query)_
    - _Expected_Behavior: length(r) ≥ 1 AND isOrderedByRelevance(r) AND ∀r: r.streamUrl.host = r.sourceHost_
    - _Preservation: 3.4, 3.5 (история/кэш и офлайн без сбоев)_
    - _Requirements: 2.1, 2.2, 2.3 / Property 1_

  - [x] 4.2 Список результатов в `app/chat/music.tsx`
    - В `handleSend` заменить `searchTracks(q, 1)` на `searchTracks(q)`; хранить в сообщении массив `tracks: Track[]`
    - Рендерить список через мемоизированный `TrackResultCard`; автоплей по первому (наиболее релевантному) результату из отсортированного списка
    - Сохранить синхронное чтение/запись истории MMKV и существующую структуру `FlatList`
    - _Bug_Condition: isBugCondition_Search(X)_
    - _Preservation: 3.4 (история запросов MMKV), 3.7 (оформление)_
    - _Requirements: 2.1, 2.2 / Property 1_

  - [x] 4.3 Устранить гонку `play()` в `src/store/musicStore.ts`
    - Обернуть тело `play()` в сериализацию: `const myGen = ++playGen;` выполнять в `playChain`
    - Перед `createAsync` всегда `unloadAsync` существующего `sound`, затем создавать новый
    - После каждого `await` проверять `if (myGen !== playGen)` → выгрузить созданный звук и выйти
    - В status-колбэке игнорировать обновления при `myGen !== playGen` (отсечь орфанные колбэки) — устраняет подмену (1.4)
    - Сохранить семантику «тот же трек → toggle» (3.1) и выбор из очереди (3.6)
    - _Bug_Condition: isBugCondition_Concurrent(X) (наложенные play()); isBugCondition_Widget(X) (current ≠ null)_
    - _Expected_Behavior: countActiveSoundInstances() ≤ 1; store.current.id неизменен_
    - _Preservation: 3.1, 3.6_
    - _Requirements: 2.4, 2.7 / Property 2, Property 4_

  - [x] 4.4 Крестик и анимация в `src/components/ui/MusicMiniBar.tsx`
    - Крестик (1.5): рендерить `<Pressable onPress={stop}>` только при `queue.length === 0`; иначе скрывать (Property 3)
    - Тап (1.4): основная область только разворачивает/сворачивает; play/pause вызывает `toggle()` над `current` — никаких `play(otherTrack)`
    - Анимация (1.6): slide/drag на `useNativeDriver: true`; раскрытие очереди через `LayoutAnimation.configureNext(...)`; мемоизировать строки очереди; вынести прогресс в отдельный лёгкий компонент, чтобы 500-мс обновления не ре-рендерили весь виджет
    - Сохранить свайп-вверх для остановки (3.3)
    - _Bug_Condition: isBugCondition_CloseButton(X) → queue.length > 0; isBugCondition_Widget(X)_
    - _Expected_Behavior: closeButtonVisible'(X) = false при очереди; current.id неизменен_
    - _Preservation: 3.2, 3.3, 3.6 / Property 7 (гладкая анимация без смены видимых состояний)_
    - _Requirements: 2.4, 2.5, 2.6 / Property 2, Property 3, Property 7_

- [x] 5. Блок B — Производительность и рендеринг

  - [x] 5.1 Табы: `app/(tabs)/_layout.tsx` и `app/(tabs)/index.tsx`
    - Убедиться, что `CustomTabBar` обёрнут в `React.memo`, а `tabBarIcon`/`screenOptions` стабильны (вынесены за пределы рендера)
    - Перенести тяжёлую работу при фокусе (`prefetchImages`, `updateFeedWidget`, чтения MMKV) в `InteractionManager.runAfterInteractions(...)`
    - Стабилизировать `renderPost`/колбэки через `useCallback`; проверить, что мемоизированный `PostCard` не получает новые ссылки на пропсы
    - Сохранить набор экранов, состояние авторизации и `AuthNavigationGuard`
    - _Bug_Condition: isBugCondition_Perf(X), screen = Tabs_
    - _Expected_Behavior: noUnnecessaryRerenders, mainThreadNotBlocked, interactionRemainsResponsive_
    - _Preservation: 3.7, 3.8_
    - _Requirements: 2.8 / Property 5_

  - [x] 5.2 Тяжёлый чат: `app/chat/[id].tsx`
    - Стабилизировать все колбэки в `MemoMessageBubble` (`onReply`, `onLongPress`, `onSwipeActive`, `onImagePress`) через `useCallback`
    - Добавить кастомный компаратор в `React.memo(MessageBubble, ...)` по релевантным полям (`id`, `text`, `highlighted`, `imageUrls`, настройки бабла) по образцу `chat/ai.tsx`
    - Настроить виртуализацию `FlatList`: `removeClippedSubviews`, `maxToRenderPerBatch`, `windowSize`, `initialNumToRender`; сохранить `onScrollToIndexFailed` retry
    - _Bug_Condition: isBugCondition_Perf(X), screen = HeavyChat_
    - _Expected_Behavior: usesVirtualizationAndMemoization, mainThreadNotBlocked_
    - _Preservation: 3.7_
    - _Requirements: 2.9 / Property 5_

  - [x] 5.3 Вкладки профиля: `app/profile/[id].tsx`, `UserProfilePostCard`, `app/(tabs)/profile.tsx`
    - Вынести инлайновую карточку поста в мемоизированный `UserProfilePostCard` со стабильным `onLongPress`/`onImagePress`
    - Применить отложенное монтирование вкладки «Посты» (`postsReady` + `requestAnimationFrame`) как в `(tabs)/profile.tsx`
    - Рассмотреть замену `.map()` в ScrollView на `FlatList`/`FlashList` при больших списках; сохранить оформление (3.7)
    - Перенести тяжёлую работу при фокусе `(tabs)/profile.tsx` в `InteractionManager.runAfterInteractions(...)`
    - _Bug_Condition: isBugCondition_Perf(X), screen = ProfileTabs_
    - _Expected_Behavior: noUnnecessaryRerenders, usesVirtualizationAndMemoization_
    - _Preservation: 3.7_
    - _Requirements: 2.10 / Property 5_

- [x] 6. Блок C — Контекстные меню / модальные окна

  - [x] 6.1 Внедрить `useContextMenuGuard` в профиль
    - В `app/(tabs)/profile.tsx` и `app/profile/[id].tsx` заменить прямые `setContextPost(p)` на `open(p)` (lock 500 мс, prev-preserve, `requestAnimationFrame`) и `close()` в `onClose` `PostContextMenu`
    - _Bug_Condition: isBugCondition_ContextMenu(X) (rapid/overlapping long-press)_
    - _Expected_Behavior: mainThreadNotBlocked, countActiveMenuInstances() ≤ 1_
    - _Preservation: 3.9, 3.10_
    - _Requirements: 2.11, 2.13 / Property 6_

  - [x] 6.2 Рефакторинг чата и комментариев на общий guard
    - Перевести существующие `menuLockRef`/`openMenu`/`openCommentMenu` в `app/chat/[id].tsx` и `app/comments/[id].tsx` на `useContextMenuGuard` (поведение идентично текущему — без регрессий)
    - _Bug_Condition: isBugCondition_ContextMenu(X)_
    - _Preservation: 3.9, 3.10_
    - _Requirements: 2.12, 2.13 / Property 6_

  - [x] 6.3 Реэнтрант-защита в `PostContextMenu.tsx` и `CommentContextMenu.tsx`
    - При дребезге `visible` не перезапускать анимацию, если уже открыто/в переходе; гарантировать единственный активный экземпляр
    - Действия меню и оформление не менять
    - _Bug_Condition: isBugCondition_ContextMenu(X) (opensWhileTransitioning)_
    - _Expected_Behavior: countActiveMenuInstances() ≤ 1, appRemainsResponsive_
    - _Preservation: 3.9, 3.10_
    - _Requirements: 2.11, 2.12, 2.13 / Property 6_

- [x] 11. Блок D — Дополнительные музыкальные UX‑дефекты и long‑press на превью

  - [ ] 11.1 Убрать двойной индикатор поиска в `app/chat/music.tsx` (1.14)
    - Удалить глобальный индикатор из `ListHeaderComponent` (BlurView «Ищу...»)
    - Оставить ровно один inline‑индикатор внутри сообщения‑баббла, привязанный к `msg.id`, активный когда `tracks === undefined`
    - _Bug_Condition: isBugCondition_DoubleIndicator(X)_
    - _Expected_Behavior: countVisibleSearchIndicators(X) = 1_
    - _Preservation: 3.7_
    - _Requirements: 2.14 / Property 9 (часть 1)_

  - [x] 11.2 Дедуп по `(title, artist)` в `src/services/musicService.ts` (1.15)
    - В `searchTracks` после сборки `byId` (перед сортировкой) дедуплицировать по нормализованной паре `(normalize(title), normalize(artist))`
    - При коллизии оставить запись с большим `scoreTrackRelevance(track, q)`; при равенстве score — full‑length (`isPreview === false`) приоритетнее `isPreview === true`
    - Использовать существующую функцию `normalize`
    - _Bug_Condition: isBugCondition_DuplicateResults(X)_
    - _Expected_Behavior: ∀ пар (a,b) в результате: NOT (normalize(a.title)=normalize(b.title) AND normalize(a.artist)=normalize(b.artist))_
    - _Requirements: 2.15 / Property 9 (часть 2)_

  - [x] 11.3 Поле `isPreview` и приоритет full‑length в `src/services/musicService.ts` (1.16)
    - В интерфейс `Track` добавить `isPreview: boolean`
    - `mapTrack` (Audius) выставляет `isPreview: false`; `mapItunesTrack` — `isPreview: true`
    - Вторичный ключ сортировки в `searchTracks`: при близких score full‑length поднимается над превью (`isPreview ? 0 : 1`)
    - _Bug_Condition: isBugCondition_PreviewOnly(X)_
    - _Expected_Behavior: full‑length с той же (title, artist) идёт выше превью_
    - _Requirements: 2.16 / Property 10 (часть b)_

  - [x] 11.4 UI‑бейдж «30 с» для превью в карточке и виджете (1.16)
    - В `TrackCard` (`app/chat/music.tsx`) и в `MusicMiniBar` рядом с длительностью/прогрессом отображать маленький бейдж «30 с» (или иконку), если `track.isPreview === true`
    - Стиль лёгкий, цвет `text.tertiary`, не отвлекающий
    - _Bug_Condition: isBugCondition_PreviewOnly(X)_
    - _Expected_Behavior: uiHasPreviewBadge(track) = true при isPreview = true_
    - _Preservation: 3.7 (оформление в остальном неизменно)_
    - _Requirements: 2.16 / Property 10 (часть a)_

  - [x] 11.5 Надёжный play/pause в `TrackCard` (`app/chat/music.tsx`) и `MusicMiniBar` (1.17)
    - В `TrackCard.onPress` оставить единственную семантику `useMusicStore.getState().play(track)`; стор сам различает «тот же трек → toggle» (уже реализовано в `play`)
    - В `MusicMiniBar`: кнопка play/pause вызывает `useMusicStore.getState().toggle()` (а НЕ `play(...)`); состояние кнопки — ТОЛЬКО из `useMusicStore((s) => s.isPlaying)`, без локальных дублирующих state
    - `current` в обоих местах подписан через `useMusicStore((s) => s.current)`, чтобы UI обновлялся при смене трека
    - _Bug_Condition: isBugCondition_TogglePlay(X)_
    - _Expected_Behavior: store.current.id неизменен; store.isPlaying инвертируется; UI кнопки соответствует store.isPlaying_
    - _Preservation: 3.1 (toggle того же трека), 3.6 (выбор из очереди)_
    - _Requirements: 2.17 / Property 11_

  - [x] 11.6 Long‑press на превью/видео/картинке‑ссылке в чатах и комментариях (1.18)
    - Прокинуть `onLongPress?: () => void` пропом в дочерние интерактивные компоненты бабла: `LinkPreview`, `VideoMessage`, `LinkedImage` (если такие есть в `src/components/ui/`); внутри них передать его в `Pressable`/`TouchableOpacity`, чтобы long‑press жест больше не «съедался» дочерним обработчиком
    - В `app/chat/[id].tsx` и `app/comments/[id].tsx` пробросить тот же обработчик меню (через `useContextMenuGuard`) в эти под‑компоненты бабла, чтобы long‑press открывал то же меню, что и для текста/GIF
    - Альтернативный путь, если пропсы трудно прокинуть: обернуть весь bubble в `LongPressGestureHandler` (`react-native-gesture-handler`) с `simultaneousHandlers`, чтобы long‑press конкурировал с дочерними тапами и не блокировался
    - _Bug_Condition: isBugCondition_LongPressOnPreview(X)_
    - _Expected_Behavior: contextMenuOpen(screen) = true; menuActions(screen) = menuActions_textBubble(screen)_
    - _Preservation: 3.9, 3.10, 3.11 (текст и GIF продолжают работать)_
    - _Requirements: 2.18 / Property 12_

- [ ] 7. Fix-checking: подтвердить исправления теми же тестами из задач 1–2

  - [ ] 7.1 Перезапустить exploratory-тесты на ИСПРАВЛЕННОМ коде
    - **Property 1: Expected Behavior** — поиск возвращает несколько результатов, упорядоченных по релевантности, `∀r: r.streamUrl.host = r.sourceHost`
    - **Property 4: Expected Behavior** — `countActiveSoundInstances() <= 1` после наложенных `play()`
    - **Property 2: Expected Behavior** — `store.current.id` неизменен после действий по виджету
    - **Property 3: Expected Behavior** — крестик скрыт при непустой очереди
    - **Property 6: Expected Behavior** — `countActiveMenuInstances() <= 1` при быстрых long-press
    - **Property 9: Expected Behavior** — один индикатор поиска, отсутствие визуальных дубликатов
    - **Property 10: Expected Behavior** — превью помечен `isPreview` и full‑length приоритетнее в выдаче
    - **Property 11: Expected Behavior** — кнопка play/pause в карточке/виджете надёжно переключает воспроизведение
    - **Property 12: Expected Behavior** — long‑press на превью/видео/картинке‑ссылке открывает меню
    - **IMPORTANT**: перезапустить ТЕ ЖЕ тесты из задачи 1 — не писать новые (для блока D добавить новые тесты в задачу 8.2)
    - **EXPECTED OUTCOME**: тесты ПРОХОДЯТ (баги исправлены)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17, 2.18 / Property 1, 2, 3, 4, 6, 9, 10, 11, 12_

  - [ ] 7.2 Перезапустить preservation-тесты на ИСПРАВЛЕННОМ коде
    - **Property 8: Preservation** — поведение вне условий багов идентично исходному
    - **IMPORTANT**: перезапустить ТЕ ЖЕ тесты из задачи 2 — не писать новые
    - **EXPECTED OUTCOME**: тесты по-прежнему ПРОХОДЯТ (регрессий нет)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10 / Property 8_

- [ ] 8. Дополнительные unit, property-based и integration тесты (Testing Strategy)

  - [ ] 8.1 Unit-тесты
    - `scoreTrackRelevance` — ранжирование по совпадению title/artist, нормализация регистра
    - `searchTracks` — лимит > 1, дедупликация по `id`, fallback по хостам, `sourceHost == streamUrl.host`
    - `musicStore.play` — generation-token: устаревший вызов/колбэк не меняет стор; «тот же трек → toggle»
    - `useContextMenuGuard` — окно lock игнорирует повторные `open`, `close` продлевает lock
    - `MusicMiniBar` — условный рендер крестика по `queue.length`
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.7, 2.13 / Property 1, 3, 4, 6_

  - [ ] 8.2 Property-based тесты
    - Единственный звук: случайные последовательности `play()`/`toggle()`/навигаций → `countActiveSoundInstances() <= 1`
    - Скрытие крестика: случайные `recent`/`current` → `closeButtonVisible === (queue.length === 0)`
    - Отсутствие подмены: случайные действия по виджету → `current.id` неизменен
    - Guard меню: случайные последовательности long-press с разными интервалами → `countActiveMenuInstances() <= 1`
    - Релевантность поиска: случайные запросы/выдачи → результат отсортирован по убыванию score и host согласован
    - **Блок D**: дедуп по `(title, artist)` — случайные смешанные выдачи Audius+iTunes → нет пар с одинаковой нормализованной парой
    - **Блок D**: приоритет full‑length — при наличии full‑length и preview одной и той же `(title, artist)` full‑length всегда выше
    - **Блок D**: toggle-инвариант — случайные последовательности тапов play/pause в карточке/виджете → `current.id` неизменен, `isPlaying` инвертируется
    - **Блок D**: long‑press на превью/видео/картинке‑ссылке открывает меню — генератор типов вложений → меню открывается с теми же действиями
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.13, 2.15, 2.16, 2.17, 2.18 / Property 1, 2, 3, 4, 6, 9, 10, 11, 12_

  - [ ] 8.3 Integration-тесты
    - Музыка end-to-end: поиск → выбор → уход с экрана → виджет показан → play/pause продолжает текущий трек; повторные входы/выходы не плодят звуки
    - Производительность: переключение табов/вкладок профиля без необоснованных ре-рендеров (React DevTools / why-did-you-render в dev) и плавность по профайлеру на слабом устройстве (структурная проверка Property 5)
    - Контекстные меню: серия быстрых long-press в профиле и комментариях → приложение отзывчиво, открыт ровно один экземпляр; одиночный long-press и действия работают как прежде
    - _Requirements: 2.4, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 3.2, 3.9, 3.10 / Property 2, 4, 5, 6, 8_

- [ ] 9. Checkpoint — убедиться, что все тесты проходят
  - Прогнать весь набор тестов (unit + property-based + integration)
  - Убедиться, что exploratory-тесты теперь проходят, а preservation-тесты не регрессировали
  - При возникновении вопросов — обратиться к пользователю

- [ ] 10. Финальная проверка и публикация
  - **Зависит от завершения всех задач 1–9**
  - Прогнать сборку проекта, полный набор тестов и линтер; убедиться, что всё проходит без ошибок
  - Исправить выявленные проблемы сборки/линтера/тестов, если они появятся
  - Выполнить `git add` нужных файлов (исключая секреты: `.env.local`, `*.p8`, токены) и `git commit` с осмысленным сообщением
  - Выполнить `git push` в ветку `main` на GitHub
  - _Requirements: все (финальная интеграция и публикация)_

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"], "dependsOn": [] },
    { "wave": 2, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5"], "dependsOn": ["1", "2"] },
    { "wave": 3, "tasks": ["4.1", "4.2", "4.3", "4.4", "5.1", "5.2", "5.3", "6.1", "6.2", "6.3", "11.1", "11.2", "11.3", "11.4", "11.5", "11.6"], "dependsOn": ["3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "wave": 4, "tasks": ["7.1", "7.2"], "dependsOn": ["4.1", "4.2", "4.3", "4.4", "5.1", "5.2", "5.3", "6.1", "6.2", "6.3", "11.1", "11.2", "11.3", "11.4", "11.5", "11.6"] },
    { "wave": 5, "tasks": ["8.1", "8.2", "8.3"], "dependsOn": ["7.1", "7.2"] },
    { "wave": 6, "tasks": ["9"], "dependsOn": ["8.1", "8.2", "8.3"] },
    { "wave": 7, "tasks": ["10"], "dependsOn": ["9"] }
  ]
}
```

```
1 (exploratory)  ─┐
2 (preservation) ─┤
                  ▼
              3 (переиспользуемые модули)
                  │
        ┌─────────┼─────────┬───────────┐
        ▼         ▼         ▼           ▼
   4 (Блок A) 5 (Блок B) 6 (Блок C)  11 (Блок D)
        └─────────┼─────────┴───────────┘
                  ▼
        7 (fix-checking: 7.1, 7.2)
                  ▼
        8 (unit/PBT/integration)
                  ▼
            9 (Checkpoint)
                  ▼
      10 (Финальная проверка и публикация)
```

- Задачи 1 и 2 выполняются ПЕРВЫМИ на НЕисправленном коде (1 — падает, 2 — проходит).
- Задача 3 (переиспользуемые модули) предшествует блокам реализации 4, 5, 6, 11.
- Блоки 4, 5, 6, 11 опираются на модули из задачи 3; задачи 4.x используют 3.3/3.4/3.5, 6.x — 3.2; задачи 11.x опираются на уже реализованный Блок A.
- Задача 7 перезапускает ТЕ ЖЕ тесты из 1 и 2 после реализации (4–6, 11), но добавляет покрытие новых Property 9–12 в задачу 8.2.
- Задача 8 добавляет расширенное покрытие, 9 — общий checkpoint.
- Задача 10 (публикация) зависит от успешного завершения всех задач 1–9 и 11.

## Notes

- Тесты пишутся под существующий стек проекта (Jest + property-based, см. `src/**/__tests__/*.property.test.ts`).
- Exploratory-тесты (задача 1) ДОЛЖНЫ падать на unfixed-коде — это подтверждает наличие багов; не чинить их преждевременно.
- Preservation-тесты (задача 2) ДОЛЖНЫ проходить на unfixed-коде — это фиксирует базовое поведение (¬C(X)).
- Property 5 (производительность) не имеет детерминированного булева оракула: верификация структурная (мемоизация/виртуализация/стабильные колбэки) + профайлер на слабом устройстве.
- Долго работающие процессы (dev-сервер, watch) запускает пользователь вручную; для тестов использовать одиночный прогон (`--run`/CI-режим).
- В задаче 10 не коммитить секреты: `.env.local`, `AuthKey_*.p8`, токены.
