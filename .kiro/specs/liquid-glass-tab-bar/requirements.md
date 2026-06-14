# Requirements Document

## Introduction

This feature re-styles the existing bottom navigation bar of the React Native (Expo SDK 54, expo-router) application into a floating "Liquid Glass" navigation bar inspired by Apple's aesthetic. The implementation is an intentional pseudo-glass imitation built exclusively from already-installed packages (`expo-blur`, `expo-linear-gradient`, `react-native-reanimated`, `react-native-svg`, `@expo/vector-icons`) and introduces no new native build dependency and no use of the iOS 26 system glass API.

The visual change is concentrated in `src/components/navigation/CustomTabBar.tsx`. The tab bar continues to host five expo-router screens (`index`, `search`, `create`, `messages`, `profile`). A translucent glass backdrop reveals blurred content behind it, a Reanimated spring-driven highlight pill slides between the four standard tabs while skipping the raised center create button, and the bar performs zero idle animation. The redesign preserves all existing navigation behavior, haptic feedback, theme awareness, and accessibility semantics.

## Glossary

- **Tab_Bar**: The `CustomTabBar` component rendered as the bottom navigation bar via the expo-router `Tabs` `tabBar` prop.
- **Standard_Tab**: Any of the four non-create tabs: `index` (home), `search`, `messages`, `profile`.
- **Create_Button**: The center `create` tab, rendered as a raised distinct accent circle.
- **Glass_Backdrop**: The combined translucent visual layer of the Tab_Bar consisting of the platform blur or fallback tint, gradient reflection, and edge highlights.
- **Sliding_Pill**: The animated highlight element that indicates the active Standard_Tab and translates horizontally between Standard_Tab positions.
- **Blur_Layer**: The `expo-blur` `BlurView` used on iOS to blur content rendered behind the Tab_Bar.
- **Fallback_Tint**: The semi-transparent gradient/tint layer used on Android (or when blur is unavailable) in place of the Blur_Layer.
- **Theme_Context**: The application theme accessed via `useTheme`, exposing `isDark` and color tokens (`accent.primary`, `accent.secondary`, `background.primary`, `text.tertiary`).
- **Reduced_Transparency**: The operating-system accessibility setting requesting reduced or removed transparency effects.
- **Active_Tab**: The Standard_Tab corresponding to the current navigation `state.index`.

## Requirements

### Requirement 1: Glass backdrop rendering (iOS blur + Android fallback)

**User Story:** As a user, I want the navigation bar to look like translucent floating glass that reveals content behind it, so that the app feels modern and authentic.

#### Acceptance Criteria

1. WHERE the platform is iOS, THE Tab_Bar SHALL render a `expo-blur` Blur_Layer behind the tab content so that content scrolled beneath the Tab_Bar appears blurred.
2. WHERE the platform is Android, THE Tab_Bar SHALL render a Fallback_Tint composed of a semi-transparent gradient in place of the Blur_Layer.
3. THE Glass_Backdrop SHALL use a translucent fill that allows content behind the Tab_Bar to remain partially visible rather than a near-opaque frosted fill.
4. THE Tab_Bar SHALL retain the floating pill layout with horizontal margins, bottom margin, rounded corners, a hairline border, and a drop shadow.
5. THE Tab_Bar SHALL render a top reflection highlight using a child `expo-linear-gradient` element layered over the Glass_Backdrop.
6. IF the Blur_Layer cannot be rendered on the current device, THEN THE Tab_Bar SHALL render the Fallback_Tint so that the Tab_Bar remains fully visible and functional.

### Requirement 2: Sliding active pill behavior

**User Story:** As a user, I want a highlight that slides to the tab I select, so that the active section is clear and the interaction feels fluid.

#### Acceptance Criteria

1. THE Sliding_Pill SHALL indicate the Active_Tab among the four Standard_Tabs.
2. WHEN the Active_Tab changes, THE Sliding_Pill SHALL translate horizontally from the previous Standard_Tab position to the new Standard_Tab position using a `react-native-reanimated` spring animation.
3. THE Sliding_Pill SHALL position itself only over Standard_Tab slots and SHALL skip the Create_Button slot when moving between Standard_Tabs on opposite sides of the Create_Button.
4. WHILE the Active_Tab is the `create` route, THE Sliding_Pill SHALL remain hidden.
5. WHEN the Tab_Bar first mounts, THE Sliding_Pill SHALL appear at the Active_Tab position without a translation animation.

