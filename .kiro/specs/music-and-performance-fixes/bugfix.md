# Документ требований багфикса

## Introduction

Этот документ описывает набор связанных дефектов в приложении San-Mes (социальная сеть / мессенджер на React Native / Expo) и определяет корректное поведение, которое должно быть достигнуто после исправления.

Дефекты сгруппированы в три логических блока:

- **Блок A — Музыкальный модуль**: некорректный/неполный поиск музыки, ошибочное поведение плавающего виджета `MusicMiniBar` и одновременное воспроизведение нескольких треков.
- **Блок B — Производительность и рендеринг**: общие лаги и перегрузка устройства при переключении табов, отсутствие плавности при открытии «тяжёлых» чатов и лаги при переключении вкладок профиля.
- **Блок C — Контекстные меню / модальные окна**: полное зависание приложения при открытии контекстного меню по долгому нажатию (long-press) на посте в профиле и на комментарии/сообщении в разделе «Комментарии», особенно при быстрых/хаотичных повторных действиях.

Дефекты влияют на основной пользовательский опыт: невозможно надёжно найти и слушать музыку, виджет ведёт себя непредсказуемо, навигация по приложению ощущается медленной и нагружает устройство, а попытка открыть контекстное меню может полностью заморозить приложение.

Все будущие исправления должны соответствовать сквозным нефункциональным требованиям проекта:

- максимально оптимизированный, чистый и масштабируемый код;
- максимальная производительность (минимум перерисовок, отсутствие лишней работы в основном потоке);
- поддержка слабых устройств (низкое потребление CPU/памяти, плавные нативные анимации);
- поддержка офлайн-режима (отсутствие сбоев при недоступности сети, опора на кэш).

Эти нефункциональные требования являются ограничениями для всех пунктов ниже и не должны нарушаться при исправлении дефектов.

## Bug Analysis

### Current Behavior (Defect)

Текущее (дефектное) поведение системы.

**Блок A — Музыкальный модуль**

1.1 WHEN пользователь вводит поисковый запрос в чате музыки (`app/chat/music.tsx` → `searchTracks`) THEN the system находит не все доступные треки: возвращается только один результат на запрос (вызов `searchTracks(q, 1)`), а часть музыки вообще не находится, поскольку поиск ограничен узким набором/источником и не охватывает широкий диапазон запросов и форматов.

1.2 WHEN пользователь вводит поисковый запрос THEN the system иногда возвращает нерелевантные результаты, не соответствующие запросу (выбирается первый элемент `results[0]` без оценки релевантности, а перебор хостов Audius может вернуть произвольный набор данных).

1.3 WHEN поиск выполняется и первый хост Audius возвращает данные, на которых формируется `streamUrl`, но трек воспроизводится через другой хост THEN the system может стримить трек, не соответствующий показанной карточке (рассинхронизация хоста результата и хоста стрима).

1.4 WHEN пользователь выходит из чата музыки и затем нажимает на плавающий виджет `MusicMiniBar` THEN the system начинает воспроизводить другой трек, отличный от ожидаемого (текущий трек подменяется треком из `recent`/очереди).

1.5 WHEN в очереди (`recent`) нет других треков, кроме текущего THEN the system всё равно отображает кнопку закрытия (крестик) в виджете, хотя по требованию её следует скрывать при наличии других песен.

1.6 WHEN виджет `MusicMiniBar` открывается или закрывается THEN the system выполняет анимацию (`Animated` + `PanResponder`), которая не является максимально плавной и оптимизированной, особенно на слабых устройствах.

1.7 WHEN пользователь входит в чат музыки и выходит из него несколько раз, запуская воспроизведение THEN the system допускает одновременное воспроизведение 2–3 треков, несмотря на комментарий в коде о единственном экземпляре `Audio.Sound` (предыдущий звук не всегда выгружается до запуска следующего из-за гонки в асинхронном `play`).

**Блок B — Производительность и рендеринг**

1.8 WHEN пользователь переключается между табами (`app/(tabs)/_layout.tsx`, `index.tsx`, `messages.tsx` и др.) THEN the system заметно лагает и перегружает устройство, наблюдаются просадки производительности.

