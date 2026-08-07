# 每日奶龙 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a nailong collection gacha system to the QQ bot: sign-in coins, draw nailongs by rarity, view collection/dex, hourly chat leaderboard rewards, burst detection, and keyword easter eggs.

**Architecture:** SQLite-backed game state (`better-sqlite3`), in-memory chat counters for hourly/burst logic, command parsing layer before the existing translation handler. New modules: `database.ts`, `nailong-party.ts`, `scheduler.ts`, `commands.ts`. Handler updated to route commands and count messages.

**Tech Stack:** TypeScript with `tsx`, `better-sqlite3` for persistence, `ws` for QQ connection.

## Global Constraints

- `src/nailong.ts` must not be modified
- No external bot frameworks (no icqq, oicq, koishi, yunzai)
- All configurable values come from `.env`
- Runs via `npm run bot` with `tsx`
- Existing translation flow must remain functional
- Command routing happens before translation fallback in handler
- `resource/images/` is gitignored, `resource/nailong.json` is committed
- Database auto-creates on first run from `nailong.json` seed data

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add `better-sqlite3`, `@types/better-sqlite3` |
| `resource/nailong.json` | Create | Nailong index template |
| `resource/images/.gitkeep` | Create | Image dir placeholder |
| `bot/database.ts` | Create | SQLite init, CRUD, query helpers |
| `bot/nailong-party.ts` | Create | Draw logic, coin ops, collection queries |
| `bot/scheduler.ts` | Create | Hourly settlement + burst detection |
| `bot/commands.ts` | Create | Command parsing and routing |
| `bot/config.ts` | Modify | New config keys |
| `bot/handler.ts` | Modify | Integrate commands, easter eggs, chat counting |
| `.env.example` | Modify | New config entries |
| `.gitignore` | Modify | Resource/image and db paths |

---

### Task 1: Install better-sqlite3 and add dependency

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run bot` working with `better-sqlite3` importable

- [ ] **Step 1: Update package.json**

Read current `package.json`, replace with:

```json
{
  "name": "nailong-bot",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "bot": "tsx bot/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.7.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^26.1.2",
    "@types/ws": "^8.18.1",
    "tsx": "^4.19.0",
    "typescript": "~5.6.2"
  }
}
```

- [ ] **Step 2: Install**

```bash
npm install
```

- [ ] **Step 3: Verify type check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add better-sqlite3 dependency"
```

---

### Task 2: Create database module

**Files:**
- Create: `bot/database.ts`

**Interfaces:**
- Produces:
  - `NaiLongItem` type: `{ id: string; name: string; description: string; analysis: string; file: string; rarity: string }`
  - `UserRecord` type: `{ user_id: string; coins: number; sign_in_date: string | null; total_draws: number }`
  - `CollectionRecord` type: `{ user_id: string; nailong_id: string; obtained_at: string }`
  - `getDb()`: returns `Database` instance (singleton)
  - `initDb(resourceDir: string): void` — creates tables, seeds from `nailong.json`
  - `getUser(userId: string): UserRecord`
  - `upsertUser(userId: string, updates: Partial<UserRecord>): void`
  - `getCollections(userId: string): CollectionRecord[]`
  - `addCollection(userId: string, nailongId: string): void`
  - `getAllNaiLongs(): NaiLongItem[]`
  - `isEasterEggCoolingDown(userId: string, eggName: string, date: string): boolean`
  - `triggerEasterEgg(userId: string, eggName: string, date: string): void`

- [ ] **Step 1: Write `bot/database.ts`**

```typescript
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
```

