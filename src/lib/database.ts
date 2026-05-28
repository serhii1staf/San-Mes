import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;
let dbInitialized = false;
let dbFailed = false;

// No-op database for graceful degradation when SQLite is unavailable
const noopDb = {
  execSync: () => {},
  runSync: () => ({ changes: 0, lastInsertRowId: 0 }),
  getAllSync: () => [],
  getFirstSync: () => null,
} as unknown as SQLite.SQLiteDatabase;

/**
 * Get the SQLite database instance.
 * Returns a no-op mock if SQLite is not available (graceful degradation).
 */
export function getDatabase(): SQLite.SQLiteDatabase {
  if (dbFailed) return noopDb;
  if (!db) {
    try {
      db = SQLite.openDatabaseSync('san.db');
    } catch (e) {
      dbFailed = true;
      console.warn('[Database] Failed to open SQLite:', e);
      return noopDb;
    }
  }
  return db;
}

/**
 * Check if database is available and initialized.
 */
export function isDatabaseReady(): boolean {
  return dbInitialized && !dbFailed;
}

/**
 * Initialize all database tables. Call once on app startup.
 * Returns false if initialization fails (app should continue without local DB).
 */
export function initDatabase(): boolean {
  try {
    const database = getDatabase();
    if (dbFailed) return false;

  database.execSync(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      likes_count INTEGER NOT NULL DEFAULT 0,
      comments_count INTEGER NOT NULL DEFAULT 0,
      shares_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
  `);

  database.execSync(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      emoji TEXT DEFAULT '😊',
      bio TEXT DEFAULT '',
      banner_url TEXT,
      links TEXT,
      pin_hash TEXT,
      device_key TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  database.execSync(`
    CREATE TABLE IF NOT EXISTS likes (
      user_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      PRIMARY KEY (user_id, post_id)
    );
  `);

  database.execSync(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);

  database.execSync(`
    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      PRIMARY KEY (follower_id, following_id)
    );
  `);

  database.execSync(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  database.execSync(`
    CREATE TABLE IF NOT EXISTS mutation_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );
  `);

  // Create indexes for common queries
  database.execSync(`CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);`);
  database.execSync(`CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);`);
  database.execSync(`CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);`);
  database.execSync(`CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);`);
  database.execSync(`CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);`);
  database.execSync(`CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);`);
  database.execSync(`CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);`);
  database.execSync(`CREATE INDEX IF NOT EXISTS idx_mutation_status ON mutation_queue(status);`);

    dbInitialized = true;
    return true;
  } catch (e) {
    dbFailed = true;
    console.warn('[Database] initDatabase failed:', e);
    return false;
  }
}

// --- Helper functions for sync_meta ---

export function getSyncMeta(key: string): string | null {
  if (!isDatabaseReady()) return null;
  try {
    const database = getDatabase();
    const row = database.getFirstSync<{ value: string }>(
      'SELECT value FROM sync_meta WHERE key = ?',
      [key]
    );
    return row?.value ?? null;
  } catch { return null; }
}

export function setSyncMeta(key: string, value: string): void {
  if (!isDatabaseReady()) return;
  try {
    const database = getDatabase();
    database.runSync(
      'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
      [key, value]
    );
  } catch {}
}