1.9 WHEN пользователь открывает чат с большим количеством уже загруженного контента (`app/chat/[id].tsx`) THEN the system отрисовывает экран без плавности (рывки, задержки прокрутки и появления контента).

1.10 WHEN пользователь открывает свой или чужой профиль (`app/(tabs)/profile.tsx`, `app/profile/[id].tsx`) и переключается между вкладками «Посты» и «Ответы» THEN the system лагает, особенно в категории «Посты».

**Блок C — Контекстные меню / модальные окна**

1.11 WHEN пользователь открывает свой или чужой профиль (`app/(tabs)/profile.tsx`, `app/profile/[id].tsx`) и делает долгое нажатие (long-press) на контейнере поста, чтобы вызвать контекстное меню (`PostContextMenu` — копировать, поделиться и т.д.) THEN the system при быстром или хаотичном повторном открытии меню полностью зависает в момент его открытия (блокировка основного потока, приложение перестаёт отвечать).

1.12 WHEN пользователь находится в разделе «Комментарии» (`app/comments/[id].tsx`) и делает долгое нажатие на комментарии/сообщении для вызова контекстного меню (`CommentContextMenu`) THEN the system при открытии меню (особенно при быстрых повторных действиях) полностью зависает.

1.13 WHEN пользователь быстро повторно вызывает контекстное меню (несколько long-press подряд / хаотичные касания) до завершения анимации открытия или закрытия предыдущего меню THEN the system допускает гонку состояний и повторный/наложенный рендер модального меню, что приводит к зависанию основного потока.

**Блок D — Дополнительные музыкальные дефекты UX (выявлены после реализации Блока A)**

1.14 WHEN пользователь отправляет поисковый запрос в чате музыки THEN the system одновременно показывает ДВА индикатора загрузки: глобальный (в `ListHeaderComponent`, BlurView «Ищу...») и inline-индикатор внутри сообщения, что выглядит как баг и перегружает интерфейс.

1.15 WHEN пользователь получает результаты поиска THEN the system иногда отображает несколько визуально одинаковых карточек одного и того же трека (один title + один artist, разные `id`), потому что `searchTracks` дедуплицирует только по `id`, а не по нормализованной паре `(title, artist)`. Результат — 2–3 «дубликата» в выдаче на один запрос.

1.16 WHEN пользователь воспроизводит результат поиска, найденный через iTunes fallback THEN the system играет только 30‑секундное превью вместо полной песни, без какого‑либо уведомления пользователю. iTunes Search API по дизайну отдаёт `previewUrl` длительностью 30 секунд; для full‑length треков нужен другой источник, либо явный UX‑признак «превью» рядом с длительностью.

1.17 WHEN пользователь нажимает кнопку play/pause в карточке трека в чате музыки или в плавающем виджете `MusicMiniBar` THEN the system не реагирует корректно: воспроизведение не ставится на паузу или не возобновляется (визуально кнопка может «застывать» в одном состоянии), хотя `useMusicStore.toggle()` логически должен переключать `playAsync/pauseAsync` через активный `Audio.Sound`.

1.18 WHEN пользователь делает долгое нажатие (long-press) на превью ссылки (link preview), на видео или на изображение‑ссылку внутри сообщения чата (`app/chat/[id].tsx`) или комментария (`app/comments/[id].tsx`) THEN the system не открывает контекстное меню (`PostContextMenu`/`CommentContextMenu` или его аналог), хотя для текстовых сообщений и для GIF меню открывается корректно. Long-press жест на этих типах вложенных элементов не передаётся вверх к обработчику меню.

### Expected Behavior (Correct)

Корректное поведение, которое должно достигаться после исправления. Каждый пункт соответствует одноимённому дефекту выше.

**Блок A — Музыкальный модуль**

2.1 WHEN пользователь вводит любой поисковый запрос в чате музыки THEN the system SHALL запрашивать и возвращать несколько релевантных результатов (а не один), охватывая широкий диапазон запросов и форматов музыки, чтобы пользователь мог найти искомый трек, а не получать пустой/единичный результат.