- [ ] **Step 2: Verify type check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bot/database.ts
git commit -m "feat: add SQLite database module"
```

---

### Task 3: Create nailong-party core logic

**Files:**
- Create: `bot/nailong-party.ts`

**Interfaces:**
- Consumes: `getDb`, `getUser`, `upsertUser`, `getCollections`, `addCollection`, `getAllNaiLongs`, `getNaiLongById`, `NaiLongItem`, `UserRecord`, `CollectionRecord` from `./database.ts`
- Produces:
  - `signIn(userId: string): { success: boolean; message: string; addedCoins: number; balance: number }`
  - `drawNaiLong(userId: string): { success: boolean; item?: NaiLongItem; message: string; cost: number; balance: number; isNew: boolean }`
  - `getMyCollections(userId: string): { items: { name: string; rarity: string; isOwned: boolean }[]; owned: number; total: number }`
  - `getFullDex(userId: string): { items: { name: string; rarity: string; isOwned: boolean }[]; total: number }`
  - `getRandomNaiLong(): NaiLongItem`
  - `getBalance(userId: string): { coins: number; signInDays: number; totalDraws: number }`
  - `addCoins(userId: string, amount: number): number`
  - `RARITY_WEIGHTS: Record<string, number>` (common: 60, rare: 25, epic: 12, legendary: 3)

- [ ] **Step 1: Write `bot/nailong-party.ts`**

```typescript
import {
  getDb,
  getUser,
  upsertUser,
  getCollections,
  addCollection,
  getAllNaiLongs,
  getNaiLongById,
} from "./database.ts";
import type { NaiLongItem } from "./database.ts";

