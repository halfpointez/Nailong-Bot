import {
  getUser,
  upsertUser,
  getCollections,
  addCollection,
  getAllNaiLongs,
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