2.2 WHEN пользователь вводит поисковый запрос THEN the system SHALL возвращать результаты, релевантные запросу (упорядоченные по релевантности к названию/исполнителю), не теряя совпадения из-за ограничений источника или формата, и не показывать заведомо несоответствующие треки в качестве первого/основного результата.

2.3 WHEN поиск возвращает трек THEN the system SHALL формировать и использовать `streamUrl` так, чтобы воспроизводимый трек строго соответствовал показанной карточке (согласованность источника данных и источника стрима).

2.4 WHEN пользователь нажимает на плавающий виджет `MusicMiniBar` (основную область или кнопку play/pause) THEN the system SHALL продолжать/возобновлять воспроизведение именно текущего трека и НЕ SHALL подменять его другим треком.

2.5 WHEN в очереди есть другие песни (кроме текущей) THEN the system SHALL скрывать кнопку закрытия (крестик) в виджете; WHEN других песен нет THEN the system SHALL отображать кнопку закрытия.

2.6 WHEN виджет `MusicMiniBar` открывается или закрывается THEN the system SHALL выполнять максимально плавную и оптимизированную анимацию (предпочтительно на нативном драйвере), без рывков на слабых устройствах.

2.7 WHEN пользователь запускает воспроизведение трека при любой последовательности входов/выходов из чата музыки THEN the system SHALL гарантировать единственный активный экземпляр `Audio.Sound`, корректно останавливая и выгружая предыдущий звук до запуска следующего, исключая одновременное воспроизведение нескольких треков.

**Блок B — Производительность и рендеринг**

2.8 WHEN пользователь переключается между табами THEN the system SHALL выполнять переход плавно, без заметных просадок и без чрезмерной нагрузки на устройство, на уровне продакшн-качества: минимизируя перерисовки, не блокируя основной поток и не выполняя лишнюю работу при каждом переключении.

2.9 WHEN пользователь открывает чат с большим количеством контента THEN the system SHALL отрисовывать и прокручивать экран плавно (с применением виртуализации списка и мемоизации элементов), не блокируя основной поток.

2.10 WHEN пользователь переключается между вкладками «Посты» и «Ответы» в своём или чужом профиле THEN the system SHALL переключать вкладки плавно, без лагов, в том числе в категории «Посты».

**Блок C — Контекстные меню / модальные окна**

2.11 WHEN пользователь делает долгое нажатие на посте в профиле для вызова контекстного меню (`PostContextMenu`) THEN the system SHALL открывать меню без зависания и без блокировки основного потока, оставаясь отзывчивым.

2.12 WHEN пользователь делает долгое нажатие на комментарии/сообщении в разделе «Комментарии» (`CommentContextMenu`) THEN the system SHALL открывать меню без зависания и без блокировки основного потока.

2.13 WHEN пользователь быстро или хаотично повторно вызывает контекстное меню THEN the system SHALL защищаться от гонок состояний и повторного/наложенного открытия (debounce/guard на повторное открытие, единственный активный экземпляр меню) и SHALL гарантировать отсутствие зависаний при любой последовательности быстрых long-press.

**Блок D — Дополнительные музыкальные дефекты UX**

2.14 WHEN пользователь отправляет поисковый запрос в чате музыки THEN the system SHALL отображать ровно ОДИН индикатор поиска для каждого активного запроса. Допустимая реализация — inline‑индикатор внутри сообщения‑баббла, привязанный к конкретному `query.id`, без дублирующего глобального индикатора в шапке списка.

2.15 WHEN `searchTracks` агрегирует результаты из разных источников (Audius, iTunes) THEN the system SHALL дедуплицировать выдачу не только по `id`, но и по нормализованной паре `(title, artist)` (нормализация — lowercase + удаление диакритики/пунктуации, как в `scoreTrackRelevance`), оставляя при коллизии запись с большим score, чтобы пользователь не видел визуально одинаковых дубликатов одной песни.

2.16 WHEN найденный трек является 30‑секундным превью (источник — iTunes/`previewUrl`) THEN the system SHALL: (а) пытаться найти full‑length вариант той же песни в Audius (приоритет полнодлинных результатов в ранжировании); (б) если full‑length не найден — явно помечать карточку признаком «превью» (например, бейдж «30 с» рядом с длительностью), чтобы пользователь видел, что это не полная песня. WHEN найден полнодлинный источник для запроса THEN the system SHALL отдавать его пользователю как первый/основной результат.

