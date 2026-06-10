# Дизайн исправления багов: music-and-performance-fixes

## Overview

Этот документ описывает технический дизайн исправления 13 связанных дефектов (1.1–1.13) приложения San-Mes (React Native / Expo, expo-router, Zustand, expo-av, MMKV). Дефекты сгруппированы в три блока:

- **Блок A — Музыкальный модуль** (1.1–1.7): неполный/нерелевантный поиск, рассинхронизация host для стрима, подмена трека при тапе по виджету, всегда видимый «крестик», негладкая анимация виджета и одновременное воспроизведение нескольких треков из-за гонки в `play()`.
- **Блок B — Производительность** (1.8–1.10): лаги при переключении табов, рывки в «тяжёлых» чатах, лаги вкладок профиля (особенно «Посты»).
- **Блок C — Контекстные меню** (1.11–1.13): зависание основного потока при быстром/хаотичном повторном вызове `PostContextMenu` (профиль) и `CommentContextMenu` (комментарии), из‑за гонки состояний и наложенного рендера модального меню.
- **Блок D — Дополнительные музыкальные UX‑дефекты** (1.14–1.18): двойной индикатор поиска, визуальные дубликаты результатов по `(title, artist)`, неинформативное 30‑секундное iTunes‑превью, нереагирующая кнопка play/pause в карточке/виджете, отсутствие контекстного меню по long‑press на превью ссылок/видео/картинок‑ссылок в чатах и комментариях.

Общая стратегия — точечные, минимальные, продакшн‑качества правки, не нарушающие нефункциональные ограничения проекта (производительность, слабые устройства, офлайн). Подход бага‑условия (`C(X)`) применяется к каждому дефекту: исправленный код `F'` должен давать корректное поведение для всех входов, удовлетворяющих `C(X)`, и быть идентичным исходному `F` для всех остальных входов (`¬C(X)`).

Ключевой принцип масштабируемости: повторяющаяся логика выносится в переиспользуемые хуки и утилиты (см. раздел «Переиспользуемые модули»), вместо точечных копий в каждом экране.

## Glossary

- **Bug_Condition (C)** — условие, при котором проявляется дефект (например, наложенные вызовы `play()`, очередь `recent` непуста, быстрые повторные long-press).
- **Property (P)** — требуемое корректное поведение для входов, удовлетворяющих `C` (единственный активный звук, скрытый крестик, отсутствие подмены трека, отзывчивость меню).
- **Preservation** — поведение, которое ДОЛЖНО остаться неизменным для `¬C(X)` (см. раздел Regression Prevention, пп. 3.1–3.10).
- **F / F'** — функция/поведение до и после исправления.
- **`searchTracks(query, limit)`** — функция в `src/services/musicService.ts`: перебирает discovery‑хосты Audius и возвращает массив `Track`.
- **`mapTrack(t, host)`** — маппер сырого ответа Audius в `Track`; формирует `streamUrl` на основе `host`.
- **`useMusicStore.play(track)`** — действие Zustand в `src/store/musicStore.ts`; выгружает предыдущий `Audio.Sound` и создаёт новый.
- **`sound` (module-level)** — единственный экземпляр `Audio.Sound`, разделяемый на уровне приложения.
- **`recent` / `queue`** — список недавно проигранных треков; `queue = recent.filter(t => t.id !== current.id)`.
- **`MusicMiniBar`** — плавающий виджет‑плеер (`src/components/ui/MusicMiniBar.tsx`).
- **`PostContextMenu` / `CommentContextMenu`** — модальные контекстные меню (`src/components/ui/`).
- **`menuLockRef`** — существующий guard‑таймштамп против наложения меню (уже есть в `chat/[id].tsx` и `comments/[id].tsx`, отсутствует в профиле).
- **Generation token (`playGen`)** — монотонный счётчик для отсечения устаревших async‑результатов и status‑колбэков в `play()`.

## Bug Details

### Bug Condition

Багов несколько; для каждого блока формализуется отдельное условие. Общая форма ниже описывает множество входов, на которых текущий код `F` ведёт себя неверно.

**Формальная спецификация (Блок A — музыка):**

```
FUNCTION isBugCondition_Search(X)
  INPUT: X = { query: string }
  OUTPUT: boolean
  RETURN trim(X.query) <> "" AND existsRelevantTracks(X.query)
END FUNCTION

FUNCTION isBugCondition_Widget(X)
  INPUT: X = { action: TapMainArea | TapPlayPause, current: Track }
  OUTPUT: boolean
  RETURN X.current <> null
END FUNCTION

FUNCTION isBugCondition_CloseButton(X)
  INPUT: X = { recent: Track[], current: Track }
  OUTPUT: boolean
  RETURN length(queue(X.recent, X.current)) > 0   // есть другие песни
END FUNCTION

FUNCTION isBugCondition_Concurrent(X)
  INPUT: X = последовательность вызовов play() при входах/выходах из чата музыки
  OUTPUT: boolean
  RETURN containsOverlappingPlayCalls(X)           // второй play() стартует до завершения первого
END FUNCTION
```

