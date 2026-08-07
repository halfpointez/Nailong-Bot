import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface NaiLongItem {
  id: string;
  name: string;
  description: string;
  analysis: string;
  file: string;
  rarity: "common" | "rare" | "epic" | "legendary";
}

export interface UserRecord {
  user_id: string;
  coins: number;
  sign_in_date: string | null;
  total_draws: number;
}

export interface CollectionRecord {
  user_id: string;
  nailong_id: string;
  obtained_at: string;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error("数据库未初始化，请先调用 initDb()");
  return db;
}

export function initDb(resourceDir: string): void {
  const dbPath = resolve(resourceDir, "nailong.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS nailongs (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      analysis    TEXT,
      file        TEXT NOT NULL,
      rarity      TEXT NOT NULL CHECK(rarity IN ('common','rare','epic','legendary'))
    );
    CREATE TABLE IF NOT EXISTS users (
      user_id       TEXT PRIMARY KEY,
      coins         INTEGER DEFAULT 0,
      sign_in_date  TEXT,
      total_draws   INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS collections (
      user_id     TEXT NOT NULL,
      nailong_id  TEXT NOT NULL,
      obtained_at TEXT NOT NULL,
      PRIMARY KEY (user_id, nailong_id),
      FOREIGN KEY (nailong_id) REFERENCES nailongs(id)
    );
    CREATE TABLE IF NOT EXISTS easter_eggs (
      user_id  TEXT NOT NULL,
      egg_name TEXT NOT NULL,
      date     TEXT NOT NULL,
      PRIMARY KEY (user_id, egg_name)
    );
  `);

  const count = db.prepare("SELECT COUNT(*) as c FROM nailongs").get() as { c: number };
  if (count.c === 0) {
    const jsonPath = resolve(resourceDir, "nailong.json");
    const data = JSON.parse(readFileSync(jsonPath, "utf-8")) as NaiLongItem[];
    const insert = db.prepare(
      "INSERT OR IGNORE INTO nailongs (id, name, description, analysis, file, rarity) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertMany = db.transaction((items: NaiLongItem[]) => {
      for (const item of items) {
        insert.run(item.id, item.name, item.description, item.analysis, item.file, item.rarity);
      }
    });
    insertMany(data);
  }
}

export function getUser(userId: string): UserRecord {
  const row = getDb().prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as UserRecord | undefined;
  return row ?? { user_id: userId, coins: 0, sign_in_date: null, total_draws: 0 };
}

export function upsertUser(userId: string, updates: Partial<UserRecord>): void {
  const existing = getDb().prepare("SELECT user_id FROM users WHERE user_id = ?").get(userId);
  if (existing) {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (updates.coins !== undefined) { sets.push("coins = ?"); params.push(updates.coins); }
    if (updates.sign_in_date !== undefined) { sets.push("sign_in_date = ?"); params.push(updates.sign_in_date); }
    if (updates.total_draws !== undefined) { sets.push("total_draws = ?"); params.push(updates.total_draws); }
    if (sets.length > 0) {
      params.push(userId);
      getDb().prepare(`UPDATE users SET ${sets.join(", ")} WHERE user_id = ?`).run(...params);
    }
  } else {
    getDb().prepare(
      "INSERT INTO users (user_id, coins, sign_in_date, total_draws) VALUES (?, ?, ?, ?)"
    ).run(userId, updates.coins ?? 0, updates.sign_in_date ?? null, updates.total_draws ?? 0);
  }
}

export function getCollections(userId: string): CollectionRecord[] {
  return getDb().prepare(
    "SELECT * FROM collections WHERE user_id = ? ORDER BY obtained_at"
  ).all(userId) as CollectionRecord[];
}

export function addCollection(userId: string, nailongId: string): void {
  const today = new Date().toISOString().slice(0, 10);
  getDb().prepare(
    "INSERT OR IGNORE INTO collections (user_id, nailong_id, obtained_at) VALUES (?, ?, ?)"
  ).run(userId, nailongId, today);
}

export function getAllNaiLongs(): NaiLongItem[] {
  return getDb().prepare("SELECT * FROM nailongs").all() as NaiLongItem[];
}

export function getNaiLongById(id: string): NaiLongItem | undefined {
  return getDb().prepare("SELECT * FROM nailongs WHERE id = ?").get(id) as NaiLongItem | undefined;
}

export function isEasterEggCoolingDown(userId: string, eggName: string, date: string): boolean {
  const row = getDb().prepare(
    "SELECT 1 FROM easter_eggs WHERE user_id = ? AND egg_name = ? AND date = ?"
  ).get(userId, eggName, date);
  return row !== undefined;
}

export function triggerEasterEgg(userId: string, eggName: string, date: string): void {
  getDb().prepare(
    "INSERT OR IGNORE INTO easter_eggs (user_id, egg_name, date) VALUES (?, ?, ?)"
  ).run(userId, eggName, date);
}