export const RARITY_WEIGHTS: Record<string, number> = {
  common: 60,
  rare: 25,
  epic: 12,
  legendary: 3,
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function signIn(userId: string): {
  success: boolean;
  message: string;
  addedCoins: number;
  balance: number;
} {
  const td = today();
  const user = getUser(userId);
  if (user.sign_in_date === td) {
    return {
      success: false,
      message: "你今天已经签到过了~",
      addedCoins: 0,
      balance: user.coins,
    };
  }
  const newCoins = user.coins + 10;
  upsertUser(userId, { coins: newCoins, sign_in_date: td });
  return {
    success: true,
    message: `✅ 签到成功！+10奶龙币 | 余额：${newCoins}币`,
    addedCoins: 10,
    balance: newCoins,
  };
}

export function drawNaiLong(userId: string): {
  success: boolean;
  item?: NaiLongItem;
  message: string;
  cost: number;
  balance: number;
  isNew: boolean;
} {
  const user = getUser(userId);
  if (user.coins < 10) {
    return { success: false, message: "奶龙币不足！需要 10币，当前：" + user.coins + "币", cost: 0, balance: user.coins, isNew: false };
  }

  const all = getAllNaiLongs();
  if (all.length === 0) {
    return { success: false, message: "图鉴还没有奶龙，请联系管理员添加！", cost: 0, balance: user.coins, isNew: false };
  }

  const owned = getCollections(userId);
  const ownedIds = new Set(owned.map(r => r.nailong_id));
  const candidates = all.filter(item => !ownedIds.has(item.id));

  if (candidates.length === 0) {
    return {
      success: false,
      message: `你已经抓到全部的奶龙了！（${all.length}/${all.length}）`,
      cost: 0,
      balance: user.coins,
      isNew: false,
    };
  }

  const item = weightedRandom(candidates);
  const isNew = !ownedIds.has(item.id);
  if (isNew) {
    addCollection(userId, item.id);
  }

  const newCoins = user.coins - 10;
  const newDraws = user.total_draws + 1;
  upsertUser(userId, { coins: newCoins, total_draws: newDraws });

  const stars = "⭐".repeat(rarityStars(item.rarity));
  const dupeLabel = isNew ? "" : "（已拥有）";
  const msg = `我是【${item.name}】${dupeLabel}\n${item.description}\n${item.analysis}\n（${stars} 消耗 10 币 | 余额 ${newCoins} 币）`;

  return { success: true, item, message: msg, cost: 10, balance: newCoins, isNew };
}

export function getMyCollections(userId: string): {
  items: { name: string; rarity: string }[];
  owned: number;
  total: number;
} {
  const all = getAllNaiLongs();
  const owned = getCollections(userId);
  const ownedIds = new Set(owned.map(r => r.nailong_id));
  const items = all
    .filter(item => ownedIds.has(item.id))
    .map(item => ({ name: item.name, rarity: item.rarity }));
  return { items, owned: items.length, total: all.length };
}

export function getFullDex(userId: string): {
  items: { name: string; rarity: string; isOwned: boolean }[];
  total: number;
} {
  const all = getAllNaiLongs();
  const owned = getCollections(userId);
  const ownedIds = new Set(owned.map(r => r.nailong_id));
  const items = all.map(item => ({
    name: item.name,
    rarity: item.rarity,
    isOwned: ownedIds.has(item.id),
  }));
  return { items, total: all.length };
}

export function getRandomNaiLong(): NaiLongItem | undefined {
  const all = getAllNaiLongs();
  if (all.length === 0) return undefined;
  return all[Math.floor(Math.random() * all.length)];
}

export function getBalance(userId: string): {
  coins: number;
  signInDays: number;
  totalDraws: number;
} {
  const user = getUser(userId);
  const ownedCount = getCollections(userId).length;
  return { coins: user.coins, signInDays: ownedCount, totalDraws: user.total_draws };
}

export function addCoins(userId: string, amount: number): number {
  const user = getUser(userId);
  const newCoins = user.coins + amount;
  upsertUser(userId, { coins: newCoins });
  return newCoins;
}

function rarityStars(rarity: string): number {
  switch (rarity) {
    case "legendary": return 4;
    case "epic": return 3;
    case "rare": return 2;
    default: return 1;
  }
}

function weightedRandom(items: NaiLongItem[]): NaiLongItem {
  const weighted: NaiLongItem[] = [];
  for (const item of items) {
    const w = RARITY_WEIGHTS[item.rarity] ?? 60;
    for (let i = 0; i < w; i++) weighted.push(item);
  }
  return weighted[Math.floor(Math.random() * weighted.length)];
}

export function imageFilePath(item: NaiLongItem, resourceDir: string): string {
  return resourceDir + "/images/" + item.file;
}
```

- [ ] **Step 2: Verify type check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bot/nailong-party.ts
git commit -m "feat: add nailong gacha core logic"
```

---

### Task 4: Create scheduler module

**Files:**
- Create: `bot/scheduler.ts`

**Interfaces:**
- Consumes: `addCoins` from `./nailong-party.ts`, `OneBotClient.sendGroupMessage` from `./onebot.ts`
- Produces:
  - `startScheduler(client: OneBotClient, config: Config): void` — starts hourly interval
  - `recordMessage(groupId: number, userId: string): void` — called per incoming group message
  - `ChatSettlement` type for hourly results

- [ ] **Step 1: Write `bot/scheduler.ts`**

```typescript
import { addCoins } from "./nailong-party.ts";
import type { Config } from "./config.ts";
import type { OneBotClient, MessageSegment } from "./onebot.ts";

interface HourlyChatStats {
  counts: Map<string, number>;
  timestamp: number;
}

interface BurstState {
  count: number;
  speakers: Set<string>;
  startTime: number;
  cooldownUntil: number;
}

const hourlyStats = new Map<number, HourlyChatStats>();
const burstStates = new Map<number, BurstState>();

const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_THRESHOLD = 50;
const BURST_COOLDOWN_MS = 30 * 60 * 1000;

export function recordMessage(groupId: number, userId: string): void {
  const now = Date.now();

  let stats = hourlyStats.get(groupId);
  if (!stats) {
    stats = { counts: new Map(), timestamp: now };
    hourlyStats.set(groupId, stats);
  }
  stats.counts.set(userId, (stats.counts.get(userId) ?? 0) + 1);

  let burst = burstStates.get(groupId);
  if (!burst) {
    burst = { count: 0, speakers: new Set(), startTime: now, cooldownUntil: 0 };
    burstStates.set(groupId, burst);
  }

  if (now - burst.startTime > BURST_WINDOW_MS) {
    burst.count = 0;
    burst.speakers = new Set();
    burst.startTime = now;
  }

  burst.count++;
  burst.speakers.add(userId);
}

export async function checkBurst(
  client: OneBotClient,
  config: Config,
  groupId: number
): Promise<void> {
  const burst = burstStates.get(groupId);
  if (!burst) return;

  const now = Date.now();
  if (now < burst.cooldownUntil) return;
  if (burst.count < BURST_THRESHOLD) return;
  if (now - burst.startTime > BURST_WINDOW_MS) return;

  burst.cooldownUntil = now + BURST_COOLDOWN_MS;

  const segments: MessageSegment[] = [
    { type: "text", data: { text: "你们都是奶龙！+1奶龙币" } },
  ];
  for (const uid of burst.speakers) {
    addCoins(uid, 1);
    segments.push({ type: "at", data: { qq: uid } });
  }

  try {
    await client.sendGroupMessage(groupId, segments);
  } catch (e) {
    console.error("[scheduler] 爆发消息发送失败:", e);
  }

  burst.count = 0;
  burst.speakers = new Set();
  burst.startTime = now;
}

async function settleHourly(
  client: OneBotClient,
  config: Config
): Promise<void> {
  for (const [groupId, stats] of hourlyStats) {
    const speakers = Array.from(stats.counts.entries()).sort((a, b) => b[1] - a[1]);
    hourlyStats.delete(groupId);

    if (speakers.length === 0) {
      try {
        await client.sendGroupMessage(groupId, [
          { type: "text", data: { text: "哼！都不说话 奶龙好无聊" } },
        ]);
      } catch (e) {
        console.error("[scheduler] 空闲消息发送失败:", e);
      }
      continue;
    }

    const [topUserId] = speakers[0];
    addCoins(topUserId, 1);
    try {
      await client.sendGroupMessage(groupId, [
        { type: "text", data: { text: "嘿嘿，你是奶龙！" } },
        { type: "at", data: { qq: topUserId } },
        { type: "text", data: { text: " +1奶龙币" } },
      ]);
    } catch (e) {
      console.error("[scheduler] 结算消息发送失败:", e);
    }
  }
}

export function startScheduler(client: OneBotClient, config: Config): void {
  const now = new Date();
  const msToNextHour = (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();

  setTimeout(() => {
    settleHourly(client, config);
    setInterval(() => settleHourly(client, config), 60 * 60 * 1000);
  }, msToNextHour);

  console.log("[scheduler] 每小时结算器已启动，下次结算:", new Date(Date.now() + msToNextHour).toLocaleTimeString());
}
```

- [ ] **Step 2: Verify type check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bot/scheduler.ts
git commit -m "feat: add hourly scheduler and burst detection"
```

---

### Task 5: Create commands module

**Files:**
- Create: `bot/commands.ts`

**Interfaces:**
- Consumes: `signIn`, `drawNaiLong`, `getMyCollections`, `getFullDex`, `getRandomNaiLong`, `getBalance`, `imageFilePath` from `./nailong-party.ts`, `GroupMessageEvent`, `MessageSegment`, `OneBotClient` from `./onebot.ts`, `Config` from `./config.ts`
- Produces:
  - `parseCommand(text: string): string | null` — returns command name or null
  - `handleCommand(client: OneBotClient, config: Config, event: GroupMessageEvent): Promise<boolean>` — returns true if command was handled

- [ ] **Step 1: Write `bot/commands.ts`**

```typescript
import {
  signIn,
  drawNaiLong,
  getMyCollections,
  getFullDex,
  getRandomNaiLong,
  getBalance,
  imageFilePath,
} from "./nailong-party.ts";
import type { Config } from "./config.ts";
import type { OneBotClient, GroupMessageEvent, MessageSegment } from "./onebot.ts";
import { existsSync } from "node:fs";

function stripCQCodes(raw: string): string {
  return raw.replace(/\[CQ:[^\]]+\]/g, "").trim();
}