**Формальная спецификация (Блок B — производительность):**

```
FUNCTION isBugCondition_Perf(X)
  INPUT: X = { screen: Tabs | HeavyChat | ProfileTabs, contentSize: int }
  OUTPUT: boolean
  RETURN X.screen IN {Tabs, HeavyChat, ProfileTabs}
END FUNCTION
```

**Формальная спецификация (Блок C — контекстные меню):**

```
FUNCTION isBugCondition_ContextMenu(X)
  INPUT: X = { screen: ProfilePost | Comment, openSequence: LongPress[] }
  OUTPUT: boolean
  RETURN containsRapidRepeatedOpens(X.openSequence)
      OR opensWhileTransitioning(X.openSequence)
END FUNCTION
```

### Examples

- **1.1 Поиск:** запрос «Bohemian Rhapsody» → `searchTracks(q, 1)` возвращает максимум 1 карточку; ожидается список релевантных результатов.
- **1.2 Релевантность:** запрос «Imagine» → берётся `results[0]`, который может быть ремиксом/кавером, а не оригиналом; ожидается сортировка по релевантности к названию/исполнителю.
- **1.3 Host:** карточка сформирована хостом `api.audius.co`, но `streamUrl` другого хоста недоступен для стрима → играет «не тот»/ничего; ожидается строгая согласованность `sourceHost` и host в `streamUrl`.
- **1.4 Подмена:** трек A играет, пользователь уходит с экрана, тапает виджет → начинает играть трек B из `recent`; ожидается продолжение трека A.
- **1.5 Крестик:** в `recent` есть 3 трека помимо текущего → крестик всё равно виден; ожидается скрытие.
- **1.6 Анимация:** при раскрытии очереди виджет «прыгает» из‑за неанимированного изменения высоты; ожидается плавный нативный переход.
- **1.7 Гонка:** быстрый повторный вход/выход в чат музыки с запуском треков → играют 2–3 трека одновременно; ожидается единственный активный звук.
- **1.8–1.10 Производительность:** переключение табов/вкладок профиля и открытие тяжёлого чата вызывают просадки кадров и нагрузку CPU; ожидается плавность продакшн‑уровня.
- **1.11–1.13 Меню:** серия быстрых long-press по посту в профиле/комментарию → приложение замораживается; ожидается отзывчивость и единственный экземпляр меню.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors (что НЕ должно измениться):**

- 3.1 Тап по уже играющему текущему треку (в карточке или виджете) продолжает переключать play/pause этого же трека.
- 3.2 При уходе с экрана музыки фоновое воспроизведение продолжается и показывается `MusicMiniBar`.
- 3.3 Свайп виджета вверх по‑прежнему останавливает воспроизведение и скрывает виджет.
- 3.4 История запросов чата музыки восстанавливается из MMKV и сохраняется (в т.ч. офлайн).
- 3.5 Кэшированные данные (история музыки, диалоги, лента, профили) работают офлайн без сбоев.
- 3.6 Выбор трека из развёрнутой очереди виджета воспроизводит именно выбранный трек.
- 3.7 Прокрутка с обычным объёмом контента отображает корректный контент и прежнее оформление.
- 3.8 Переключение табов сохраняет те же экраны, состояние авторизации и `AuthNavigationGuard`.
- 3.9 Одиночный long-press по посту/комментарию открывает то же меню с теми же действиями и оформлением.
- 3.10 Действия меню (копировать, поделиться, ответить, редактировать, удалить, пожаловаться) выполняются как прежде.

**Scope:**
Все входы, не относящиеся к условиям багов — обычное прослушивание, навигация, прокрутка небольших списков, офлайн‑работа, одиночные long-press — должны вести себя идентично исходному коду. Корректное целевое поведение для входов `C(X)` задано в разделе **Correctness Properties**.

## Hypothesized Root Cause

### Блок A — Музыкальный модуль

1. **Узкий лимит и единичный результат (1.1, 1.2)**
   - `app/chat/music.tsx` → `handleSend` вызывает `searchTracks(q, 1)` и использует только `results[0]`. Лимит 1 жёстко обрезает выдачу.
   - `searchTracks` возвращает результаты в порядке ответа Audius без оценки релевантности; маппинг `results.map(...).slice(0, limit)` не пересортировывает по совпадению с запросом.
   - Перебор хостов в `searchTracks` останавливается на ПЕРВОМ хосте с непустой выдачей — охват одним источником, без объединения/добора.

2. **Согласованность host для стрима (1.3)**
   - `mapTrack(t, host)` формирует `streamUrl = ${host}/v1/tracks/${id}/stream`. Сейчас host совпадает с хостом выдачи, НО `Track` не хранит явный `sourceHost`, поэтому инвариант «host стрима = host данных» не выражен в типе и не проверяется; при добавлении объединения хостов он легко нарушается. Кроме того, выбранный discovery‑host может быть исправен для поиска, но недоступен для стрима.