2.17 WHEN пользователь нажимает кнопку play/pause в карточке трека или в виджете `MusicMiniBar` THEN the system SHALL надёжно переключать воспроизведение текущего трека через `useMusicStore.toggle()`: пауза → воспроизведение и наоборот, с корректным обновлением `isPlaying` в сторе и UI; визуальное состояние кнопки SHALL соответствовать фактическому `isPlaying`.

2.18 WHEN пользователь делает долгое нажатие на превью ссылки, видео или изображение‑ссылку в сообщении чата или комментарии THEN the system SHALL открывать соответствующее контекстное меню (`PostContextMenu`/`CommentContextMenu`) с теми же действиями, что и для текстовых сообщений и GIF (копировать, поделиться, ответить, удалить и т. д.), не перехватывая жест дочерним компонентом.

### Unchanged Behavior (Regression Prevention)

Существующее поведение, которое ДОЛЖНО быть сохранено после исправления (для входов, не относящихся к условию бага).

3.1 WHEN пользователь нажимает на уже играющий текущий трек в карточке или виджете THEN the system SHALL CONTINUE TO переключать play/pause этого трека (поведение «тот же трек → toggle»).

3.2 WHEN трек воспроизводится и пользователь уходит с экрана музыки THEN the system SHALL CONTINUE TO продолжать фоновое воспроизведение и показывать плавающий виджет `MusicMiniBar`, когда пользователь не на экране `/chat/music`.

3.3 WHEN пользователь свайпает виджет вверх (жест закрытия) THEN the system SHALL CONTINUE TO останавливать воспроизведение и скрывать виджет.

3.4 WHEN пользователь открывает чат музыки THEN the system SHALL CONTINUE TO восстанавливать историю запросов из локального кэша (MMKV) и сохранять её, в том числе в офлайн-режиме.

3.5 WHEN сеть недоступна THEN the system SHALL CONTINUE TO работать без сбоев в части кэшированных данных (история чата музыки, список диалогов, лента, профили), как это происходит сейчас.

3.6 WHEN пользователь выбирает трек из развёрнутой очереди (`recent`) в виджете THEN the system SHALL CONTINUE TO воспроизводить именно выбранный пользователем трек.

3.7 WHEN пользователь прокручивает чат, ленту, список диалогов или вкладки профиля с обычным (небольшим) объёмом контента THEN the system SHALL CONTINUE TO отображать корректный контент и существующее визуальное оформление без изменений.

3.8 WHEN пользователь переключает табы THEN the system SHALL CONTINUE TO отображать те же экраны, состояние авторизации и навигационные гарантии (`AuthNavigationGuard`), что и сейчас.

3.9 WHEN пользователь делает одиночное долгое нажатие на посте или комментарии (без быстрых повторов) THEN the system SHALL CONTINUE TO открывать корректное контекстное меню с теми же действиями (копировать, поделиться, ответить, редактировать, удалить, пожаловаться) и тем же визуальным оформлением, что и сейчас.

3.10 WHEN пользователь выбирает действие в контекстном меню (копировать, поделиться, ответить, редактировать, удалить, пожаловаться) THEN the system SHALL CONTINUE TO выполнять это действие корректно, как и до исправления.

3.11 WHEN пользователь делает long-press на текстовом сообщении или на GIF в чате/комментариях THEN the system SHALL CONTINUE TO открывать контекстное меню как сейчас (поведение для этих типов уже работает; новые правки 2.18 не должны его сломать).

## Bug Condition и Properties

Ниже формализованы условия бага `C(X)` и свойства корректного поведения. `F` — функция/поведение до исправления, `F'` — после.

### Блок A — Музыкальный модуль

```pascal
FUNCTION isBugCondition_Search(X)
  INPUT: X = { query: string }
  OUTPUT: boolean
  // Непустой запрос, по которому существуют релевантные треки
  RETURN trim(X.query) <> "" AND existsRelevantTracks(X.query)
END FUNCTION
```

