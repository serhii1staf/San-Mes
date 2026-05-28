# Implementation Plan: App UX Improvements

## Overview

Реализация шести UX-улучшений для приложения San: сохранение данных между табами через Zustand store, pinch-to-zoom в просмотрщике фото (react-native-reanimated), корректное редактирование поста (update вместо insert), перенос кнопки «Опубликовать» в headerRight, максимальное качество фото (quality: 1.0), и OTA-деплой через git push.

## Tasks

- [x] 1. Установка зависимостей и настройка конфигурации
  - [x] 1.1 Установить react-native-reanimated и настроить babel plugin
    - Выполнить `npx expo install react-native-reanimated`
    - Добавить `'react-native-reanimated/plugin'` последним элементом в массив `plugins` в `babel.config.js`
    - Убедиться, что плагин стоит ПОСЛЕ всех остальных плагинов (требование reanimated)
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 2. Расширение feedStore новыми полями и методами
  - [x] 2.1 Добавить новые поля и методы в feedStore
    - Добавить поля: `profilePosts: Post[]`, `feedScrollOffset: number`, `profileScrollOffset: number`, `lastFeedFetch: number | null`, `lastProfileFetch: number | null`
    - Добавить методы: `setProfilePosts`, `updatePost(postId, data: Partial<Post>)`, `setFeedScrollOffset`, `setProfileScrollOffset`
    - Метод `updatePost` должен обновлять пост одновременно в `posts[]` и `profilePosts[]` по id
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.2_

  - [ ]* 2.2 Написать property-тест для инварианта store
    - **Property 1: Инвариант store — сохранение данных между табами**
    - После вызова `setPosts(posts)`, `getState().posts` возвращает тот же массив
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [ ]* 2.3 Написать property-тест для идемпотентности updatePost
    - **Property 2: Идемпотентность updatePost**
    - Двойной вызов `updatePost(id, data)` не дублирует пост и результат идентичен одному вызову
    - **Validates: Requirements 3.2**

- [x] 3. Рефакторинг FeedScreen — использование Zustand store вместо локального state
  - [x] 3.1 Перевести FeedScreen на чтение/запись постов через feedStore
    - Заменить локальный `useState<Post[]>([])` на `useFeedStore().posts` и `useFeedStore().setPosts`
    - При первом монтировании: если `store.posts` пуст — загрузить из AsyncStorage и Supabase; если не пуст — отобразить мгновенно без запроса
    - Pull-to-refresh: обновить данные с сервера и записать в store через `setPosts`
    - При ошибке сети: сохранить существующие данные из store, скрыть индикатор обновления
    - _Requirements: 1.1, 1.2, 1.5, 1.6_

  - [x] 3.2 Добавить сохранение и восстановление позиции прокрутки в FeedScreen
    - Сохранять `scrollOffset` в store через `onScroll` (throttled через `scrollEventThrottle`)
    - При возврате на таб (useFocusEffect) — вызвать `scrollToOffset` для восстановления позиции
    - _Requirements: 1.4_

- [x] 4. Рефакторинг ProfileScreen — использование Zustand store вместо локального state
  - [x] 4.1 Перевести ProfileScreen на чтение/запись постов через feedStore.profilePosts
    - Заменить локальный `useState<Post[]>([])` (`userPosts`) на `useFeedStore().profilePosts` и `setProfilePosts`
    - При первом монтировании: если `store.profilePosts` пуст — загрузить из кэша/Supabase; если не пуст — показать мгновенно
    - Pull-to-refresh: обновить и записать в store
    - _Requirements: 1.1, 1.3_

  - [x] 4.2 Добавить сохранение и восстановление позиции прокрутки в ProfileScreen
    - Сохранять `profileScrollOffset` в store
    - Восстанавливать позицию при возврате на таб
    - _Requirements: 1.4_

- [x] 5. Checkpoint — Убедиться что переключение табов работает корректно
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Исправление логики редактирования поста в CreateScreen
  - [x] 6.1 Реализовать режим update при наличии editingPostId
    - В `handlePost`: если `editingPostId !== null`, вызвать `supabase.from('posts').update({content, image_url}).eq('id', editingPostId)` вместо `createPost()`
    - Для изображений: если URI начинается с `file://` — загрузить через `uploadPostImage`; если начинается с `https://` — использовать как есть
    - После успешного update: обновить кэш AsyncStorage (ключи `@san:feed_posts` и `@san:my_posts`) — найти пост по id и заменить данные
    - Вызвать `feedStore.updatePost(editingPostId, newData)` для обновления Zustand store
    - Сбросить `editingPostId = null`, вызвать `router.back()`
    - При ошибке от Supabase: показать Alert с `error.message`, НЕ очищать форму
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 6.2 Написать property-тест для корректного режима create vs edit
    - **Property 5: Корректный режим create vs edit**
    - Если `editingPostId !== null` → вызывается `update()`; если `null` → `createPost()`
    - **Validates: Requirements 3.1**

