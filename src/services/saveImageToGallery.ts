/**
 * Save a chat photo to the device's photo library.
 *
 * Add-only access: `requestPermissionsAsync(true)` asks for the write-only scope, the least access
 * that can save a file. It never lets the app read the library. iOS shows
 * `NSPhotoLibraryAddUsageDescription` (already declared in app.json) the first time, so this needs
 * no new permission and ships over the air.
 *
 * The ORIGINAL is downloaded, not the resized derivative the bubble and the viewer show (they load
 * a weserv copy at the screen's width), because someone who asks to download a photo wants the
 * photo. It goes into the cache directory under a name with the right extension:
 * `expo-media-library` rejects a file without one, and the image caches name their files by hash.
 *
 * Uses the `File` API of expo-file-system 19. The module's legacy functions (`downloadAsync`,
 * `cacheDirectory`) are not exported from the main entry any more and throw at runtime there,
 * which is why the old copy of this code in `app/chat/fullscreen.tsx` could only ever fail when the
 * photo was not already in the image cache.
 *
 * Everything is imported lazily so screens that never save do not load the modules.
 */
export type SaveImageResult = 'saved' | 'denied' | 'failed';

const KNOWN_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif']);

/** The file extension of an image URL's path, or `jpg` when it has none we recognise. */
export function imageExtensionOf(uri: string): string {
  const path = uri.split(/[?#]/)[0];
  const match = /\.([a-z0-9]+)$/i.exec(path);
  const ext = match ? match[1].toLowerCase() : '';
  return KNOWN_EXTENSIONS.has(ext) ? ext : 'jpg';
}

export async function saveImageToGallery(uri: string): Promise<SaveImageResult> {
  if (!uri) return 'failed';
  let temp: { delete: () => void } | null = null;
  try {
    const MediaLibrary = await import('expo-media-library');
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm.granted) return 'denied';

    let localUri: string;
    if (uri.startsWith('file:')) {
      // A photo still on this device (sent a moment ago, not yet replaced by its uploaded URL).
      localUri = uri;
    } else {
      const { File, Paths } = await import('expo-file-system');
      const target = new File(Paths.cache, `san-save-${Date.now()}.${imageExtensionOf(uri)}`);
      const downloaded = await File.downloadFileAsync(uri, target, { idempotent: true });
      temp = downloaded;
      localUri = downloaded.uri;
    }
    await MediaLibrary.saveToLibraryAsync(localUri);
    return 'saved';
  } catch {
    return 'failed';
  } finally {
    // The library keeps its own copy; the download is not needed after the save.
    try {
      temp?.delete();
    } catch {
      // A leftover file in the cache directory is harmless; the OS clears it.
    }
  }
}