3. **Подмена трека при тапе по виджету (1.4)** — следствие гонки (см. п.5). Status‑колбэк `Audio.Sound`, созданный для предыдущего трека, не имеет привязки к идентичности трека и продолжает писать `isPlaying/positionMs/durationMs` в стор после того, как `current` уже сменился, создавая визуальную/звуковую рассинхронизацию.

4. **Крестик всегда видим (1.5)** — в `MusicMiniBar` блок `<Pressable onPress={stop}>` с иконкой `x` рендерится безусловно, без проверки `queue.length`.

5. **Гонка в `play()` → несколько активных звуков (1.7, и вклад в 1.3/1.4)** — критическая первопричина. В `useMusicStore.play()`:
   ```
   set({ current: track, ... });
   if (sound) { await sound.unloadAsync(); sound = null; }
   const { sound: s } = await Audio.Sound.createAsync(...);
   sound = s;
   ```
   Между `await unloadAsync()` и `await createAsync()` нет мьютекса/токена. Два быстрых `play()` (повторный вход/выход в чат, автоплей после поиска во время незавершённой загрузки) интерливятся: оба доходят до `createAsync`, переменная модуля `sound` перезаписывается ссылкой на ПОСЛЕДНИЙ звук, а предыдущий `Audio.Sound` теряется и НЕ выгружается — продолжает играть. Итог: 2–3 трека одновременно; орфанные status‑колбэки конкурируют за стор.

6. **Негладкая анимация (1.6)** — slide/drag используют `Animated` с `useNativeDriver: true` (это хорошо), но раскрытие очереди меняет высоту через условный рендер без анимации (layout jump), а прогресс‑бар обновляется раз в 500 мс через `set(...)`, провоцируя ре‑рендер всего виджета.

### Блок B — Производительность

7. **Лаги табов (1.8)** — каждый таб при фокусе выполняет синхронную работу: `index.tsx` делает `prefetchImages`, `updateFeedWidget`, синхронные чтения MMKV и переустановку состояния в `useFocusEffect`; `CustomTabBar` и иконки пересоздаются. Тяжёлая работа выполняется на критическом пути переключения, а не отложенно.

8. **Рывки в тяжёлом чате (1.9)** — `MemoMessageBubble = React.memo(MessageBubble)` использует дефолтный поверхностный компаратор, но в него передаются колбэки (`onReply`, `onLongPress`, `onSwipeActive`, `onImagePress`); если они не стабилизированы `useCallback`, меняется ссылка и ре‑рендерится весь список. Нет тонкой настройки виртуализации (`maxToRenderPerBatch`, `windowSize`, `removeClippedSubviews`) под тяжёлый контент.

9. **Лаги вкладок профиля (1.10)** —
   - `(tabs)/profile.tsx` рендерит посты как `.map()` внутри `Animated.ScrollView` (не виртуализованный список). Частично смягчено `visibleCount`/`postsReady` и мемоизированной `ProfilePostCard`, но всё ещё монтирует все видимые карточки разом и держит их в одном ScrollView.
   - `app/profile/[id].tsx` рендерит `displayPosts.slice(0, visibleCount).map(...)` с инлайновым `Pressable` и `SwipeablePostCard` — карточки НЕ вынесены в мемоизированный компонент, поэтому пересобираются при каждом ре‑рендере экрана и при переключении вкладок.

### Блок C — Контекстные меню

10. **Отсутствие guard в профиле (1.11, 1.13)** — `(tabs)/profile.tsx` и `app/profile/[id].tsx` вызывают `setContextPost(p)` напрямую в `onLongPress`, БЕЗ debounce/lock. Быстрые повторные long-press многократно меняют state и перемонтируют `<Modal>` `PostContextMenu` в середине анимации открытия/закрытия, что блокирует основной поток. В `chat/[id].tsx` и `comments/[id].tsx` аналогичная защита уже есть (`menuLockRef` + `setX(prev => prev ? prev : m)` + `requestAnimationFrame`), что подтверждает первопричину: защита есть не везде.

11. **Нет внутренней реэнтрант‑защиты в меню (1.13)** — `PostContextMenu`/`CommentContextMenu` полагаются только на родительский `visible`; при дребезге `visible` модал перезапускает анимацию (`slideAnim.setValue` в `useEffect`), а наложенные `Modal` усиливают нагрузку.

### Блок D — Дополнительные музыкальные дефекты UX

12. **Двойной индикатор поиска (1.14)** — `app/chat/music.tsx` рендерит ОДНОВРЕМЕННО два индикатора в момент поиска: глобальный BlurView в `ListHeaderComponent` (видим при `isSearching`) и inline‑индикатор внутри сообщения‑баббла (видим, когда `tracks === undefined`). Они полностью перекрывают друг друга по семантике и вместе выглядят как баг.

13. **Дубликаты по `(title, artist)` (1.15)** — `searchTracks` объединяет Audius + iTunes через `Map<string, Track>` по `id`. Поскольку id из разных провайдеров никогда не совпадает, одна и та же популярная песня попадает в выдачу дважды (один Audius‑релиз + один iTunes‑превью). Внутри одного Audius может быть несколько разных загрузок одной композиции — тоже разный `id`. Дедупа по нормализованной паре `(title, artist)` нет.