const COMMAND_ALIASES: Record<string, string[]> = {
  签到: ["签到", "/签到"],
  抽奶龙: ["抽奶龙", "/抽奶龙", "每日奶龙", "/每日奶龙"],
  我的奶龙: ["我的奶龙", "/我的奶龙"],
  奶龙图鉴: ["奶龙图鉴", "/奶龙图鉴"],
  随机奶龙: ["随机奶龙", "/随机奶龙", "奶龙"],
  奶龙币: ["奶龙币", "/奶龙币"],
};

export function parseCommand(rawMessage: string): string | null {
  const text = stripCQCodes(rawMessage);
  for (const [cmd, aliases] of Object.entries(COMMAND_ALIASES)) {
    for (const alias of aliases) {
      if (text === alias) return cmd;
    }
  }
  return null;
}

export async function handleCommand(
  client: OneBotClient,
  config: Config,
  event: GroupMessageEvent
): Promise<boolean> {
  const cmd = parseCommand(event.raw_message);
  if (!cmd) return false;

  const userId = String(event.user_id);
  const groupId = event.group_id;
  const reply = { type: "reply", data: { id: String(event.message_id) } } as MessageSegment;

  switch (cmd) {
    case "签到": {
      const result = signIn(userId);
      await client.sendGroupMessage(groupId, [reply, { type: "text", data: { text: result.message } }]);
      return true;
    }
    case "抽奶龙": {
      const result = drawNaiLong(userId);
      if (!result.success || !result.item) {
        await client.sendGroupMessage(groupId, [reply, { type: "text", data: { text: result.message } }]);
        return true;
      }
      const imgPath = imageFilePath(result.item, config.nailongResourceDir);
      const segments: MessageSegment[] = [reply];
      if (existsSync(imgPath)) {
        segments.push({ type: "image", data: { file: "file:///" + imgPath.replace(/\\/g, "/") } });
      }
      segments.push({ type: "text", data: { text: result.message } });
      await client.sendGroupMessage(groupId, segments);
      return true;
    }
    case "我的奶龙": {
      const col = getMyCollections(userId);
      const lines = col.items.map(
        i => `${"⭐".repeat(rarityStars(i.rarity))} ${i.name}`
      );
      const text = `你的奶龙图鉴 (${col.owned}/${col.total})：\n${lines.join("\n")}`;
      await client.sendGroupMessage(groupId, [reply, { type: "text", data: { text } }]);
      return true;
    }
    case "奶龙图鉴": {
      const dex = getFullDex(userId);
      const lines = dex.items.map(
        i => `${"⭐".repeat(rarityStars(i.rarity))} ${i.name} ${i.isOwned ? "✅" : "❌"}`
      );
      const text = `奶龙图鉴 (${dex.total})：\n${lines.join("\n")}`;
      await client.sendGroupMessage(groupId, [reply, { type: "text", data: { text } }]);
      return true;
    }
    case "随机奶龙": {
      const item = getRandomNaiLong();
      if (!item) {
        await client.sendGroupMessage(groupId, [reply, { type: "text", data: { text: "图鉴还没有奶龙！" } }]);
        return true;
      }
      const imgPath = imageFilePath(item, config.nailongResourceDir);
      const segments: MessageSegment[] = [reply];
      if (existsSync(imgPath)) {
        segments.push({ type: "image", data: { file: "file:///" + imgPath.replace(/\\/g, "/") } });
      }
      const stars = "⭐".repeat(rarityStars(item.rarity));
      segments.push({
        type: "text",
        data: { text: `我是【${item.name}】\n${item.description}\n这是今天的随机奶龙~\n（${stars}）` },
      });
      await client.sendGroupMessage(groupId, segments);
      return true;
    }
    case "奶龙币": {
      const bal = getBalance(userId);
      const text = `💰 奶龙币：${bal.coins} | 已收集 ${bal.signInDays} 只 | 已抽卡 ${bal.totalDraws} 次`;
      await client.sendGroupMessage(groupId, [reply, { type: "text", data: { text } }]);
      return true;
    }
  }
  return false;
}

