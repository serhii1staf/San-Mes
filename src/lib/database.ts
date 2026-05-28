// Database layer - graceful degradation if SQLite unavailable
// Uses dynamic import to prevent crash if native module missing

let db: any = null;
let dbInitialized = false;
let dbFailed = false;

const noopDb = {
  execSync: () => {},
  runSync: () => ({ changes: 0, lastInsertRowId: 0 }),
  getAllSync: () => [] as any[],
  getFirstSync: () => null,
};

export function getDatabase(): any {
  if (dbFailed) return noopDb;
  if (!db) {
    try {
      const SQLite = require('expo-sqlite');
      db = SQLite.openDatabaseSync('san.db');
    } catch (e) {
      dbFailed = true;
      return noopDb;
    }
  }
  return db;
}

export function isDatabaseReady(): boolean {
  return dbInitialized && !dbFailed;
}

export function initDatabase(): boolean {
  try {
    const database = getDatabase();
    if (dbFailed) return false;

    database.execSync(`CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, author_id TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', image_url TEXT, likes_count INTEGER NOT NULL DEFAULT 0, comments_count INTEGER NOT NULL DEFAULT 0, shares_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT);`);
    database.execSync(`CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', emoji TEXT DEFAULT '😊', bio TEXT DEFAULT '', banner_url TEXT, links TEXT, pin_hash TEXT, device_key TEXT, created_at TEXT, updated_at TEXT);`);
    database.execSync(`CREATE TABLE IF NOT EXISTS likes (user_id TEXT NOT NULL, post_id TEXT NOT NULL, PRIMARY KEY (user_id, post_id));`);
    database.execSync(`CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, author_id TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);`);
    database.execSync(`CREATE TABLE IF NOT EXISTS follows (follower_id TEXT NOT NULL, following_id TEXT NOT NULL, PRIMARY KEY (follower_id, following_id));`);
    database.execSync(`CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT);`);
    database.execSync(`CREATE TABLE IF NOT EXISTS mutation_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');`);
    database.execSync(`CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);`);
    database.execSync(`CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);`);
    database.execSync(`CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);`);
    database.execSync(`CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);`);
    database.execSync(`CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);`);
    database.execSync(`CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);`);
    database.execSync(`CREATE INDEX IF NOT EXISTS idx_mutation_status ON mutation_queue(status);`);

    dbInitialized = true;
    return true;
  } catch (e) {
    dbFailed = true;
    return false;
  }
}

export function getSyncMeta(key: string): string | null {
  if (!isDatabaseReady()) return null;
  try {
    const row = getDatabase().getFirstSync('SELECT value FROM sync_meta WHERE key = ?', [key]);
    return row?.value ?? null;
  } catch { return null; }
}

export function setSyncMeta(key: string, value: string): void {
  if (!isDatabaseReady()) return;
  try {
    getDatabase().runSync('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [key, value]);
  } catch {}
}