14. **30‑секундное превью без явного признака (1.16)** — `mapItunesTrack` создаёт `Track` со `streamUrl = previewUrl` (30 секунд по дизайну API), но в типе `Track` нет поля `isPreview`. UI карточки и виджета не различает превью и full‑length, поэтому пользователь думает «играет полная песня, но обрывается» — это и есть восприятие бага. Нужен (а) явный признак `isPreview` в типе и UI‑бейдж; (б) ранжирование, которое опускает превью под full‑length для одной и той же `(title, artist)`; (в) попытка добраться до full‑length из других открытых источников (например, дополнительный Audius‑запрос, если первый шаг не нашёл).

15. **Pause/play не реагирует (1.17)** — гипотеза: после fix задачи 4.3 `useMusicStore.play(track)` корректно сериализован, но в карточке (`TrackCard` в `app/chat/music.tsx`) и в виджете (`MusicMiniBar`) кнопка play/pause вызывает либо `play(track)` (что для уже текущего трека срабатывает как toggle, но иногда из‑за ре‑рендера отдаёт старый `track`‑референс), либо отдельный обработчик, который устанавливает `isPlaying` локально и расходится с фактическим состоянием expo‑av. Дополнительно: status‑колбэк может не доходить до стора, если в момент клика стор `current` отличается от того, что играет физически (хвост гонки, исправленной в 4.3, но проявляющийся через UI). Решение: явно различать «тот же трек → toggle()» и «другой трек → play()» в обоих местах через сравнение `current.id === track.id`, и опираться исключительно на `isPlaying` из стора (один источник правды).

16. **Long-press не работает на превью/видео/картинке‑ссылке (1.18)** — в `chat/[id].tsx` и `comments/[id].tsx` обработчик `onLongPress` навешен на корневой контейнер бабла. Для текста и `<Image>` Pressable пробрасывает long-press вверх, но для специальных дочерних компонентов (`LinkPreview`, `VideoMessage`, `LinkedImage`) внутри бабла стоит свой `Pressable`/`TouchableOpacity` без `onLongPress`, который перехватывает жест и не пробрасывает его вверх (RN не bubbles long-press через дочерний touch‑responder). Для GIF (`GifMessage`) обработчик есть, поэтому работает. Решение: пробросить тот же `onLongPress` (через prop из бабла) во все дочерние интерактивные элементы, либо отказаться от внутреннего `Pressable` для них и положиться на корневой обработчик, либо использовать `gesture-handler` `LongPressGestureHandler` с `simultaneousHandlers` для конкуренции.

## Correctness Properties

Property 1: Bug Condition — Полный и релевантный поиск с согласованным host

_For any_ непустого запроса, по которому существуют релевантные треки (isBugCondition_Search → true), исправленный `searchTracks(query, limit)` SHALL возвращать несколько результатов (limit > 1), упорядоченных по релевантности к запросу, и для каждого результата `r` host в `r.streamUrl` SHALL совпадать с `r.sourceHost`.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Bug Condition — Тап по виджету не подменяет трек

_For any_ действия по виджету (тап по основной области или по play/pause) при наличии текущего трека (isBugCondition_Widget → true), исправленный код SHALL сохранять `store.current.id` неизменным (продолжая/возобновляя именно текущий трек) и НЕ переключать на другой трек.

**Validates: Requirements 2.4**

Property 3: Bug Condition — Скрытие крестика при наличии очереди

_For any_ состояния, где `queue(recent, current)` непуста (isBugCondition_CloseButton → true), исправленный виджет SHALL скрывать кнопку закрытия (крестик). _For any_ состояния без очереди (¬C) — SHALL отображать крестик.

**Validates: Requirements 2.5**

Property 4: Bug Condition — Единственный активный экземпляр звука

_For any_ последовательности вызовов `play()` с наложением (isBugCondition_Concurrent → true), после её применения исправленный код SHALL гарантировать `countActiveSoundInstances() <= 1`, корректно выгружая предыдущий звук до старта следующего.

**Validates: Requirements 2.7**

Property 5: Bug Condition — Производительность и отсутствие перегрузки

_For any_ экрана из {Tabs, HeavyChat, ProfileTabs} (isBugCondition_Perf → true), исправленный код SHALL избегать лишних ре‑рендеров, применять виртуализацию и мемоизацию, не блокировать основной поток и сохранять отзывчивость взаимодействия.

**Validates: Requirements 2.8, 2.9, 2.10**

Property 6: Bug Condition — Контекстное меню не зависает

_For any_ последовательности быстрых/наложенных long-press (isBugCondition_ContextMenu → true) на посте профиля или комментарии, исправленный код SHALL открывать меню без блокировки основного потока, сохранять отзывчивость и гарантировать `countActiveMenuInstances() <= 1` (guard/debounce против наложения).

**Validates: Requirements 2.11, 2.12, 2.13**

Property 7: Preservation — Гладкая анимация виджета