function rarityStars(rarity: string): number {
  switch (rarity) {
    case "legendary": return 4;
    case "epic": return 3;
    case "rare": return 2;
    default: return 1;
  }
}
```

- [ ] **Step 2: Verify type check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bot/commands.ts
git commit -m "feat: add command parsing and routing"
```

---

### Task 6: Update config module

**Files:**
- Modify: `bot/config.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: Updated `Config` interface with `nailongResourceDir` field

- [ ] **Step 1: Update `bot/config.ts`**

Read current file, then replace entirely with:

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ReplyMessages {
  readonly decodeFail: string;
  readonly notFound: string;
  readonly timeout: string;
}

export interface EasterEgg {
  readonly keyword: string;
  readonly reply: string;
  readonly coins: number;
}

export interface Config {
  readonly wsUrl: string;
  readonly httpUrl: string;
  readonly botQQ: string;
  readonly replies: ReplyMessages;
  readonly nailongResourceDir: string;
  readonly easterEggs: EasterEgg[];
}

function parseEnvFile(path: string): Record<string, string> {
  const content = readFileSync(path, "utf-8");
  const map: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    map[key] = value;
  }
  return map;
}

export function loadConfig(): Config {
  const envPath = resolve(process.cwd(), ".env");
  let env: Record<string, string> = {};
  try {
    env = parseEnvFile(envPath);
  } catch {
    console.error("找不到 .env 文件，请从 .env.example 复制并填写配置");
    process.exit(1);
  }

  const wsUrl = env["NAPCT_WS_URL"] ?? process.env["NAPCT_WS_URL"];
  const httpUrl = env["NAPCT_HTTP_URL"] ?? process.env["NAPCT_HTTP_URL"];
  const botQQ = env["BOT_QQ"] ?? process.env["BOT_QQ"];

  if (!wsUrl) { console.error("缺少 NAPCT_WS_URL 配置"); process.exit(1); }
  if (!httpUrl) { console.error("缺少 NAPCT_HTTP_URL 配置"); process.exit(1); }
  if (!botQQ) { console.error("缺少 BOT_QQ 配置"); process.exit(1); }

  return {
    wsUrl,
    httpUrl,
    botQQ,
    replies: {
      decodeFail: env["REPLY_DECODE_FAIL"] ?? process.env["REPLY_DECODE_FAIL"] ?? "翻译失败，奶龙语的语法有误哦",
      notFound: env["REPLY_NOT_FOUND"] ?? process.env["REPLY_NOT_FOUND"] ?? "没有检测到奶龙语，请 @我 + 奶龙语 或引用一条奶龙语消息",
      timeout: env["REPLY_TIMEOUT"] ?? process.env["REPLY_TIMEOUT"] ?? "Bot 暂时无法响应，请稍后再试",
    },
    nailongResourceDir: env["NAILONG_RESOURCE_DIR"] ?? process.env["NAILONG_RESOURCE_DIR"] ?? resolve(process.cwd(), "resource"),
    easterEggs: parseEasterEggs(env),
  };
}

function parseEasterEggs(env: Record<string, string>): EasterEgg[] {
  const raw = env["EASTER_EGGS"] ?? process.env["EASTER_EGGS"];
  if (!raw) {
    return [
      { keyword: "我是奶龙", reply: "我才是奶龙！+2奶龙币", coins: 2 },
      { keyword: "奶龙奶龙", reply: "叫我干嘛！+2奶龙币", coins: 2 },
      { keyword: "我喜欢奶龙", reply: "我也喜欢你！+2奶龙币", coins: 2 },
    ];
  }
  const eggs: EasterEgg[] = [];
  for (const part of raw.split(";")) {
    const m = part.match(/^(.+?)→(.+?)→(\d+)$/);
    if (m) {
      eggs.push({ keyword: m[1], reply: m[2], coins: parseInt(m[3], 10) });
    }
  }
  return eggs.length > 0 ? eggs : [
    { keyword: "我是奶龙", reply: "我才是奶龙！+2奶龙币", coins: 2 },
    { keyword: "奶龙奶龙", reply: "叫我干嘛！+2奶龙币", coins: 2 },
    { keyword: "我喜欢奶龙", reply: "我也喜欢你！+2奶龙币", coins: 2 },
  ];
}
```