### Requirement 3: Create button preservation

**User Story:** As a user, I want the center create action to stand out as a distinct button, so that posting remains a primary, easily reachable action.

#### Acceptance Criteria

1. THE Create_Button SHALL render as a raised circular control filled with the `accent.secondary` color token.
2. THE Create_Button SHALL display a white plus icon centered within the circle.
3. THE Create_Button SHALL remain visually distinct from the Sliding_Pill and SHALL NOT be covered by the Sliding_Pill.
4. WHEN the Create_Button is pressed, THE Tab_Bar SHALL trigger navigation to the `create` route using the existing tab press behavior.

### Requirement 4: Theme and dark-mode correctness

**User Story:** As a user, I want the glass bar to match light and dark themes, so that it stays legible and consistent with the rest of the app.

#### Acceptance Criteria

1. WHILE Theme_Context reports `isDark` as true, THE Glass_Backdrop SHALL use dark-theme tint, border, and reflection values.
2. WHILE Theme_Context reports `isDark` as false, THE Glass_Backdrop SHALL use light-theme tint, border, and reflection values.
3. THE Tab_Bar SHALL render the Active_Tab icon and Sliding_Pill using the `accent.primary` color token.
4. THE Tab_Bar SHALL render inactive Standard_Tab icons using the `text.tertiary` color token.
5. WHEN the active theme changes, THE Tab_Bar SHALL update the Glass_Backdrop and icon colors to the corresponding theme values.

### Requirement 5: Performance

**User Story:** As a user, I want the navigation bar to stay smooth and never drain the device, so that the app feels responsive and efficient.

#### Acceptance Criteria

1. WHILE no tab interaction is occurring, THE Tab_Bar SHALL run no animation and SHALL consume no per-frame CPU or GPU work for the Glass_Backdrop.
2. WHEN the Sliding_Pill animates between Standard_Tab positions, THE Tab_Bar SHALL drive the animation on the `react-native-reanimated` UI thread targeting a 60 frames-per-second update rate.
3. THE Tab_Bar SHALL render a single static Glass_Backdrop without animated background elements.
4. THE Tab_Bar SHALL memoize tab button rendering so that unaffected tab buttons do not re-render when the Active_Tab changes.

### Requirement 6: Accessibility

**User Story:** As a user relying on assistive settings, I want the navigation bar to remain accessible, so that I can navigate the app regardless of my accessibility configuration.

#### Acceptance Criteria

1. THE Tab_Bar SHALL expose each tab control with a button accessibility role and an accessible label derived from the tab title.
2. THE Tab_Bar SHALL mark the Active_Tab control with the selected accessibility state.
3. WHERE the operating system reports Reduced_Transparency as enabled, THE Tab_Bar SHALL render an increased-opacity Glass_Backdrop in place of the translucent blur so that tab content remains legible.
4. THE Tab_Bar SHALL maintain icon and active-state contrast sufficient to distinguish the Active_Tab from inactive tabs in both light and dark themes.

### Requirement 7: No regression to navigation and haptics

**User Story:** As a user, I want the existing navigation and tactile feedback to keep working, so that the redesign changes only the appearance and not the behavior.

#### Acceptance Criteria

1. WHEN a tab control is pressed, THE Tab_Bar SHALL trigger a light haptic via `triggerHaptic('light')`.
2. WHEN a tab control is pressed, THE Tab_Bar SHALL emit a `tabPress` event and SHALL navigate to the pressed route when the route is not the Active_Tab and the event is not prevented.
3. WHEN a tab control is long-pressed, THE Tab_Bar SHALL emit a `tabLongPress` event for that route.
4. THE Tab_Bar SHALL continue to render all five routes (`index`, `search`, `create`, `messages`, `profile`) supplied by the expo-router `Tabs` navigator in their existing order.
5. THE Tab_Bar SHALL preserve the existing `app/(tabs)/_layout.tsx` wiring so that no change to the navigator configuration is required.