_For any_ открытия/закрытия `MusicMiniBar` исправленная анимация SHALL выполняться на нативном драйвере без рывков, не меняя итоговых видимых состояний (показан/скрыт, развёрнут/свёрнут) по сравнению с исходным поведением.

**Validates: Requirements 2.6**

Property 8: Preservation — Неизменность поведения вне условий багов

_For any_ входа, где НИ ОДНО из bug‑условий не выполняется (¬C(X)) — обычное прослушивание, выбор трека из очереди, навигация, прокрутка малых списков, офлайн‑кэш, одиночный long-press и действия меню — исправленный код `F'` SHALL давать результат, идентичный исходному `F`.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

Property 9: Bug Condition — Один индикатор поиска и отсутствие визуальных дубликатов

_For any_ активного поиска (isBugCondition_DoubleIndicator → true), исправленный UI чата музыки SHALL отображать ровно один индикатор. _For any_ выдачи `searchTracks` (isBugCondition_DuplicateResults → true), исправленный код SHALL дедуплицировать результаты по нормализованной паре `(title, artist)` так, чтобы в финальном массиве не было пар, считающихся одинаковыми.

**Validates: Requirements 2.14, 2.15**

Property 10: Bug Condition — Корректное превью‑метаинфо и приоритет full‑length

_For any_ трека из источника превью (isBugCondition_PreviewOnly → true), исправленный код SHALL пометить его признаком `isPreview = true` и UI SHALL показать визуальный бейдж/индикацию «30 с» (или эквивалент). _For any_ запроса, по которому существует full‑length версия с той же `(title, artist)`, исправленный `searchTracks` SHALL поставить full‑length выше превью в финальном порядке.

**Validates: Requirements 2.16**

Property 11: Bug Condition — Кнопка play/pause надёжно переключает воспроизведение

_For any_ нажатия на кнопку play/pause в карточке трека или в виджете при наличии текущего трека (isBugCondition_TogglePlay → true), исправленный код SHALL: (а) не менять `store.current.id`; (б) инвертировать `store.isPlaying` относительно состояния до нажатия; (в) визуальное состояние кнопки в обоих местах SHALL соответствовать `store.isPlaying`.

**Validates: Requirements 2.17**

Property 12: Bug Condition — Long-press на превью/видео/картинке‑ссылке открывает меню

_For any_ long-press на `LinkPreview`/`VideoAttachment`/`LinkedImage` внутри сообщения чата или комментария (isBugCondition_LongPressOnPreview → true), исправленный код SHALL открывать то же контекстное меню, что и для текстового бабла или GIF, с теми же действиями.

**Validates: Requirements 2.18**

## Fix Implementation

### Переиспользуемые модули (модульность и масштабируемость)

Чтобы не дублировать логику по экранам, вводятся переиспользуемые единицы:

1. **`src/hooks/useDebouncedCallback.ts`** — общий хук debounce/throttle для колбэков.
   ```
   useDebouncedCallback(fn, delayMs): (...args) => void   // ведущий вызов сразу, последующие в пределах окна игнорируются
   ```

2. **`src/hooks/useContextMenuGuard.ts`** — общий guard для контекстных меню (унифицирует существующую логику `menuLockRef` из чата/комментариев).
   ```
   const { open, close, target } = useContextMenuGuard<T>({ lockMs: 500, closeLockMs: 350 });
   // open(item): если now < lock → no-op; иначе lock и setTarget(prev => prev ?? item) внутри requestAnimationFrame
   // close(): setTarget(null); продлить lock на closeLockMs
   ```
   Внедряется в `(tabs)/profile.tsx`, `profile/[id].tsx`; чат/комментарии переводятся на этот же хук (рефакторинг существующего `menuLockRef`).

3. **`src/services/audioController.ts`** (или метод внутри `musicStore`) — инкапсулирует generation‑token и сериализацию `play()` (мьютекс через промис‑цепочку) для гарантии единственного активного `Audio.Sound`.

4. **Мемоизированные карточки:** вынести `UserProfilePostCard` для `app/profile/[id].tsx` (по образцу `ProfilePostCard`); ввести `TrackResultCard` (мемоизированная карточка результата поиска) в музыкальном чате.

5. **`src/services/musicService.ts` — утилита релевантности** `scoreTrackRelevance(track, query)` и поле `sourceHost` в `Track`.

### Блок A — Музыкальный модуль

**Файл: `src/services/musicService.ts`**
1. Добавить в интерфейс `Track` поле `sourceHost: string`; в `mapTrack(t, host)` записывать `sourceHost: host`, а `streamUrl` оставить производным от того же `host` (инвариант Property 1).
2. `searchTracks(query, limit = 20)` — увеличить дефолтный лимит; расширить охват: при недостатке результатов на первом хосте добирать с резервных хостов и объединять по `id` (дедупликация), сохраняя `sourceHost` каждого трека.
3. Добавить сортировку по релевантности: `scoreTrackRelevance` учитывает точное/частичное совпадение в `title` и `artist` (нормализация регистра/диакритики), отдавая приоритет совпадению названия. Результат — `results.sort(by score desc)`.
4. Сохранить таймауты/`AbortController` и fallback по хостам (офлайн‑устойчивость, 3.5).

