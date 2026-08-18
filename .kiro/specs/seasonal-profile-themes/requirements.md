# Requirements Document

## Introduction

San-Mes is a React Native youth social-messenger app (Expo SDK 54, RN 0.81, iOS + Android) with a multi-account profile system. This feature adds **Seasonal Profile Themes**: thematic profile "skins" that change the whole visual vibe of a profile screen, not just an accent color. Each theme is a self-contained package that can override:

- a **color palette** (background gradient plus text, secondary, and accent colors);
- a **decorative full-screen background illustration** (e.g. spring meadow, summer beach, autumn forest, winter snowy hills, plus the default neutral dark and a dreamy purple/lavender variant);
- an **optional ambient animation** layered over the background (falling snow in winter, falling leaves in autumn);
- **themed accent touches** on specific UI elements — the like icon, the post-overflow ("…") menu area, and the follow ("Подписаться") button — rendered as small system-emoji/sticker accents (tulip, palm, pumpkin, gingerbread house, candy cane, etc.);
- **optional typography** (a theme may override the font, e.g. a pixel-art font).

The mockups (profile screen "milord") show six built-in skins: default dark, spring (green), summer/beach (peach), autumn (brown/orange), winter (blue), and purple pixel. Glass cards continue to sit on top of the colored background, matching the app's existing `GlassBg` liquid-glass pattern.

A key product decision captured here: the selected profile theme is **public** — it is part of the profile owner's identity (stored on the backend profile row alongside `banner_url`) and is rendered for anyone viewing that profile, with a deterministic fallback to the default theme when no theme is set or when assets fail to load.

Three project constraints dominate this design:

1. **Performance on weak devices is paramount.** The primary test device is a weak Android 10 (no liquid glass); the secondary is an iPhone on iOS 26 (has liquid glass). Ambient animations must be bounded (capped particle count), pause during scroll, and degrade to a static background on weak devices or when disabled. Smoothness is verified by the user via FPS perf snapshots.
2. **Apple compliance (Apple Developer Program License Agreement §3.3.4).** Every shipped decorative background illustration and any custom font must be owned by the team or properly licensed; otherwise App Review rejects the build. System-emoji accents are acceptable.
3. **Reuse existing systems.** The app already has a theme system (`src/theme`), an appearance settings screen (`app/settings/appearance.tsx`), a `ChatBackgroundLayer`, the `GlassBg`/`NativeGlassView` liquid-glass system gated by `useLiquidGlassActive()`, a `themeStore`, and per-account settings. This feature reuses those patterns rather than reinventing them.

Themes apply primarily to the profile screen — both the owner's own profile (`app/(tabs)/profile.tsx`) and other users' profiles (`app/profile/[id].tsx`).

## Glossary