```pascal
// Property: Fix Checking — релевантный, широкий и полный поиск
FOR ALL X WHERE isBugCondition_Search(X) DO
  results ← searchTracks'(X.query, limit)   // limit > 1, широкий охват источников/форматов
  ASSERT length(results) >= 1
     AND isOrderedByRelevance(results, X.query)
     AND coversBroadQueryRange(X.query)        // не теряет совпадения из-за узкого источника/формата
     AND FOR ALL r IN results: r.streamUrl.host = r.sourceHost
END FOR
```

```pascal
FUNCTION isBugCondition_Widget(X)
  INPUT: X = { action: TapMainArea | TapPlayPause, current: Track }
  OUTPUT: boolean
  RETURN X.current <> null
END FUNCTION
```

```pascal
// Property: Fix Checking — нажатие на виджет не подменяет трек
FOR ALL X WHERE isBugCondition_Widget(X) DO
  before ← store.current
  apply(X.action)
  ASSERT store.current.id = before.id
END FUNCTION
```

```pascal
FUNCTION isBugCondition_CloseButton(X)
  INPUT: X = { recent: Track[], current: Track }
  OUTPUT: boolean
  RETURN queue(X.recent, X.current).length > 0   // есть другие песни
END FUNCTION
```

```pascal
// Property: Fix Checking — крестик скрыт при наличии очереди
FOR ALL X WHERE isBugCondition_CloseButton(X) DO
  ASSERT closeButtonVisible'(X) = false
END FOR
// Preservation: без очереди крестик виден
FOR ALL X WHERE NOT isBugCondition_CloseButton(X) DO
  ASSERT closeButtonVisible'(X) = true
END FOR
```

```pascal
FUNCTION isBugCondition_Concurrent(X)
  INPUT: X = последовательность операций play() при входах/выходах из чата музыки
  OUTPUT: boolean
  RETURN containsOverlappingPlayCalls(X)
END FUNCTION
```

```pascal
// Property: Fix Checking — единственный активный звук
FOR ALL X WHERE isBugCondition_Concurrent(X) DO
  applySequence(X)
  ASSERT countActiveSoundInstances() <= 1
END FOR
```

### Блок B — Производительность и рендеринг

```pascal
FUNCTION isBugCondition_Perf(X)
  INPUT: X = { screen: Tabs | HeavyChat | ProfileTabs, contentSize: int }
  OUTPUT: boolean
  RETURN X.screen IN {Tabs, HeavyChat, ProfileTabs}
END FUNCTION
```

```pascal
// Property: Fix Checking — плавность и отсутствие перегрузки (продакшн-качество)
FOR ALL X WHERE isBugCondition_Perf(X) DO
  ASSERT noUnnecessaryRerenders(X)
     AND usesVirtualizationAndMemoization(X)
     AND mainThreadNotBlocked(X)
     AND interactionRemainsResponsive(X)
END FOR
```

### Блок C — Контекстные меню / модальные окна

```pascal
FUNCTION isBugCondition_ContextMenu(X)
  INPUT: X = {
           screen: ProfilePost | Comment,        // PostContextMenu | CommentContextMenu
           openSequence: LongPress[]              // последовательность нажатий
         }
  OUTPUT: boolean
  // Бага достигается при быстром/повторном открытии меню (наложение открытий),
  // в т.ч. до завершения анимации открытия/закрытия предыдущего меню.
  RETURN containsRapidRepeatedOpens(X.openSequence)
      OR opensWhileTransitioning(X.openSequence)
END FUNCTION
```

```pascal
// Property: Fix Checking — открытие меню не зависает
FOR ALL X WHERE isBugCondition_ContextMenu(X) DO
  applySequence(X.openSequence)
  ASSERT mainThreadNotBlocked(X)
     AND appRemainsResponsive(X)
     AND countActiveMenuInstances() <= 1     // guard/debounce против наложения
END FOR
```

```pascal
// Preservation — одиночное открытие меню работает как прежде
FOR ALL X WHERE NOT isBugCondition_ContextMenu(X) DO
  ASSERT menuOpens'(X) = menuOpens(X)
     AND menuActions'(X) = menuActions(X)
END FOR
```