**Файл: `app/chat/music.tsx`**
1. В `handleSend` заменить `searchTracks(q, 1)` на `searchTracks(q)` (множество результатов) и хранить в сообщении массив `tracks: Track[]` вместо одного `track`.
2. Рендерить список результатов через мемоизированный `TrackResultCard`; автоплей запускать по явному выбору пользователя или по первому (наиболее релевантному) результату — поведение автоплея сохраняем как сейчас, но из отсортированного списка.
3. Сохранить синхронное чтение/запись истории MMKV (3.4) и существующую структуру `FlatList`.

**Файл: `src/store/musicStore.ts`** (ключевой fix гонки, 1.7/1.4)
1. Ввести модульные `let playGen = 0` и промис‑мьютекс `let playChain: Promise<void> = Promise.resolve();`.
2. Обернуть тело `play()` в сериализацию: каждый вызов берёт `const myGen = ++playGen;` и выполняется в цепочке, гарантируя порядок.
3. Перед `createAsync` всегда выгружать существующий `sound` (`unloadAsync`), затем создавать новый; после каждого `await` проверять `if (myGen !== playGen) { /* устарел: выгрузить созданный звук и выйти */ }`.
4. В status‑колбэке игнорировать обновления, если `myGen !== playGen` (отсечь орфанные колбэки) — устраняет подмену показателей/состояния (1.4).
5. Сохранить семантику «тот же трек → toggle» (3.1) и выбор из очереди (3.6) без изменений.

**Файл: `src/components/ui/MusicMiniBar.tsx`**
1. **Крестик (1.5):** рендерить `<Pressable onPress={stop}>` только при `queue.length === 0`; при непустой очереди — скрывать (Property 3). Свайп‑вверх для остановки (3.3) сохраняется.
2. **Тап (1.4):** основная область продолжает только разворачивать/сворачивать; play/pause вызывает `toggle()` (который после fix стора всегда оперирует `current`). Никаких вызовов `play(otherTrack)` из основного тапа.
3. **Анимация (1.6):** оставить slide/drag на `useNativeDriver: true`; для раскрытия очереди использовать `LayoutAnimation.configureNext(...)` (или Reanimated layout) вместо мгновенного изменения высоты; мемоизировать строки очереди; рассмотреть подписку на `positionMs` через отдельный лёгкий компонент прогресса, чтобы 500‑мс обновления не ре‑рендерили весь виджет.

### Блок B — Производительность

**Файл: `app/(tabs)/_layout.tsx` / `src/components/navigation/CustomTabBar`**
1. Убедиться, что `CustomTabBar` обёрнут в `React.memo`, а `tabBarIcon`/`screenOptions` стабильны (вынести за пределы рендера). Сохранить `AuthNavigationGuard` и набор экранов (3.8).

**Файл: `app/(tabs)/index.tsx` (и аналогично `profile.tsx`)**
1. Перенести тяжёлую работу при фокусе (`prefetchImages`, `updateFeedWidget`) в `InteractionManager.runAfterInteractions(...)`, чтобы не блокировать кадр переключения таба.
2. Стабилизировать `renderPost`/колбэки (`useCallback`) — уже частично есть; проверить, что `PostCard` (мемоизирован) не получает новые ссылки на пропсы.

**Файл: `app/chat/[id].tsx`**
1. Стабилизировать все колбэки, передаваемые в `MemoMessageBubble` (`onReply`, `onLongPress`, `onSwipeActive`, `onImagePress`) через `useCallback`.
2. Добавить кастомный компаратор в `React.memo(MessageBubble, ...)` по релевантным полям (`id`, `text`, `highlighted`, `imageUrls`, настройки бабла), как сделано в `chat/ai.tsx`.
3. Настроить виртуализацию `FlatList`: `removeClippedSubviews`, `maxToRenderPerBatch`, `windowSize`, `initialNumToRender` под тяжёлый контент. `getItemLayout` не добавляем (переменная высота бабблов) — вместо этого сохраняем `onScrollToIndexFailed` retry.

**Файл: `app/profile/[id].tsx`**
1. Вынести инлайновую карточку поста в мемоизированный `UserProfilePostCard` (по образцу `ProfilePostCard`), со стабильным `onLongPress`/`onImagePress`.
2. Применить тот же приём отложенного монтирования вкладки «Посты» (`postsReady` + `requestAnimationFrame`), что и в `(tabs)/profile.tsx` (1.10).
3. Рассмотреть замену `.map()` в ScrollView на `FlatList`/`FlashList` при больших списках; сохранить визуальное оформление (3.7).

> Примечание: критерии «плавно/без перегрузки» (Property 5) не имеют детерминированного булева оракула в unit‑тестах. Они верифицируются структурно (наличие мемоизации/виртуализации/стабильных колбэков) и измеряются профайлером (см. Testing Strategy).

### Блок C — Контекстные меню

