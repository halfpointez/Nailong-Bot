import { addCoins } from "./nailong-party.ts";
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

async function settleHourly(client: OneBotClient): Promise<void> {
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

export function startScheduler(client: OneBotClient): void {
  const now = new Date();
  const msToNextHour = (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();

  setTimeout(() => {
    settleHourly(client);
    setInterval(() => settleHourly(client), 60 * 60 * 1000);
  }, msToNextHour);

  console.log("[scheduler] 每小时结算器已启动，下次结算:", new Date(Date.now() + msToNextHour).toLocaleTimeString());
}