- **Profile_Theme**: A named, self-contained visual package applied to a profile screen, consisting of a color palette and an optional background illustration, ambient animation, emoji accent set, and font override.
- **Theme_Id**: The stable string identifier of a Profile_Theme (e.g. `default-dark`, `spring`, `summer-beach`, `autumn`, `winter`, `purple-pixel`).
- **Default_Theme**: The Profile_Theme with Theme_Id `default-dark`; the neutral dark skin used as the fallback whenever no theme is selected or a theme cannot be rendered.
- **Built_In_Theme_Set**: The fixed set of six Profile_Themes shipped with the app: `default-dark`, `spring`, `summer-beach`, `autumn`, `winter`, and `purple-pixel`.
- **Theme_Palette**: The color portion of a Profile_Theme: background gradient stops plus text, secondary-text, and accent colors.
- **Background_Illustration**: The full-screen decorative image asset bundled with a Profile_Theme and rendered behind the glass profile content.
- **Ambient_Animation**: An optional looping particle animation (falling snow or falling leaves) layered over the Background_Illustration for specific Profile_Themes.
- **Emoji_Accent_Set**: The set of system-emoji/sticker glyphs a Profile_Theme applies to the like icon, the post-overflow ("…") menu area, and the follow button.
- **Theme_Font**: An optional font a Profile_Theme applies to profile typography in place of the app default font.
- **Profile_Owner**: The user account to which a profile belongs and who selects that profile's Profile_Theme.
- **Profile_Visitor**: Any user viewing a profile that is not their own.
- **Theme_Selection_Screen**: The settings UI where a Profile_Owner previews and selects a Profile_Theme, following the existing `app/settings/appearance.tsx` pattern.
- **Profile_API**: The backend profile endpoints (`GET`/`PATCH /v1/profiles/me` and profile fetch by id) that persist and return the profile row, including the selected Theme_Id alongside `banner_url`.
- **Theme_Store**: The client theme state module following the existing `src/store/themeStore` and `src/theme/ThemeProvider` patterns that resolves a Theme_Id to a concrete Profile_Theme for rendering.
- **Liquid_Glass_Active**: The boolean returned by the existing `useLiquidGlassActive()` hook, true only on supported iOS devices when the user has enabled liquid glass; false on Android and on unsupported or opted-out devices.
- **Reduced_Motion_Setting**: The user/system setting (OS reduce-motion preference and/or the app's existing motion toggle) that, when enabled, suppresses non-essential animation.
- **Weak_Device**: A device that does not support liquid glass and has limited rendering headroom (e.g. the primary Android 10 test device).
- **Particle_Cap**: The maximum number of simultaneously rendered Ambient_Animation particles permitted on screen.
- **Profile_Scroll**: A vertical scroll gesture in progress on a profile screen.

## Requirements

### Requirement 1: Built-in theme set

**User Story:** As a Profile_Owner, I want a set of distinct seasonal profile skins, so that I can express the vibe I want on my profile.

#### Acceptance Criteria

1. THE Theme_Store SHALL provide a Built_In_Theme_Set containing exactly six Profile_Themes, each identified by a unique Theme_Id, and those Theme_Ids SHALL be exactly `default-dark`, `spring`, `summer-beach`, `autumn`, `winter`, and `purple-pixel`.
2. THE Theme_Store SHALL define for each Profile_Theme in the Built_In_Theme_Set a Theme_Palette consisting of between 2 and 5 background gradient stops, exactly one primary text color, exactly one secondary text color, and exactly one accent color.
3. WHERE a Profile_Theme defines a Background_Illustration, THE Theme_Store SHALL associate that Profile_Theme with exactly one bundled full-screen image asset that is available without a network connection.
4. WHERE a Profile_Theme defines an Emoji_Accent_Set, THE Theme_Store SHALL associate that Profile_Theme with exactly one system-emoji glyph for each of the like icon, the post-overflow menu area, and the follow button.
5. WHERE a Profile_Theme defines a Theme_Font, THE Theme_Store SHALL associate that Profile_Theme with exactly one Theme_Font to apply to all profile typography.
6. THE Default_Theme SHALL be the member of the Built_In_Theme_Set identified by Theme_Id `default-dark`, presenting a neutral dark Theme_Palette.
7. WHEN a profile has no Profile_Theme selected, THE Theme_Store SHALL apply the Default_Theme to that profile.

### Requirement 2: Theme selection UI

**User Story:** As a Profile_Owner, I want to preview and choose a profile theme from settings, so that I can pick one before applying it to my profile.

#### Acceptance Criteria

1. WHEN the Theme_Selection_Screen is opened, THE Theme_Selection_Screen SHALL display one selectable preview for each Profile_Theme in the Built_In_Theme_Set.
2. WHEN the Theme_Selection_Screen is opened, THE Theme_Selection_Screen SHALL visually mark exactly one preview as selected, corresponding to the Profile_Owner's currently persisted Theme_Id.
3. IF the Profile_Owner has no persisted Theme_Id when the Theme_Selection_Screen is opened, THEN THE Theme_Selection_Screen SHALL mark the Default_Theme preview as selected.
4. WHEN a Profile_Owner selects a Profile_Theme and confirms the selection, THE Theme_Store SHALL set the Profile_Owner's active Theme_Id to the selected Profile_Theme's Theme_Id.
5. WHEN a Profile_Owner confirms a Profile_Theme selection, THE Theme_Selection_Screen SHALL persist the selected Theme_Id to the Profile_API and complete or fail the persistence attempt within 5 seconds.
6. IF persisting the selected Theme_Id to the Profile_API fails or does not complete within 5 seconds, THEN THE Theme_Selection_Screen SHALL display an error indication that persistence failed and SHALL revert both the displayed selection and the Theme_Store active Theme_Id to the previously persisted Theme_Id.
7. WHEN the Theme_Selection_Screen renders the list of Built_In_Theme_Set previews on the primary Weak_Device, THE Theme_Selection_Screen SHALL NOT produce a frame exceeding the app's existing long-task threshold.

### Requirement 3: Public storage of the selected theme

**User Story:** As a Profile_Owner, I want my chosen theme stored on my profile, so that it is part of my public profile like my banner.

#### Acceptance Criteria

1. THE Profile_API SHALL persist the Profile_Owner's selected Theme_Id on the profile row alongside the existing `banner_url` field.
2. WHEN a Profile_Owner confirms a theme selection, THE Theme_Selection_Screen SHALL send the selected Theme_Id to the Profile_API via the existing profile update path (`PATCH /v1/profiles/me`).
3. WHEN any client fetches a profile through the Profile_API, THE Profile_API SHALL include that profile's selected Theme_Id in the returned public profile data.
4. WHEN the Profile_Owner's selected Theme_Id changes, THE system SHALL propagate the updated Theme_Id to the profile cache within 5 seconds so subsequent renders reflect the change without an app restart or manual refresh.
5. THE selected Theme_Id SHALL be stored as part of the public profile data so that all viewers resolve the same Profile_Theme for a given profile.
6. IF a fetched profile contains no Theme_Id, THEN THE system SHALL resolve the Default_Theme for that profile.
7. IF a Theme_Id sent to the Profile_API does not match any Theme_Id in the Built_In_Theme_Set, THEN THE Profile_API SHALL reject the update, retain the previously stored Theme_Id, and the Theme_Selection_Screen SHALL display an error indication.
8. IF persisting the selected Theme_Id fails, THEN THE system SHALL retain the previously stored Theme_Id and signal an error to the Theme_Selection_Screen.

### Requirement 4: Rendering the owner's theme for visitors

**User Story:** As a Profile_Visitor, I want to see a profile rendered in its owner's chosen theme, so that the profile reflects that person's identity.

#### Acceptance Criteria

1. WHEN a Profile_Visitor views a profile (`app/profile/[id].tsx`) whose Profile_Owner has a selected Theme_Id, THE system SHALL render that profile using the Profile_Owner's selected Profile_Theme.
2. WHEN a Profile_Owner views their own profile (`app/(tabs)/profile.tsx`), THE system SHALL render the profile using the Profile_Owner's selected Profile_Theme.
3. IF a profile's Profile_Owner has no selected Theme_Id, THEN THE system SHALL render that profile using the Default_Theme.
4. WHEN a Profile_Theme is applied to a profile screen, THE system SHALL render the profile's glass content cards on top of the Theme_Palette and Background_Illustration using the existing `GlassBg` pattern.
5. IF a Background_Illustration has not loaded within 5 seconds or returns a load error, THEN THE system SHALL render the profile using the Profile_Theme's Theme_Palette without the Background_Illustration.
6. WHERE a Profile_Theme defines an Emoji_Accent_Set, THE system SHALL render the theme's emoji accents on the like icon, the post-overflow menu area, and the follow button of that profile screen.
7. WHERE a Profile_Theme defines no Emoji_Accent_Set, THE system SHALL render the like icon, the post-overflow menu area, and the follow button without emoji accents.
8. WHERE a Profile_Theme defines a Theme_Font, THE system SHALL apply the Theme_Font to profile typography while that Profile_Theme is active on the profile screen.
9. WHERE a Profile_Theme defines no Theme_Font, THE system SHALL render profile typography using the app default font.
10. WHILE a Profile_Theme is active on a profile screen, THE system SHALL confine the Theme_Palette, Background_Illustration, Ambient_Animation, Emoji_Accent_Set, and Theme_Font to that profile screen and SHALL NOT apply them to any other screen.

### Requirement 5: Default and fallback behavior

**User Story:** As a Profile_Visitor, I want a profile to always look correct, so that a missing or broken theme never leaves the profile blank or unstyled.

#### Acceptance Criteria

1. IF a profile has no selected Theme_Id, THEN THE system SHALL render that profile using the Default_Theme.
2. IF a profile's stored Theme_Id does not match any Theme_Id in the Built_In_Theme_Set, THEN THE system SHALL render that profile using the Default_Theme.
3. IF a Background_Illustration asset has not finished loading within 5 seconds or returns a load error, THEN THE system SHALL render the profile using the Profile_Theme's Theme_Palette without the Background_Illustration.
4. IF a Theme_Font asset has not finished loading within 5 seconds or returns a load error, THEN THE system SHALL render profile typography using the app default font while continuing to apply the Profile_Theme's Theme_Palette.
5. WHEN a Profile_Theme is resolved for rendering, THE Theme_Store SHALL return a complete renderable Profile_Theme that includes a non-empty Theme_Palette and a Theme_Font, such that no profile screen is left without a Theme_Palette.
6. THE Theme_Store SHALL treat the Default_Theme as always available with a complete Theme_Palette and Theme_Font, so that every fallback path resolves to a renderable Profile_Theme.

### Requirement 6: Bounded ambient animations

**User Story:** As a user on any device, I want seasonal animations to stay lightweight, so that they add atmosphere without degrading smoothness.

#### Acceptance Criteria

1. WHERE a Profile_Theme defines an Ambient_Animation, THE system SHALL ensure the number of simultaneously rendered particles does not exceed the Particle_Cap at any point in time.
2. WHILE a Profile_Scroll is in progress on a profile screen with an active Ambient_Animation, THE system SHALL pause the Ambient_Animation within 100 milliseconds of the Profile_Scroll starting.
3. WHEN a Profile_Scroll ends, THE system SHALL resume the Ambient_Animation within 200 milliseconds.
4. WHILE an Ambient_Animation is paused, THE system SHALL continue displaying the Background_Illustration and Theme_Palette as a static background.
5. THE Ambient_Animation SHALL render only on profile screens where the associated Profile_Theme is active.
6. WHILE an Ambient_Animation is rendering, THE system SHALL maintain a rendering frame rate of at least 55 frames per second.
7. WHILE a profile screen with an active Ambient_Animation is not visible because the application is backgrounded or the profile screen is scrolled out of view, THE system SHALL pause the Ambient_Animation.

### Requirement 7: Weak-device and motion degradation

**User Story:** As a user on a weak device or with reduced motion enabled, I want themes to degrade gracefully, so that the app stays smooth and respects my settings.

#### Acceptance Criteria

1. WHILE Liquid_Glass_Active is false on a Weak_Device, THE system SHALL render the Profile_Theme as a static Background_Illustration and Theme_Palette without any Ambient_Animation.
2. WHILE the Reduced_Motion_Setting is enabled, THE system SHALL suppress the Ambient_Animation and render the Profile_Theme as a static background.
3. WHEN the Reduced_Motion_Setting becomes enabled while a profile screen with an active Ambient_Animation is displayed, THE system SHALL suppress the Ambient_Animation within 500 milliseconds without reloading the profile screen.
4. WHEN Liquid_Glass_Active is false, THE system SHALL render profile glass content using the existing non-glass fallback used elsewhere in the app.
5. THE system SHALL apply the Theme_Palette, Background_Illustration, and Emoji_Accent_Set on Weak_Devices independently of whether the Ambient_Animation is rendered.
6. WHEN a Profile_Theme is rendered on the primary Weak_Device, THE system SHALL maintain a Profile_Scroll frame rate of at least 55 frames per second on a 60 Hz display and within 5 frames per second of the themeless profile screen baseline.
7. IF a Background_Illustration fails to load on a Weak_Device, THEN THE system SHALL render the profile with a solid Theme_Palette background while retaining the Emoji_Accent_Set and the profile content.

### Requirement 8: Asset licensing and ownership

**User Story:** As the app publisher, I want every shipped theme asset to be owned or licensed, so that the build passes Apple App Review under §3.3.4.

#### Acceptance Criteria

1. THE Built_In_Theme_Set SHALL ship only Background_Illustration assets for which an ownership record or a distribution license permitting inclusion and redistribution within the app is on file, where each record identifies the asset, its license type, and its source.
2. THE Built_In_Theme_Set SHALL ship only Theme_Font assets for which an ownership record or a distribution license permitting embedding and redistribution within the app is on file, where each record identifies the asset, its license type, and its source.
3. WHERE a Profile_Theme uses emoji accents, THE Emoji_Accent_Set SHALL render emoji using system-provided glyphs supplied by the operating system and SHALL NOT bundle any third-party emoji image asset or third-party emoji font asset.
4. THE feature SHALL NOT ship any Background_Illustration or Theme_Font asset whose license prohibits distribution or redistribution within the app.
5. WHEN the build process assembles the Built_In_Theme_Set, THE feature SHALL verify that every Background_Illustration asset and every Theme_Font asset has an associated ownership or distribution-license record.
6. IF a Background_Illustration or Theme_Font asset lacks an associated ownership or distribution-license record, THEN THE feature SHALL exclude that asset from the Built_In_Theme_Set and the build SHALL fail with an error indicating which asset is unlicensed.

### Requirement 9: Reuse of existing theming and settings systems

**User Story:** As a developer, I want this feature built on the existing theming and settings infrastructure, so that behavior stays consistent and maintainable.

#### Acceptance Criteria

1. THE Theme_Store SHALL extend the existing theme infrastructure (`src/theme` and `src/store/themeStore`) and route theme state through that existing store rather than instantiating a parallel theming store or provider.
2. WHEN a profile screen renders a Background_Illustration, THE system SHALL render it using the existing full-screen background layering pattern established by `ChatBackgroundLayer`, covering the full screen behind the profile content.
3. WHILE Liquid_Glass_Active is true, THE system SHALL render profile content cards as glass, and WHILE Liquid_Glass_Active is false, THE system SHALL render them using the existing non-glass fallback.
4. THE Theme_Selection_Screen SHALL follow the interaction and performance patterns of the existing `app/settings/appearance.tsx` screen, mounting only the previews within the visible viewport plus one viewport of overscan and deferring off-screen previews.
5. THE selected Theme_Id SHALL be scoped per account consistent with the app's existing per-account settings, such that changing one account's Theme_Id leaves other accounts' stored Theme_Id unchanged.
6. IF no Theme_Id is stored for the active account, THEN THE Theme_Store SHALL resolve the Default_Theme.
7. IF a stored Theme_Id cannot be resolved to a Built_In_Theme_Set member, THEN THE Theme_Store SHALL fall back to the Default_Theme, retain the stored Theme_Id value, and indicate that the Default_Theme is active.