**Файлы: `app/(tabs)/profile.tsx`, `app/profile/[id].tsx`**
1. Заменить прямые `setContextPost(p)` на `open(p)` из `useContextMenuGuard` (lock 500 мс, prev‑preserve, `requestAnimationFrame`) и `close()` в `onClose` `PostContextMenu`. Это устраняет наложение и гонку (1.11, 1.13).

**Файлы: `app/chat/[id].tsx`, `app/comments/[id].tsx`**
2. Рефакторинг существующих `menuLockRef`/`openMenu`/`openCommentMenu` на общий `useContextMenuGuard` (поведение идентично текущему — регрессий нет, 3.9/3.10).

**Файлы: `src/components/ui/PostContextMenu.tsx`, `CommentContextMenu.tsx`**
3. Добавить внутреннюю реэнтрант‑защиту: при `visible` дребезге не перезапускать анимацию, если уже открыто/в переходе; гарантировать единственный активный экземпляр (Property 6). Действия меню и оформление не меняются (3.9, 3.10).

### Блок D — Дополнительные музыкальные UX‑дефекты

**Файл: `app/chat/music.tsx` (1.14 — двойной индикатор)**
1. Удалить глобальный индикатор из `ListHeaderComponent` (BlurView «Ищу...»). Оставить inline‑индикатор внутри сообщения‑баббла, привязанный к конкретному `msg.id` и условию `tracks === undefined`. Это даёт ровно один индикатор на каждый активный поиск (Property 9, часть 1).

**Файл: `src/services/musicService.ts` (1.15 — дубликаты, 1.16 — превью)**
2. Добавить в интерфейс `Track` поле `isPreview: boolean` (true для iTunes/30‑сек источников). В `mapItunesTrack` выставлять `isPreview: true`; в `mapTrack` (Audius) — `isPreview: false`.
3. После сборки `byId` (а перед сортировкой) выполнить дедуп по нормализованной паре `(title, artist)`:
   - Для каждой такой группы оставить запись с максимальным `scoreTrackRelevance` ИЛИ, при равенстве score, full‑length (`isPreview: false`) приоритетнее превью.
   - Использовать функцию `normalize` (уже есть) для ключа дедупа.
4. Добавить вторичный ключ сортировки: при близких score full‑length поднимается над превью (`isPreview ? 0 : 1` как tie‑breaker). Это даёт Property 10 (b).

**Файл: `app/chat/music.tsx` и `src/components/ui/MusicMiniBar.tsx` (1.16 — UI бейдж превью)**
5. В `TrackCard` (карточке результата) и в виджете рядом с длительностью/прогрессом отображать маленький бейдж «30 с» или иконку, если `track.isPreview === true`. Стиль — лёгкий, не отвлекающий; цвет — `text.tertiary`. Это Property 10 (a).

**Файлы: `app/chat/music.tsx` (TrackCard), `src/components/ui/MusicMiniBar.tsx` (1.17 — pause/play)**
6. В `TrackCard.onPress`: единственная семантика — `useMusicStore.getState().play(track)`. Стор сам различает «тот же трек → toggle» (уже реализовано в `play`).
7. В `MusicMiniBar`: кнопка play/pause вызывает `useMusicStore.getState().toggle()`, а не `play(...)`. Состояние кнопки берётся ТОЛЬКО из `useMusicStore.isPlaying` (один источник правды), без локальных дублирующих state.
8. Убедиться, что `current` в обоих местах подписан через `useMusicStore((s) => s.current)` (а не получен через `getState()` в render), чтобы UI обновлялся при смене трека.

**Файлы: `app/chat/[id].tsx`, `app/comments/[id].tsx` и компоненты `LinkPreview`/`VideoMessage`/`LinkedImage` в `src/components/ui/` (1.18 — long‑press на превью)**
9. Прокинуть `onLongPress?: () => void` пропом во все intra‑bubble интерактивные компоненты (`LinkPreview`, `VideoMessage`, `LinkedImage`). Внутри них передавать его в `Pressable`/`TouchableOpacity`, чтобы long‑press жест больше не «съедался» дочерним обработчиком.
10. В `chat/[id].tsx`/`comments/[id].tsx` пробросить тот же обработчик меню (через `useContextMenuGuard` после задачи 6.2) в эти под‑компоненты бабла.
11. Альтернативный путь, если пропсы трудно прокинуть: обернуть весь bubble в `LongPressGestureHandler` от `react-native-gesture-handler` с `simultaneousHandlers`, чтобы long‑press конкурировал с нажатиями дочерних элементов и не блокировался.

## Testing Strategy

### Validation Approach

Двухфазный подход: сначала воспроизвести дефекты на НЕисправленном коде (exploratory), затем подтвердить fix и сохранность поведения (preservation). Для условий с булевым оракулом (единственный звук, видимость крестика, отсутствие подмены, guard меню) применяются property‑based тесты.

### Exploratory Bug Condition Checking

**Goal:** воспроизвести counterexamples ДО фиксов и подтвердить/опровергнуть гипотезы первопричин.