- [x] 7. Перенос кнопки «Опубликовать» в headerRight
  - [x] 7.1 Вынести кнопку «Опубликовать» в headerRight через screenOptions
    - В `app/(tabs)/_layout.tsx`: для экрана `create` установить `headerShown: true` и задать `headerRight` с компонентом кнопки публикации
    - Кнопка отображает текст «Опубликовать» цветом `accent.primary`, без фонового контейнера
    - В disabled состоянии (нет текста, нет изображений, нет репоста): `opacity: 0.4`
    - Во время публикации: disabled + ActivityIndicator
    - Удалить кнопку публикации из нижней части CreateScreen
    - Для передачи состояния в header использовать `navigation.setOptions` или callback через ref/store
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 8. Создание компонента ZoomableImage с pinch-to-zoom и pan
  - [x] 8.1 Создать компонент ZoomableImage в `src/components/ui/ZoomableImage.tsx`
    - Использовать `react-native-gesture-handler` (GestureDetector, Gesture.Pinch, Gesture.Pan, Gesture.Tap) и `react-native-reanimated` (useSharedValue, useAnimatedStyle, withTiming)
    - Pinch gesture: масштабирование от 1x до 3x, с `savedScale` для накопления
    - Pan gesture: перемещение при `scale > 1`, с ограничением (clamp) по границам viewport
    - Double tap: переключение между 1x и 2x, центрирование на точке касания
    - Bounce-back: при `onEnd` если `scale > 3` → `withTiming(3, {duration: 300})`; если `scale < 1` → `withTiming(1, {duration: 300})` + сброс translate
    - При `scale === 1`: translateX и translateY всегда 0
    - Props: `uri: string`, `width: number`, `height: number`, `minScale?: number`, `maxScale?: number`, `onClose?: () => void`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 8.2 Написать property-тест для ограничения zoom scale
    - **Property 3: Ограничение zoom scale**
    - Для любого значения scale после завершения gesture: `1.0 ≤ scale ≤ 3.0`
    - **Validates: Requirements 2.1, 2.5, 2.6**

  - [ ]* 8.3 Написать property-тест для ограничения pan при scale=1
    - **Property 4: Ограничение pan при scale=1**
    - При `scale === 1`, `translateX === 0` и `translateY === 0`
    - **Validates: Requirements 2.2, 2.4**

- [x] 9. Интеграция ZoomableImage в модальное окно просмотра изображений
  - [x] 9.1 Заменить статичный Image на ZoomableImage в Image Viewer модалах
    - В `ProfileScreen`: заменить `<CachedImage>` внутри модала `viewingImage` на `<ZoomableImage>`
    - В `PostCard` / `FeedScreen`: если есть аналогичный модал — интегрировать ZoomableImage
    - Обернуть ZoomableImage в `GestureHandlerRootView` внутри Modal
    - При закрытии модала сбрасывать zoom к 1x
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 10. Исправление качества ImagePicker на quality: 1.0
  - [x] 10.1 Установить quality: 1.0 для gallery и camera picker в CreateScreen
    - В `pickImages()`: изменить `quality: 0.8` → `quality: 1.0`
    - В `takePhoto()`: изменить `quality: 0.8` → `quality: 1.0`
    - Добавить проверку размера файла: если > 20MB → показать Alert и не загружать
    - При ошибке загрузки на Supabase Storage: показать Alert с причиной, сохранить текст поста
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 10.2 Написать property-тест для качества фото
    - **Property 6: Качество фото**
    - Параметр `quality` в ImagePicker всегда равен 1.0
    - **Validates: Requirements 5.1, 5.2**

- [x] 11. Checkpoint — Убедиться что все функции работают корректно
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Git commit и push для OTA-обновления
  - [-] 12.1 Выполнить git add, commit и push в main для запуска OTA workflow
    - `git add -A`
    - `git commit -m "feat: UX improvements — pinch-to-zoom, edit post fix, publish button in header, photo quality 1.0, tab state persistence"`
    - `git push origin main`
    - Пуш в main триггерит GitHub Actions workflow `ota-update.yml` → `eas update --branch production --platform ios`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

## Notes

- Задачи помеченные `*` являются опциональными (property-тесты) и могут быть пропущены для быстрого MVP
- Каждая задача ссылается на конкретные требования из requirements.md
- Checkpoints обеспечивают инкрементальную валидацию
- Property-тесты проверяют универсальные свойства корректности из design.md
- react-native-reanimated babel plugin ДОЛЖЕН быть последним в списке plugins
- При интеграции ZoomableImage необходима обёртка GestureHandlerRootView внутри Modal

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1", "4.1"] },
    { "id": 3, "tasks": ["3.2", "4.2", "6.1"] },
    { "id": 4, "tasks": ["6.2", "7.1", "8.1", "10.1"] },
    { "id": 5, "tasks": ["8.2", "8.3", "9.1", "10.2"] },
    { "id": 6, "tasks": ["12.1"] }
  ]
}
```
