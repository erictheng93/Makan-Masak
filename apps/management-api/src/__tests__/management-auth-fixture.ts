import type Database from "better-sqlite3";

export const MANAGEMENT_ADMIN_ID = "018f0000-0000-7000-8000-000000000001";
export const MANAGEMENT_SESSION_ID = "management-test-session";

export function seedManagementAdmin(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role INTEGER NOT NULL, is_active INTEGER,
      token_version INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER,
      deleted_at_ms INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT, is_active INTEGER, expires_at_ms INTEGER
    );
  `);
  sqlite
    .prepare(
      `INSERT INTO users
    (id, username, full_name, password_hash, role, is_active, token_version, created_at_ms, updated_at_ms)
    VALUES (?, 'management-fixture-admin', 'Platform Admin', 'unused', 0, 1, 1, ?, ?)`,
    )
    .run(MANAGEMENT_ADMIN_ID, Date.now(), Date.now());
  sqlite
    .prepare(
      "INSERT INTO sessions (id, user_id, is_active, expires_at_ms) VALUES (?, ?, 1, ?)",
    )
    .run(MANAGEMENT_SESSION_ID, MANAGEMENT_ADMIN_ID, Date.now() + 3600000);
}