**Test Plan:** замокать `expo-av` (`Audio.Sound.createAsync`/`unloadAsync` со счётчиком активных инстансов и искусственной задержкой), замокать `fetch` для Audius; смоделировать события long-press как последовательность вызовов обработчика.

**Test Cases:**
1. **Поиск (1.1/1.2):** мок `fetch` отдаёт N>1 треков; вызвать текущий `handleSend` → наблюдать, что показан 1 результат и нет сортировки (fail на unfixed).
2. **Host (1.3):** трек смаплен хостом A → проверить, что `streamUrl.host === sourceHost` (на unfixed `sourceHost` отсутствует — тест падает/неприменим).
3. **Гонка звука (1.7):** два почти одновременных `play(A)` и `play(B)` с задержкой в `createAsync` → счётчик активных `Audio.Sound` достигает 2 (fail на unfixed).
4. **Крестик (1.5):** `recent=[A,B,C]`, `current=A` → текущий рендер показывает крестик (fail на unfixed).
5. **Подмена (1.4):** старый status‑колбэк пишет в стор после смены `current` → `isPlaying`/позиция искажаются (fail на unfixed).
6. **Меню профиля (1.11/1.13):** 5 быстрых `onLongPress` подряд → `setContextPost` вызывается многократно, открытий меню > 1 (fail на unfixed).

**Expected Counterexamples:** `countActiveSoundInstances() == 2`; крестик виден при непустой очереди; `>1` открытие меню за окно дребезга.

### Fix Checking

**Goal:** для всех входов `C(X)` исправленный код даёт `P(result)`.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition_Concurrent(X) DO
  applySequence(X); ASSERT countActiveSoundInstances() <= 1
END FOR

FOR ALL X WHERE isBugCondition_CloseButton(X) DO
  ASSERT closeButtonVisible'(X) = false
END FOR

FOR ALL X WHERE isBugCondition_Widget(X) DO
  before = store.current; apply(X.action); ASSERT store.current.id = before.id
END FOR

FOR ALL X WHERE isBugCondition_Search(X) DO
  r = searchTracks'(X.query); ASSERT length(r) >= 1 AND isOrderedByRelevance(r) AND forall t in r: t.streamUrl.host = t.sourceHost
END FOR

FOR ALL X WHERE isBugCondition_ContextMenu(X) DO
  applySequence(X.openSequence); ASSERT countActiveMenuInstances() <= 1
END FOR
```

### Preservation Checking

**Goal:** для всех `¬C(X)` результат `F'(X) = F(X)`.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

**Testing Approach:** property‑based тестирование предпочтительно для preservation — генерирует множество входов и ловит краевые случаи. Поведение фиксируется сначала на unfixed коде, затем сравнивается.

**Test Plan / Test Cases:**
1. **Toggle того же трека (3.1):** `play(current.id)` при загруженном `sound` → переключает play/pause, `current.id` неизменен.
2. **Без очереди крестик виден (3.5/Property 3):** `recent=[A]`, `current=A` → крестик отображается.
3. **Выбор из очереди (3.6):** тап по элементу очереди воспроизводит именно его.
4. **Офлайн история (3.4/3.5):** при недоступной сети история музыки и кэш списков читаются из MMKV без сбоев.
5. **Одиночный long-press (3.9/3.10):** один long-press открывает то же меню; выбор действия выполняет его корректно.

### Unit Tests

- `scoreTrackRelevance` — ранжирование по совпадению title/artist, нормализация регистра.
- `searchTracks` — лимит > 1, дедупликация по `id`, fallback по хостам, `sourceHost == streamUrl.host`.
- `musicStore.play` — generation‑token: устаревший вызов/колбэк не меняет стор; «тот же трек → toggle».
- `useContextMenuGuard` — окно lock игнорирует повторные `open`, `close` продлевает lock.
- `MusicMiniBar` — условный рендер крестика по `queue.length`.

### Property-Based Tests

- **Единственный звук:** генерировать случайные последовательности `play()`/`toggle()`/навигаций → инвариант `countActiveSoundInstances() <= 1`.
- **Скрытие крестика:** генерировать случайные `recent`/`current` → `closeButtonVisible === (queue.length === 0)`.
- **Отсутствие подмены:** генерировать действия по виджету → `current.id` неизменен.
- **Guard меню:** генерировать случайные последовательности long-press с разными интервалами → `countActiveMenuInstances() <= 1`.
- **Релевантность поиска:** генерировать запросы/выдачи → результат отсортирован по убыванию score и host согласован.

### Integration Tests

- Полный сценарий музыки: поиск → выбор → уход с экрана → виджет показан → play/pause продолжает текущий трек; повторные входы/выходы не плодят звуки.
- Переключение табов и вкладок профиля: отсутствие необоснованных ре‑рендеров (проверка React DevTools/`why-did-you-render` в dev) и плавность по профайлеру на слабом устройстве.
- Контекстные меню: серия быстрых long-press в профиле и комментариях → приложение остаётся отзывчивым, открыт ровно один экземпляр меню; одиночный long-press и действия работают как прежде.