- [ ] **Step 2: Update `.env.example`**

Replace with:

```env
# NapCat WebSocket 地址 (事件接收)
NAPCT_WS_URL=ws://127.0.0.1:3001

# NapCat HTTP API 地址 (发送消息)
NAPCT_HTTP_URL=http://127.0.0.1:3000

# Bot 自己的 QQ 号
BOT_QQ=

# 回复文案
REPLY_DECODE_FAIL=奶龙听不懂哦
REPLY_NOT_FOUND=哼! 没有人在说奶龙语!
REPLY_TIMEOUT=哎呀, 奶龙在睡觉呢, 等下再叫我

# 奶龙资源目录（默认 project/resource）
NAILONG_RESOURCE_DIR=resource

# 彩蛋配置（格式：关键词→回复→币数;关键词→回复→币数）
# 不配置则使用默认彩蛋
# EASTER_EGGS=我是奶龙→我才是奶龙！+2奶龙币→2;奶龙奶龙→叫我干嘛！+2奶龙币→2;我喜欢奶龙→我也喜欢你！+2奶龙币→2
```

- [ ] **Step 3: Verify type check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add bot/config.ts .env.example
git commit -m "feat: add nailong-party config keys and easter eggs"
```

---

### Task 7: Update handler — integrate commands, easter eggs, chat counting

**Files:**
- Modify: `bot/handler.ts`

**Interfaces:**
- Consumes: `handleCommand` from `./commands.ts`, `recordMessage`, `checkBurst` from `./scheduler.ts`, `addCoins` from `./nailong-party.ts`, `isEasterEggCoolingDown`, `triggerEasterEgg` from `./database.ts`, all existing types
- Produces: updated `createHandler` with command routing and easter egg support

- [ ] **Step 1: Update `bot/handler.ts`**

Read the current file, then replace entirely with:

```typescript
import { decodeFromNailong, HA } from "../src/nailong.ts";
import type { Config } from "./config.ts";
import type { OneBotClient, GroupMessageEvent, MessageSegment } from "./onebot.ts";
import { handleCommand } from "./commands.ts";
import { recordMessage, checkBurst } from "./scheduler.ts";
import { addCoins } from "./nailong-party.ts";
import { isEasterEggCoolingDown, triggerEasterEgg } from "./database.ts";

