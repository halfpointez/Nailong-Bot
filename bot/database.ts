import initSqlJs, { type Database } from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

let db: Database | null = null;
let dbPath: string = "";

function getDb(): Database {
  if (!db) throw new Error("数据库未初始化，请先调用 initDb()");
  return db;
}

function saveDb(): void {
  if (db) {
    writeFileSync(dbPath, Buffer.from(db.export()));
  }
}

function queryAll<T>(
  sql: string,
  params: (string | number | null)[] = []
): T[] {
  const d = getDb();
  const stmt = d.prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return rows;
}

function queryOne<T>(
  sql: string,
  params: (string | number | null)[] = []
): T | undefined {
  const d = getDb();
  const stmt = d.prepare(sql);
  stmt.bind(params);
  let result: T | undefined;
  if (stmt.step()) {
    result = stmt.getAsObject() as unknown as T;
  }
  stmt.free();
  return result;
}

function execute(
  sql: string,
  params: (string | number | null)[] = []
): void {
  getDb().run(sql, params);
  saveDb();
}

export async function initDb(resourceDir: string): Promise<void> {
  const SQL = await initSqlJs();
  dbPath = resolve(resourceDir, "nailong.db");

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");

  execute(`CREATE TABLE IF NOT EXISTS nailongs (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    analysis    TEXT,
    file        TEXT NOT NULL,
    rarity      TEXT NOT NULL
  )`);
  execute(`CREATE TABLE IF NOT EXISTS users (
    user_id       TEXT PRIMARY KEY,
    coins         INTEGER DEFAULT 0,
    sign_in_date  TEXT,
    total_draws   INTEGER DEFAULT 0
  )`);
  execute(`CREATE TABLE IF NOT EXISTS collections (
    user_id     TEXT NOT NULL,
    nailong_id  TEXT NOT NULL,
    obtained_at TEXT NOT NULL,
    PRIMARY KEY (user_id, nailong_id)
  )`);
  execute(`CREATE TABLE IF NOT EXISTS easter_eggs (
    user_id  TEXT NOT NULL,
    egg_name TEXT NOT NULL,
    date     TEXT NOT NULL,
    PRIMARY KEY (user_id, egg_name, date)
  )`);

  const countRow = queryOne<{ c: number }>("SELECT COUNT(*) as c FROM nailongs");
  if (!countRow || countRow.c === 0) {
    const jsonPath = resolve(resourceDir, "nailong.json");
    const data = JSON.parse(readFileSync(jsonPath, "utf-8")) as NaiLongItem[];
    for (const item of data) {
      execute(
        "INSERT OR IGNORE INTO nailongs (id, name, description, analysis, file, rarity) VALUES (?, ?, ?, ?, ?, ?)",
        [item.id, item.name, item.description, item.analysis, item.file, item.rarity]
      );
    }
  }
}

export function getUser(userId: string): UserRecord {
  const row = queryOne<UserRecord>("SELECT * FROM users WHERE user_id = ?", [userId]);
  return row ?? { user_id: userId, coins: 0, sign_in_date: null, total_draws: 0 };
}

export function upsertUser(
  userId: string,
  updates: Partial<UserRecord>
): void {
  const existing = queryOne<{ user_id: string }>(
    "SELECT user_id FROM users WHERE user_id = ?",
    [userId]
  );
  if (existing) {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (updates.coins !== undefined) { sets.push("coins = ?"); params.push(updates.coins); }
    if (updates.sign_in_date !== undefined) { sets.push("sign_in_date = ?"); params.push(updates.sign_in_date); }
    if (updates.total_draws !== undefined) { sets.push("total_draws = ?"); params.push(updates.total_draws); }
    if (sets.length > 0) {
      params.push(userId);
      execute(`UPDATE users SET ${sets.join(", ")} WHERE user_id = ?`, params);
    }
  } else {
    execute(
      "INSERT INTO users (user_id, coins, sign_in_date, total_draws) VALUES (?, ?, ?, ?)",
      [userId, updates.coins ?? 0, updates.sign_in_date ?? null, updates.total_draws ?? 0]
    );
  }
}

export function getCollections(userId: string): CollectionRecord[] {
  return queryAll<CollectionRecord>(
    "SELECT * FROM collections WHERE user_id = ? ORDER BY obtained_at",
    [userId]
  );
}

export function addCollection(userId: string, nailongId: string): void {
  const today = new Date().toISOString().slice(0, 10);
  execute(
    "INSERT OR IGNORE INTO collections (user_id, nailong_id, obtained_at) VALUES (?, ?, ?)",
    [userId, nailongId, today]
  );
}

export function getAllNaiLongs(): NaiLongItem[] {
  return queryAll<NaiLongItem>("SELECT * FROM nailongs");
}

export function getNaiLongById(id: string): NaiLongItem | undefined {
  return queryOne<NaiLongItem>("SELECT * FROM nailongs WHERE id = ?", [id]);
}

export function isEasterEggCoolingDown(
  userId: string,
  eggName: string,
  date: string
): boolean {
  const row = queryOne<{ _: number }>(
    "SELECT 1 as _ FROM easter_eggs WHERE user_id = ? AND egg_name = ? AND date = ?",
    [userId, eggName, date]
  );
  return row !== undefined;
}

export function triggerEasterEgg(
  userId: string,
  eggName: string,
  date: string
): void {
  execute(
    "INSERT OR IGNORE INTO easter_eggs (user_id, egg_name, date) VALUES (?, ?, ?)",
    [userId, eggName, date]
  );
}
