# Apple Developer Program License Agreement Compliance

The user has accepted the **Apple Developer Program License Agreement** (full text in `eple.txt` at the workspace root). Every change to this app MUST keep us in compliance. The most operationally relevant rules for our app type (iOS social messenger with user-generated posts, chats, profile system, in-app music playback, OTA updates) are summarized here.

## Always-on rules

### Privacy & data collection (§3.3.3.B–D)

- **Never collect user/device data without explicit consent.** This applies to anything sent to our backend, telemetry, third-party SDKs, etc.
- **No fingerprinting.** Do not derive a stable per-device identifier from any data, ever. Never combine device characteristics to track users.
- **No use of permanent device identifiers.** Use opaque per-install tokens (we already do this via Supabase auth IDs and per-account MMKV).
- **Privacy policy.** App Store listing and an in-app accessible privacy policy URL are required. Update both whenever data flows change.
- **Breach notification.** If user data is ever exposed, the user MUST be notified per applicable law.
- **Scope creep.** Don't expand how previously collected data is used without obtaining fresh consent. If we add a feature that re-purposes existing data (e.g., using profile data for recommendations), prompt the user.

### Permissions / `Info.plist` usage descriptions (§3.3.3.F.iv)

Every iOS permission we request needs an honest `NS*UsageDescription` string in `app.json` → `ios.infoPlist`. Apple rejects builds with missing or misleading strings.

Currently declared:
- `NSPhotoLibraryUsageDescription` — gallery picker (posts, comments, chat, profile, banner, chat background)
- `NSPhotoLibraryAddUsageDescription` — save post screenshots to library
- `NSCameraUsageDescription` — camera capture for posts
- `NSMotionUsageDescription` — gyroscope/accelerometer via `expo-sensors`, reserved for future parallax/motion UI effects. NOTE: the dependency is installed but NOT yet imported in runtime JS; the string is pre-declared so the NEXT native build is App-Store-ready the moment we start using motion. Do not ship a motion feature over OTA to a build that predates the sensors module.
- `UIBackgroundModes: ["audio"]` — required because `expo-av` plays music with `staysActiveInBackground: true`

If we later add features that need any of the following, add the matching key BEFORE merging:
- Microphone recording → `NSMicrophoneUsageDescription`
- Location → `NSLocationWhenInUseUsageDescription` or `NSLocationAlwaysAndWhenInUseUsageDescription`
- Contacts → `NSContactsUsageDescription`
- Calendars / Reminders → `NSCalendarsUsageDescription` / `NSRemindersUsageDescription`
- HealthKit / Motion → `NSHealthShareUsageDescription` etc. (requires special framework approval)
- Bluetooth → `NSBluetoothAlwaysUsageDescription`
- Local network discovery → `NSLocalNetworkUsageDescription` + `NSBonjourServices`
- App Tracking Transparency (IDFA) → `NSUserTrackingUsageDescription` AND call `requestTrackingAuthorization()` BEFORE any tracking

Strings must accurately and specifically describe HOW we use the data — generic "we need this" copy gets rejected.

### Tracking / IDFA (§3.3.3.E)

We do **not** currently use the Advertising Identifier or any third-party tracking SDK. **Do not add one** without:
1. Adding `NSUserTrackingUsageDescription` to Info.plist.
2. Calling `expo-tracking-transparency`'s `requestTrackingPermissionsAsync()` and respecting denial.
3. Updating the App Store Privacy nutrition label.
4. Getting user opt-in BEFORE any tracking call fires.

### Recordings (§3.3.3.A)

If we ever add audio/video/screen capture or photo capture, the UI must show a clear visual indicator while recording is active. Apps cannot record others without their awareness — covert recording is grounds for removal.

### App Transport Security

ATS is left at its iOS default (HTTPS-only). Do not introduce `NSAllowsArbitraryLoads: true`. All backend endpoints (Supabase, Vercel API, music providers) MUST be HTTPS. If a feature requires a specific HTTP host, add a narrow `NSExceptionDomains` entry with justification rather than disabling ATS globally.

### Push notifications (§3.3.3 + APN definitions)

We currently use only **local notifications** (in-app `notifications.tsx` reading from Supabase). If we add APN push:
- Request authorization with `Notifications.requestPermissionsAsync()`.
- Push payloads must be relevant to the user — no marketing/spam without opt-in.
- Cannot use push for tracking or for sending data to/from device for ad purposes.

## Content & IP rules (§3.3.4)

### User-generated content (App Review Guideline 1.2)

Posts, comments, profile bios, chat messages — all user content. We MUST provide:
- A way to **report** objectionable content (we have this in `PostMenuModal` / chat menus — keep it working).
- A way to **block** other users.
- Moderation/removal of content reported as abusive within 24 hours.
- Terms of service forbidding objectionable content.

If a refactor removes any of these features, the App Store will reject the next submission. Re-add them.

### Music & audio (§3.3.4.A.i)

> Any master recordings and musical compositions embodied in Your Application must be wholly-owned by You or licensed to You on a fully paid-up basis...

Our current music sources, ranked by safety:
1. **iTunes Search API previews** — explicitly permitted by Apple, safe.
2. **Audius public API** — Audius is a Creative-Commons / artist-licensed platform; their API explicitly allows third-party streaming. Safe.
3. **SoundCloud direct stream URLs** — **gray area.** SoundCloud's TOS requires use of their official API with `client_id`. Our scraping of their HTML to extract `client_id` and direct stream URL fetching is technically against their TOS, which under §3.3.4.A.i would constitute infringing third-party rights. **Plan to migrate** to SoundCloud's official Widget API or remove SoundCloud entirely before App Store submission, OR document that all SoundCloud tracks we surface are CC-licensed.

When adding new audio sources, verify the rights and add a note here.

### Other content (§3.3.4.A.ii–iv)

- All images, icons, fonts, sounds shipped in the app must be owned or licensed.
- Feather icons are MIT-licensed (✓), Inter font is OFL (✓), our Telegram-style icon experiments must NOT ship anything from the rejected `telegram_ios_settings_icon_pack*.zip` files (they remain `gitignore`d).
- No malware, no FOSS contamination of non-FOSS code paths.

## Apple-branded references (§3.3.6)

- Don't claim "Made for iPhone" or use Apple trademarks.
- Don't disparage Apple-branded products in app text.
- Use of "Apple Music" or "Apple" in app text only as descriptive — and only where accurate (e.g., the `iTunes Search API` is sometimes labeled — keep that minimal).

## App Review readiness checklist

Before any App Store submission, verify:

- [ ] All `NS*UsageDescription` strings present in `app.json`.
- [ ] App Store Connect Privacy questionnaire matches actual data collection.
- [ ] Content reporting + user blocking flows still work.
- [ ] No SoundCloud direct-stream calls (or fully replaced with licensed source).
- [ ] No `NSAllowsArbitraryLoads: true` without explicit business justification ready for review.
- [ ] All third-party SDKs are in the App Store privacy manifest list.
- [ ] OTA updates via `eas update` only deliver JS/asset changes — never new native permissions.
- [ ] Build does not include unused entitlements.

## When in doubt

Search `eple.txt` for the relevant API name (e.g., "HealthKit", "Push Notification", "Address Book") to find the specific subsection that governs it. The agreement is the source of truth — this file is just a fast index.
