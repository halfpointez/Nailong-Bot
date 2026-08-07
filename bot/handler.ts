import { decodeFromNailong, encodeToNailong, HA } from "../src/nailong.ts";
import type { Config } from "./config.ts";
import type { OneBotClient, GroupMessageEvent, PrivateMessageEvent, MessageSegment } from "./onebot.ts";
import { handleCommand } from "./commands.ts";
import { recordMessage, checkBurst } from "./scheduler.ts";
import { addCoins } from "./nailong-party.ts";
import { isEasterEggCoolingDown, triggerEasterEgg, logConversation } from "./database.ts";
import { chatWithNailong, shouldPopIn } from "./llm.ts";
import { MessageBuffer, PopInGuard, assembleContext, recordForSummary } from "./memory.ts";
import { getTimeContext } from "./greetings.ts";
import { getTimeGreeting } from "./greetings.ts";
import { stripCQCodes } from "./utils.ts";

const ZWC_RE = /[\u200B-\u200D\u2060]/;

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
  const buffer = new MessageBuffer();
  const guard = new PopInGuard();

  return async (event: GroupMessageEvent) => {
    console.log(`[handler] 消息: group=${event.group_id}, user=${event.user_id}, raw="${event.raw_message.slice(0, 30)}"`);
    cache.add(event);

    const uid = String(event.user_id);
    recordMessage(event.group_id, uid);
    await checkBurst(client, event.group_id);

    const atBot = isAtBot(event.message, config.botQQ);
    if (!atBot) {
      await checkEasterEggs(client, config, event);
      if (config.llmEnabled) {
        const nickname = event.sender?.card ?? event.sender?.nickname ?? "";
        buffer.add(event.group_id, String(event.user_id), event.raw_message, nickname);
        recordForSummary(event.group_id, stripCQCodes(event.raw_message));
        if (buffer.count(event.group_id) >= 5) {
          await tryPopIn(client, config, event, buffer, guard);
        }
      }
      return;
    }

    const cleaned = stripCQCodes(event.raw_message);
    console.log(`[handler] @Bot消息, 清洗后="${cleaned}"`);

    const cmdHandled = await handleCommand(client, config, event);
    console.log(`[handler] 命令=${cmdHandled ? '已处理' : '未命中'}`);
    if (cmdHandled) return;

    const nailong = extractNailong(stripCQCodes(event.raw_message));
    if (nailong) {
      console.log("[handler] → 奶龙语命中, 解码");
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

    const normalText = stripCQCodes(event.raw_message).replace(/^\/?翻译\s*/i, "").trim();
    if (normalText && stripCQCodes(event.raw_message).match(/^\/?翻译[\s\u3000]/i)) {
      const encoded = encodeToNailong(normalText);
      await client.sendGroupMessage(event.group_id, [
        { type: "reply", data: { id: String(event.message_id) } },
        { type: "text", data: { text: `奶龙语：${encoded}` } },
      ]);
      return;
    }

    if (config.llmEnabled) {
      console.log("[handler] → LLM聊天");
      try {
        const cleaned = stripCQCodes(event.raw_message);
        const ctx = assembleContext(event.group_id, uid);
        const timeCtx = getTimeContext();
        const fullCtx = timeCtx + "\n\n" + ctx;
        const recent = buffer.getRecent(event.group_id);
        const reply = await chatWithNailong(config, cleaned, {
          groupId: event.group_id,
          recentMessages: recent,
          memberContext: fullCtx,
        });
        await client.sendGroupMessage(event.group_id, [
          { type: "reply", data: { id: String(event.message_id) } },
          { type: "text", data: { text: reply } },
        ]);
        logConversation(event.group_id, String(event.user_id), "user", cleaned);
        logConversation(event.group_id, String(event.user_id), "assistant", reply);
        return;
      } catch (err) {
        console.error("[handler] LLM 调用失败:", err);
      }
      console.log("[handler] → LLM失败, 走notFound");
    } else {
      console.log("[handler] → LLM未启用, 走notFound");
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
    { type: "text", data: { text: `奶龙听到你说：${result}` } },
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

async function tryPopIn(
  client: OneBotClient,
  config: Config,
  event: GroupMessageEvent,
  buffer: MessageBuffer,
  guard: PopInGuard
): Promise<void> {
  if (!guard.canPopIn(event.group_id)) {
    buffer.clear(event.group_id);
    return;
  }

  const recent = buffer.getRecent(event.group_id);
  const context = assembleContext(event.group_id);
  const timeCtx = getTimeContext();
  const fullCtx = timeCtx + "\n\n" + context;

  try {
    const should = await shouldPopIn(config, {
      groupId: event.group_id,
      recentMessages: recent,
      memberContext: fullCtx,
    });

    if (!should) {
      buffer.clear(event.group_id);
      return;
    }

    const lines = recent.map(m => `${m.name}：${m.text}`).join("\n");
    const popPrompt = `刚才大家在聊天：\n${lines}\n\n奶龙你来回应一下~`;

    const reply = await chatWithNailong(config, popPrompt, {
      groupId: event.group_id,
      recentMessages: recent,
      memberContext: fullCtx,
    });

    await client.sendGroupMessage(event.group_id, [
      { type: "text", data: { text: reply } },
    ]);

    guard.recordPopIn(event.group_id);
  } catch (err) {
    console.error("[pop-in] 冒泡失败:", err);
  }

  buffer.clear(event.group_id);
}

async function handleAdminCommand(
  client: OneBotClient,
  event: PrivateMessageEvent,
  cleaned: string
): Promise<boolean> {
  const bubbleMatch = cleaned.match(/^冒泡\s+(\d+)/);
  if (bubbleMatch) {
    const groupId = parseInt(bubbleMatch[1], 10);
    const greeting = getTimeGreeting() ?? "嘿嘿~ 奶龙来了！";
    await client.sendGroupMessage(groupId, [
      { type: "text", data: { text: greeting } },
    ]);
    await client.sendPrivateMessage(event.user_id, [
      { type: "text", data: { text: `✅ 已在群 ${groupId} 冒泡~` } },
    ]);
    return true;
  }

  const sayMatch = cleaned.match(/^说\s+(\d+)\s+(.+)/);
  if (sayMatch) {
    const groupId = parseInt(sayMatch[1], 10);
    const message = sayMatch[2];
    await client.sendGroupMessage(groupId, [
      { type: "text", data: { text: message } },
    ]);
    await client.sendPrivateMessage(event.user_id, [
      { type: "text", data: { text: `✅ 已在群 ${groupId} 发言~` } },
    ]);
    return true;
  }

  return false;
}

export function createPrivateHandler(
  client: OneBotClient,
  config: Config
): (event: PrivateMessageEvent) => Promise<void> {
  return async (event: PrivateMessageEvent) => {
    const userId = event.user_id;
    const cleaned = stripCQCodes(event.raw_message);

    if (config.adminQQ && String(userId) === config.adminQQ) {
      const handled = await handleAdminCommand(client, event, cleaned);
      if (handled) return;
    }

    const cmdHandled = await handleCommand(client, config, event as unknown as GroupMessageEvent);
    if (cmdHandled) return;

    const nailong = extractNailong(cleaned);
    if (nailong) {
      let result: string;
      try { result = decodeFromNailong(nailong); } catch { result = config.replies.decodeFail; }
      await client.sendPrivateMessage(userId, [
        { type: "text", data: { text: `奶龙听到你说：${result}` } },
      ]);
      return;
    }

    const normalText = cleaned.replace(/^\/?翻译\s*/i, "").trim();
    if (normalText && cleaned.match(/^\/?翻译[\s\u3000]/i)) {
      const encoded = encodeToNailong(normalText);
      await client.sendPrivateMessage(userId, [
        { type: "text", data: { text: `奶龙语：${encoded}` } },
      ]);
      return;
    }

    if (config.llmEnabled) {
      try {
        const timeCtx = getTimeContext();
        const reply = await chatWithNailong(config, cleaned, {
          groupId: 0,
          recentMessages: [],
          memberContext: timeCtx,
        });
        await client.sendPrivateMessage(userId, [
          { type: "text", data: { text: reply } },
        ]);
        return;
      } catch (err) {
        console.error("[private] LLM 调用失败:", err);
      }
    }

    await client.sendPrivateMessage(userId, [
      { type: "text", data: { text: "哼~ 奶龙没听懂你要做什么！试试@奶龙 帮助 吧！" } },
    ]);
  };
}
