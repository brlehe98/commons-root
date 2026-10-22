import { rootServer } from "@rootsdk/server-app";
import { Database } from "sqlite3";

let db: Database;

/** False when this SQLite build has no full-text search: search falls back to LIKE. */
export let hasFts = true;

export async function openDatabase(): Promise<void> {
  db = new Database(rootServer.dataStore.config.sqlite3!.filename);
  await exec(`
    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      state BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      compressed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      state_gzip BLOB NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      author_id TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS versions_doc ON versions (doc_id, created_at);

    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      main INTEGER NOT NULL DEFAULT 0,
      role_id TEXT NOT NULL DEFAULT '',
      everyone_reads INTEGER NOT NULL DEFAULT 1,
      icon TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '',
      home TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS space_access (
      space_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      level INTEGER NOT NULL,
      PRIMARY KEY (space_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      parent_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS categories_space ON categories (space_id, parent_id, position);

    CREATE TABLE IF NOT EXISTS page_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      fields TEXT NOT NULL DEFAULT '[]',
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      title TEXT NOT NULL,
      type_id TEXT NOT NULL DEFAULT '',
      category_id TEXT NOT NULL DEFAULT '',
      fields TEXT NOT NULL DEFAULT '[]',
      community INTEGER NOT NULL DEFAULT 0,
      lang TEXT NOT NULL DEFAULT '',
      translation_group TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      -- The current publication, or NULL while never published.
      revision_id INTEGER,
      published_at INTEGER,
      published_by TEXT NOT NULL DEFAULT '',
      published_title TEXT NOT NULL DEFAULT '',
      published_fields TEXT NOT NULL DEFAULT '[]',
      lead TEXT NOT NULL DEFAULT '',
      -- The draft changed after the last publication.
      draft_changed INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS pages_space ON pages (space_id, category_id);
    CREATE INDEX IF NOT EXISTS pages_group ON pages (translation_group);

    CREATE TABLE IF NOT EXISTS page_tags (
      page_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (page_id, tag)
    );
    CREATE INDEX IF NOT EXISTS page_tags_tag ON page_tags (tag);

    -- Each publication: the text as ProseMirror JSON, gzipped.
    CREATE TABLE IF NOT EXISTS revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      author_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      fields TEXT NOT NULL DEFAULT '[]',
      content_gzip BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS revisions_page ON revisions (page_id, id);

    -- Links between published pages, for "What links here".
    CREATE TABLE IF NOT EXISTS page_links (
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      PRIMARY KEY (from_id, to_id)
    );
    CREATE INDEX IF NOT EXISTS page_links_to ON page_links (to_id);

    -- Plain text of each published page, for search without full-text tables.
    CREATE TABLE IF NOT EXISTS page_text (
      page_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      space_id TEXT NOT NULL,
      kind INTEGER NOT NULL,
      text TEXT NOT NULL,
      author_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      resolved_by TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS reports_space ON reports (space_id, resolved_at);

    CREATE TABLE IF NOT EXISTS follows (
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      PRIMARY KEY (user_id, kind, target_id)
    );
    CREATE INDEX IF NOT EXISTS follows_target ON follows (kind, target_id);

    CREATE TABLE IF NOT EXISTS notify_prefs (
      user_id TEXT NOT NULL,
      kind INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      PRIMARY KEY (user_id, kind)
    );
  `);
  // Columns added after the first release; existing rows get the empty default.
  await addColumn("categories", "icon TEXT NOT NULL DEFAULT ''");
  await addColumn("categories", "color TEXT NOT NULL DEFAULT ''");
  await addColumn("spaces", "home_i18n TEXT NOT NULL DEFAULT '{}'");
  try {
    await exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(page_id UNINDEXED, title, body, tags, tokenize="unicode61 remove_diacritics 2")`,
    );
  } catch (err) {
    hasFts = false;
    console.warn("Full-text search unavailable, using simple search:", (err as Error)?.message ?? err);
  }
}

/** Adds a column to a table created by an earlier version of the app. */
export async function addColumn(table: string, definition: string) {
  const name = definition.split(" ")[0];
  const columns = await all<{ name: string }>(`PRAGMA table_info(${table})`, []);
  if (!columns.some((c) => c.name === name)) await exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function exec(sql: string): Promise<void> {
  return new Promise((resolve, reject) => db.exec(sql, (err) => (err ? reject(err) : resolve())));
}

export function run(sql: string, params: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
}

export function all<T>(sql: string, params: unknown[]): Promise<T[]> {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))),
  );
}

export function get<T>(sql: string, params: unknown[]): Promise<T | undefined> {
  return new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T | undefined))),
  );
}

/** "?, ?, ?" for an IN list. */
export const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");
