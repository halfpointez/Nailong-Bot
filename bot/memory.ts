import { upsertMemberProfile, getMembersOfGroup, getRecentMemories } from "./database.ts";
import { stripCQCodes } from "./utils.ts";
import type { Config } from "./config.ts";
import type { OneBotClient } from "./onebot.ts";

interface BufferedMsg {
  name: string;
  text: string;
  userId: string;
}

const POP_IN_COOLDOWN = 5 * 60 * 1000;
const MAX_PER_HOUR = 100;

export class MessageBuffer {
  private groups = new Map<number, BufferedMsg[]>();
  readonly maxSize = 8;

  add(groupId: number, userId: string, rawMessage: string, nickname: string): void {
    const text = stripCQCodes(rawMessage);
    if (!text) return;

    upsertMemberProfile(groupId, userId, nickname || null);

    const list = this.groups.get(groupId) ?? [];
    list.push({ name: nickname || userId, text, userId });
    if (list.length > this.maxSize) list.shift();
    this.groups.set(groupId, list);
  }

  getRecent(groupId: number): { name: string; text: string }[] {
    return (this.groups.get(groupId) ?? []).map(m => ({ name: m.name, text: m.text }));
  }

  count(groupId: number): number {
    return (this.groups.get(groupId) ?? []).length;
  }

  clear(groupId: number): void {
    this.groups.delete(groupId);
  }
}

export class PopInGuard {
  private lastPopIn = new Map<number, number>();
  private hourlyCount = new Map<number, number>();
  private hourlyResetAt = 0;

  canPopIn(groupId: number): boolean {
    const now = Date.now();
    if (now >= this.hourlyResetAt) {
      this.hourlyCount.clear();
      this.hourlyResetAt = now + 60 * 60 * 1000;
    }

    const last = this.lastPopIn.get(groupId) ?? 0;
    if (now - last < POP_IN_COOLDOWN) return false;

    const count = this.hourlyCount.get(groupId) ?? 0;
    if (count >= MAX_PER_HOUR) return false;

    return true;
  }

  recordPopIn(groupId: number): void {
    const now = Date.now();
    this.lastPopIn.set(groupId, now);
    this.hourlyCount.set(groupId, (this.hourlyCount.get(groupId) ?? 0) + 1);
  }
}

export function assembleContext(groupId: number): string {
  const members = getMembersOfGroup(groupId);
  const memories = getRecentMemories(groupId, 3);

  const parts: string[] = [];

  if (members.length > 0) {
    const lines = members.slice(0, 10).map(m =>
      `- ${m.nickname ?? m.user_id}（${m.notes || "你还不太熟"}）`
    );
    parts.push("【你认识的群友】\n" + lines.join("\n"));
  }

  if (memories.length > 0) {
    const lines = memories.map(m => `- ${m.date}: ${m.summary}`);
    parts.push("【最近群聊动态】\n" + lines.join("\n"));
  }

  return parts.join("\n\n");
}

export function startDailySummarizer(_config: Config, _client: OneBotClient): void {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - now.getTime();

    setTimeout(() => {
      console.log("[memory] 每日摘要时间:", new Date().toLocaleString());
      scheduleNext();
    }, ms);
  };

  scheduleNext();
  console.log("[memory] 每日摘要调度器已启动");
}
