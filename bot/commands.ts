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
  return raw
    .replace(/\[CQ:[^\]]+\]/g, "")
    .replace(/@\S+\s*/g, "")
    .trim();
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