### Общая цель сохранения (Preservation)

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

Для всех входов, не относящихся к условиям багов (обычные сценарии прослушивания, навигации, прокрутки с небольшим объёмом контента, офлайн-работа с кэшем), исправленный код ДОЛЖЕН вести себя идентично исходному.

### Блок D — Дополнительные музыкальные дефекты UX

```pascal
FUNCTION isBugCondition_DoubleIndicator(X)
  INPUT: X = { isSearching: bool, msg: { id: string, tracks: Track[]? } }
  OUTPUT: boolean
  // В момент активного поиска (есть in-flight сообщение без tracks) показывается > 1 индикатора одновременно.
  RETURN X.isSearching = true AND msg.tracks = undefined
END FUNCTION
```

```pascal
// Property: Fix Checking — единственный индикатор поиска
FOR ALL X WHERE isBugCondition_DoubleIndicator(X) DO
  ASSERT countVisibleSearchIndicators(X) = 1
END FOR
```

```pascal
FUNCTION isBugCondition_DuplicateResults(X)
  INPUT: X = { results: Track[] }
  OUTPUT: boolean
  // В выдаче есть две и более записи с одинаковой нормализованной парой (title, artist).
  RETURN existsPair(X.results, (a,b) => normalize(a.title)=normalize(b.title) AND normalize(a.artist)=normalize(b.artist))
END FUNCTION
```

```pascal
// Property: Fix Checking — отсутствие визуальных дубликатов
FOR ALL X WHERE isBugCondition_DuplicateResults(X) DO
  results' ← dedupeByTitleArtist(X.results)
  ASSERT NOT existsPair(results', (a,b) => normalize(a.title)=normalize(b.title) AND normalize(a.artist)=normalize(b.artist))
END FOR
```

```pascal
FUNCTION isBugCondition_PreviewOnly(X)
  INPUT: X = { track: Track }
  OUTPUT: boolean
  // Источник — iTunes (или иной 30-сек), но информации об этом пользователю не отдано.
  RETURN X.track.sourceHost.matches("itunes.apple.com") AND NOT X.track.isPreview
END FUNCTION
```

```pascal
// Property: Fix Checking — превью явно помечен и full-length приоритетнее
FOR ALL X WHERE isBugCondition_PreviewOnly(X) DO
  // (a) карточка имеет признак isPreview=true и UI показывает бейдж «30 с»
  ASSERT X.track.isPreview = true AND uiHasPreviewBadge(X.track)
  // (b) если в той же выдаче есть full-length с (title, artist) ~ X.track → он стоит выше
  ASSERT FOR ALL r IN sameSongFullLength(X.track, results) DO indexOf(r, results) < indexOf(X.track, results)
END FOR
```

```pascal
FUNCTION isBugCondition_TogglePlay(X)
  INPUT: X = { current: Track, isPlayingBefore: bool, action: TapPlayPauseInCard | TapPlayPauseInWidget }
  OUTPUT: boolean
  RETURN X.current <> null
END FUNCTION
```

```pascal
// Property: Fix Checking — кнопка play/pause переключает воспроизведение
FOR ALL X WHERE isBugCondition_TogglePlay(X) DO
  apply(X.action)
  ASSERT store.current.id = X.current.id
     AND store.isPlaying = NOT X.isPlayingBefore
END FOR
```

```pascal
FUNCTION isBugCondition_LongPressOnPreview(X)
  INPUT: X = { screen: Chat | Comments, target: LinkPreview | VideoAttachment | LinkedImage, gesture: LongPress }
  OUTPUT: boolean
  RETURN X.target IN {LinkPreview, VideoAttachment, LinkedImage}
     AND X.gesture = LongPress
END FUNCTION
```

```pascal
// Property: Fix Checking — long-press на превью открывает меню
FOR ALL X WHERE isBugCondition_LongPressOnPreview(X) DO
  apply(X.gesture)
  ASSERT contextMenuOpen(X.screen) = true
     AND menuActions(X.screen) = menuActions_textBubble(X.screen)  // те же действия, что и для текста
END FOR
```
