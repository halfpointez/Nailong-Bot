import { addCoins } from "./nailong-party.ts";
import type { OneBotClient, MessageSegment } from "./onebot.ts";
import type { Config } from "./config.ts";

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
const groupLastMessage = new Map<number, number>();
const groupLastIdle = new Map<number, number>();
const groupGreetings = new Map<string, string>();

const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_THRESHOLD = 50;
const BURST_COOLDOWN_MS = 30 * 60 * 1000;
const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const IDLE_COOLDOWN_MS = 60 * 60 * 1000;
const LIFECYCLE_INTERVAL_MS = 10 * 60 * 1000;

function greetingKey(groupId: number, window: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${groupId}:${window}:${today}`;
}

function getTimeGreeting(): string | null {
  const h = new Date().getHours();
  if (h >= 7 && h <= 10) return "morning";
  if (h >= 11 && h <= 13) return "noon";
  if (h >= 22 || h <= 1) return "night";
  return null;
}

const GREETINGS: Record<string, string[]> = {
  morning: [
    "早安安！太阳公公都起来了！奶龙也起来了！嘿嘿~",
    "呼……奶龙刚睡醒……今天有什么好吃吃吗？",
    "早上好呀！奶龙今天比昨天更厉害了一点点！",
  ],
  noon: [
    "中午啦！该吃饭饭了！奶龙肚肚已经在叫了！",
    "你们中午吃啥？奶龙什么都想吃！除了苦瓜！",
    "呼……好饱饱……奶龙想睡觉觉了……zzzz……",
  ],
  night: [
    "呼噜呼噜……奶龙好困困……大家晚安晚安！",
    "晚上啦！该睡觉觉了！奶龙先睡啦~明天见！",
    "今天玩得好开心！晚安！明天继续和奶龙玩哦~",
  ],
};

const IDLE_MESSAGES = [
  "有人吗……奶龙好无聊哦……",
  "怎么都不说话？都变成暴暴龙了吗？",
  "呼……好安静……奶龙要睡着了……zzzz",
  "奶龙数星星……一颗奶龙……两颗奶龙……三颗奶龙……",
];

export function recordMessage(groupId: number, userId: string): void {
  const now = Date.now();
  groupLastMessage.set(groupId, now);

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

async function tickLifecycle(client: OneBotClient, config: Config): Promise<void> {
  if (!config.llmEnabled) return;

  const now = Date.now();

  for (const [groupId, lastMsg] of groupLastMessage) {
    const idle = now - lastMsg;

    const greeting = getTimeGreeting();
    if (greeting) {
      const key = greetingKey(groupId, greeting);
      if (!groupGreetings.has(key)) {
        groupGreetings.set(key, greeting);
        const messages = GREETINGS[greeting];
        if (messages) {
          const msg = messages[Math.floor(Math.random() * messages.length)];
          try {
            await client.sendGroupMessage(groupId, [{ type: "text", data: { text: msg } }]);
            groupLastIdle.set(groupId, now);
          } catch (e) {
            console.error("[lifecycle] 定时问候发送失败:", e);
          }
        }
      }
      continue;
    }

    if (idle > IDLE_THRESHOLD_MS) {
      const lastIdle = groupLastIdle.get(groupId) ?? 0;
      if (now - lastIdle > IDLE_COOLDOWN_MS && Math.random() < 0.33) {
        const msg = IDLE_MESSAGES[Math.floor(Math.random() * IDLE_MESSAGES.length)];
        try {
          await client.sendGroupMessage(groupId, [{ type: "text", data: { text: msg } }]);
          groupLastIdle.set(groupId, now);
        } catch (e) {
          console.error("[lifecycle] 空闲消息发送失败:", e);
        }
      }
    }
  }
}

export function startLifecycle(client: OneBotClient, config: Config): void {
  setInterval(() => {
    tickLifecycle(client, config);
  }, LIFECYCLE_INTERVAL_MS);

  console.log("[lifecycle] 生命周期定时器已启动（每10分钟检测）");
}