const ZWC_RE = /[\u200B-\u200D\u2060]/;

function stripCQCodes(rawMessage: string): string {
  return rawMessage.replace(/\[CQ:[^\]]+\]/g, "").trim();
}

function isNailong(text: string): boolean {
  return text.includes(HA) && ZWC_RE.test(text);
}

function extractNailong(rawMessage: string): string | null {
  if (isNailong(rawMessage)) return rawMessage;
  return null;
}

function findReplySegment(message: MessageSegment[]): { id: string } | null {
  for (const seg of message) {
    if (seg.type === "reply") return seg.data as { id: string };
  }
  return null;
}

function isAtBot(message: MessageSegment[], botQQ: string): boolean {
  for (const seg of message) {
    if (seg.type === "at" && seg.data.qq === botQQ) return true;
  }
  return false;
}

export class MessageCache {
  private groups = new Map<number, GroupMessageEvent[]>();
  private maxSize = 10;

  add(event: GroupMessageEvent): void {
    const list = this.groups.get(event.group_id) ?? [];
    list.push(event);
    if (list.length > this.maxSize) list.shift();
    this.groups.set(event.group_id, list);
  }

  getPrevious(groupId: number): GroupMessageEvent | undefined {
    const list = this.groups.get(groupId);
    if (!list || list.length < 2) return undefined;
    return list[list.length - 2];
  }
}

export function createHandler(
  client: OneBotClient,
  config: Config
): (event: GroupMessageEvent) => Promise<void> {
  const cache = new MessageCache();

  return async (event: GroupMessageEvent) => {
    cache.add(event);

    // Chat counting for hourly + burst
    const uid = String(event.user_id);
    recordMessage(event.group_id, uid);
    await checkBurst(client, config, event.group_id);

    // Easter eggs (non-@ messages)
    if (!isAtBot(event.message, config.botQQ)) {
      await checkEasterEggs(client, config, event);
      return;
    }

    // Command routing
    const cmdHandled = await handleCommand(client, config, event);
    if (cmdHandled) return;

    // Existing translation flow
    const nailong = extractNailong(stripCQCodes(event.raw_message));
    if (nailong) {
      await replyWithTranslation(client, event.group_id, event.message_id, nailong, config.replies.decodeFail);
      return;
    }

    const replySeg = findReplySegment(event.message);
    if (replySeg) {
      try {
        const replied = await client.getMessage(Number(replySeg.id));
        const rn = extractNailong(stripCQCodes(replied.raw_message));
        if (rn) {
          await replyWithTranslation(client, event.group_id, Number(replySeg.id), rn, config.replies.decodeFail);
          return;
        }
      } catch {
        await replyText(client, event, config.replies.timeout);
        return;
      }
    }

    const prev = cache.getPrevious(event.group_id);
    if (prev) {
      const pn = extractNailong(stripCQCodes(prev.raw_message));
      if (pn) {
        await replyWithTranslation(client, event.group_id, prev.message_id, pn, config.replies.decodeFail);
        return;
      }
    }

    await replyText(client, event, config.replies.notFound);
  };
}

