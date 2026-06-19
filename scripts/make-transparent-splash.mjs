import fs from 'fs';
// 1x1 fully-transparent PNG. Used as the splash "logo" so expo-splash-screen
// still generates the required Android `splashscreen_logo` drawable (the
// release build links against it) while showing NOTHING — the native splash is
// then just the solid background colour, handing straight off to the app's own
// JS loading screen. No more stock Apple/Android logo-square splash.
const b64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
fs.writeFileSync('assets/splash-transparent.png', Buffer.from(b64, 'base64'));
console.log('wrote assets/splash-transparent.png', fs.statSync('assets/splash-transparent.png').size, 'bytes');