async function checkEasterEggs(
  client: OneBotClient,
  config: Config,
  event: GroupMessageEvent
): Promise<void> {
  const raw = event.raw_message;
  const date = new Date().toISOString().slice(0, 10);
  const userId = String(event.user_id);

  for (const egg of config.easterEggs) {
    if (!raw.includes(egg.keyword)) continue;
    if (isEasterEggCoolingDown(userId, egg.keyword, date)) continue;

    triggerEasterEgg(userId, egg.keyword, date);
    addCoins(userId, egg.coins);
    await client.sendGroupMessage(event.group_id, [
      { type: "reply", data: { id: String(event.message_id) } },
      { type: "text", data: { text: egg.reply } },
    ]);
    return;
  }
}

async function replyWithTranslation(
  client: OneBotClient,
  groupId: number,
  replyToId: number,
  nailongRaw: string,
  decodeFailText: string
): Promise<void> {
  let result: string;
  try {
    result = decodeFromNailong(nailongRaw);
  } catch {
    result = decodeFailText;
  }
  await client.sendGroupMessage(groupId, [
    { type: "reply", data: { id: String(replyToId) } },
    { type: "text", data: { text: `翻译结果：${result}` } },
  ]);
}

async function replyText(
  client: OneBotClient,
  event: GroupMessageEvent,
  text: string
): Promise<void> {
  await client.sendGroupMessage(event.group_id, [
    { type: "reply", data: { id: String(event.message_id) } },
    { type: "text", data: { text } },
  ]);
}
```

- [ ] **Step 2: Verify type check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bot/handler.ts
git commit -m "feat: integrate commands, easter eggs, and chat counting into handler"
```

---

### Task 8: Update bot entry point to init DB and scheduler

**Files:**
- Modify: `bot/index.ts`

- [ ] **Step 1: Update `bot/index.ts`**

Replace with:

```typescript
import { loadConfig } from "./config.ts";
import { OneBotClient } from "./onebot.ts";
import { createHandler } from "./handler.ts";
import { initDb } from "./database.ts";
import { startScheduler } from "./scheduler.ts";

const config = loadConfig();
initDb(config.nailongResourceDir);

const client = new OneBotClient(config);
client.onGroupMessage(createHandler(client, config));

client
  .connect()
  .then(() => {
    console.log(`[bot] NLtranslator Bot 已启动 (QQ: ${config.botQQ})`);
    startScheduler(client, config);
  })
  .catch((err) => {
    console.error("[bot] 启动失败:", err.message);
    process.exit(1);
  });
```

- [ ] **Step 2: Commit**

```bash
git add bot/index.ts
git commit -m "feat: init database and scheduler on bot startup"
```

---

### Task 9: Create resource template files

**Files:**
- Create: `resource/nailong.json`
- Create: `resource/images/.gitkeep`

- [ ] **Step 1: Create `resource/nailong.json`**

```json
[
  {
    "id": "happy-nailong",
    "name": "快乐奶龙",
    "description": "喜欢的食物是空气",
    "analysis": "你今天自带好心情光环，遇到什么事情都可以笑着面对。",
    "file": "happy-nailong.png",
    "rarity": "common"
  }
]
```

- [ ] **Step 2: Create `resource/images/.gitkeep`** (empty file)

- [ ] **Step 3: Update `.gitignore`**

Add these lines after `# 环境变量` section:

```
# 奶龙资源
resource/images/*
!resource/images/.gitkeep
resource/*.db
```

- [ ] **Step 4: Commit**

```bash
git add resource/nailong.json resource/images/.gitkeep .gitignore
git commit -m "feat: add resource template and update gitignore"
```

---

### Task 10: Integration verification

**Files:**
- No code changes — verification only

- [ ] **Step 1: Run type check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 2: Verify bot starts**

```bash
npx tsx bot/index.ts
```

Expected: error about missing `.env` (meaning code parses without syntax errors).

- [ ] **Step 3: Create `.env` with `BOT_QQ` filled in, start NapCat, run bot**

- [ ] **Step 4: Test commands in a group**

Test each command: `/签到`, `/抽奶龙`, `/我的奶龙`, `/奶龙图鉴`, `/随机奶龙`, `/奶龙币`.
Test easter egg: send `我是奶龙` in group without @Bot.
Test translation still works: @Bot + 奶龙语 text.

- [ ] **Step 5: Commit any final tweaks**
