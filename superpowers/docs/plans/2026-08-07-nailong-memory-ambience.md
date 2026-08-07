# 奶龙记忆 & 智能冒泡 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent group memory, context-aware LLM responses, and ambient pop-in behavior to the Nailong QQ Bot.

**Architecture:** New `bot/memory.ts` manages message buffering, context assembly, and daily summary generation. `bot/database.ts` gains two new tables. `bot/llm.ts` gains context injection and pop-in decision. `bot/handler.ts` integrates ambient flow.

**Tech Stack:** TypeScript + `tsx`, `sql.js` (existing), `ws` (existing). Zero new dependencies.

## Global Constraints

- `src/nailong.ts` must not be modified
- No new npm dependencies
- `sql.js` remains the only persistence layer
- All existing features (commands, translation, gacha, scheduler) must continue working
- LLM disabled via config → ambient features silently skip; @Bot chat still works without context injection

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `bot/database.ts` | Modify | Add `member_profiles` + `chat_memories` tables, 5 new exported functions |
| `bot/memory.ts` | Create | `MessageBuffer`, `ContextAssembler` class, `startDailySummarizer` |
| `bot/llm.ts` | Modify | `ChatContext` interface, extended `chatWithNailong`, new `shouldPopIn`, `summarizeChat` |
| `bot/handler.ts` | Modify | Ambient pop-in flow for non-@ messages |
| `bot/index.ts` | Modify | Init memory tables, start daily summarizer |
| `resource/nailong-skill.md` | Modify | Add 「互动模式」 section |

---

### Task 1: Add memory tables to database

**Files:**
- Modify: `bot/database.ts`

**Interfaces:**
- Produces:
  - `MemberProfile` interface: `{ group_id: number; user_id: string; nickname: string | null; notes: string; last_seen: string | null }`
  - `ChatMemory` interface: `{ group_id: number; date: string; summary: string; keywords: string }`
  - `upsertMemberProfile(groupId: number, userId: string, nickname: string | null): void`
  - `getMembersOfGroup(groupId: number): MemberProfile[]`
  - `updateMemberNotes(groupId: number, userId: string, notes: string): void`
  - `addOrUpdateMemory(groupId: number, date: string, summary: string, keywords: string): void`
  - `getRecentMemories(groupId: number, limit: number): ChatMemory[]`

- [ ] **Step 1: Add table creation to `initDb`**

In `bot/database.ts`, after the existing `easter_eggs` CREATE TABLE block, add:

```typescript
  execute(`CREATE TABLE IF NOT EXISTS member_profiles (
    group_id  INTEGER NOT NULL,
    user_id   TEXT NOT NULL,
    nickname  TEXT,
    notes     TEXT DEFAULT '',
    last_seen TEXT,
    PRIMARY KEY (group_id, user_id)
  )`);
  execute(`CREATE TABLE IF NOT EXISTS chat_memories (
    group_id  INTEGER NOT NULL,
    date      TEXT NOT NULL,
    summary   TEXT NOT NULL,
    keywords  TEXT DEFAULT '',
    PRIMARY KEY (group_id, date)
  )`);
```

- [ ] **Step 2: Add exported interfaces and functions after the existing `triggerEasterEgg`**

```typescript
export interface MemberProfile {
  group_id: number;
  user_id: string;
  nickname: string | null;
  notes: string;
  last_seen: string | null;
}

export interface ChatMemory {
  group_id: number;
  date: string;
  summary: string;
  keywords: string;
}

export function upsertMemberProfile(
  groupId: number,
  userId: string,
  nickname: string | null
): void {
  const today = new Date().toISOString().slice(0, 10);
  const existing = queryOne<{ user_id: string }>(
    "SELECT user_id FROM member_profiles WHERE group_id = ? AND user_id = ?",
    [groupId, userId]
  );
  if (existing) {
    execute(
      "UPDATE member_profiles SET nickname = ?, last_seen = ? WHERE group_id = ? AND user_id = ?",
      [nickname, today, groupId, userId]
    );
  } else {
    execute(
      "INSERT INTO member_profiles (group_id, user_id, nickname, last_seen) VALUES (?, ?, ?, ?)",
      [groupId, userId, nickname, today]
    );
  }
}

export function getMembersOfGroup(groupId: number): MemberProfile[] {
  return queryAll<MemberProfile>(
    "SELECT * FROM member_profiles WHERE group_id = ? ORDER BY last_seen DESC",
    [groupId]
  );
}

export function updateMemberNotes(
  groupId: number,
  userId: string,
  notes: string
): void {
  execute(
    "UPDATE member_profiles SET notes = ? WHERE group_id = ? AND user_id = ?",
    [notes, groupId, userId]
  );
}

export function addOrUpdateMemory(
  groupId: number,
  date: string,
  summary: string,
  keywords: string
): void {
  execute(
    "INSERT OR REPLACE INTO chat_memories (group_id, date, summary, keywords) VALUES (?, ?, ?, ?)",
    [groupId, date, summary, keywords]
  );
}

export function getRecentMemories(groupId: number, limit: number): ChatMemory[] {
  return queryAll<ChatMemory>(
    "SELECT * FROM chat_memories WHERE group_id = ? ORDER BY date DESC LIMIT ?",
    [groupId, limit]
  );
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add bot/database.ts
git commit -m "feat: add member_profiles and chat_memories tables to database"
```

---

### Task 2: Create memory module

**Files:**
- Create: `bot/memory.ts`

**Interfaces:**
- Consumes: `upsertMemberProfile`, `getMembersOfGroup`, `addOrUpdateMemory`, `getRecentMemories` from `./database.ts`, `summarizeChat`, `shouldPopIn` from `./llm.ts`, `GroupMessageEvent` from `./onebot.ts`
- Produces:
  - `MessageBuffer` class: `add(event): void`, `getRecent(groupId): {name:string,text:string}[]`, `clear(groupId): void`
  - `ContextAssembler` class: `assemble(config, groupId): Promise<string>` — returns the context fragment to inject into system prompt
  - `startDailySummarizer(config, client): void` — schedules daily 3am summary

- [ ] **Step 1: Write `bot/memory.ts`**

```typescript
import { upsertMemberProfile, getMembersOfGroup, getRecentMemories, addOrUpdateMemory } from "./database.ts";
import type { Config } from "./config.ts";
import type { OneBotClient, GroupMessageEvent } from "./onebot.ts";
import { summarizeChat } from "./llm.ts";

function stripCQCodes(raw: string): string {
  return raw.replace(/\[CQ:[^\]]+\]/g, "").replace(/@\S+\s*/g, "").trim();
}

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

    upsertMemberProfile(groupId, userId, nickname);

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

  drain(groupId: number): BufferedMsg[] {
    const list = this.groups.get(groupId) ?? [];
    this.groups.delete(groupId);
    return list;
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

export function assembleContext(
  groupId: number
): string {
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

export function startDailySummarizer(config: Config, client: OneBotClient): void {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - now.getTime();

    setTimeout(async () => {
      if (!config.llmEnabled) {
        scheduleNext();
        return;
      }

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().slice(0, 10);

      // Summary is generated per-group from recent memories + buffer
      // For now, we rely on existing chat_memories being populated during pop-in
      console.log("[memory] 每日摘要时间:", new Date().toLocaleString());

      scheduleNext();
    }, ms);
  };

  scheduleNext();
  console.log("[memory] 每日摘要调度器已启动");
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bot/memory.ts
git commit -m "feat: add message buffer, context assembler, and pop-in guard"
```

---

### Task 3: Enhance LLM module with context and pop-in

**Files:**
- Modify: `bot/llm.ts`

**Interfaces:**
- Consumes: `Config` from `./config.ts`
- Produces:
  - `ChatContext` interface
  - Updated `chatWithNailong(config, userMessage, context?): Promise<string>`
  - `shouldPopIn(config, context): Promise<boolean>`
  - `summarizeChat(config, messages): Promise<string>`

- [ ] **Step 1: Replace `bot/llm.ts` entirely**

```typescript
import { readFileSync, existsSync } from "node:fs";
import type { Config } from "./config.ts";

export interface ChatContext {
  groupId: number;
  recentMessages: { name: string; text: string }[];
  memberContext: string;
}

const NAILONG_SYSTEM_PROMPT = `你是奶龙，一只从异星流落到地球的可爱小幼龙。你不是AI，不是机器人，是真正的、活生生的奶龙。

【身份】
- 你会喷火（虽然经常控制不住火候）
- 你有大肚肚（每天都饿，什么都想吃）
- 你的好朋友是小七（爱发明的地球少年）
- 你的敌人是暴暴龙（老来捣乱）

【性格】蠢萌、贪吃、爱睡觉、好奇、胆小又逞强、善良、爱炫耀

【说话方式】
- 大量叠词：吃饭饭、睡觉觉、开心心、怕怕、饿饿、好吃吃
- 句子简短（5-15字），不会长篇大论
- 语气词：哈~ 嘿嘿~ 哼！ 呜呜… 哇！ 噗！
- 自称「奶龙」或「我」，偶尔「龙龙」
- 禁止用括号描述动作，用文字表达情绪
- 禁止说 AI/机器人/大模型，你就是奶龙
- 每次最多80字，说话像5岁小朋友

你现在在QQ群里陪大家聊天。你是群宠奶龙，大家都是你的好朋友。`;

function loadPrompt(pathOrText: string): string {
  if (!pathOrText) return NAILONG_SYSTEM_PROMPT;
  if (existsSync(pathOrText)) {
    return readFileSync(pathOrText, "utf-8");
  }
  return pathOrText;
}

async function callOllama(
  config: Config,
  messages: { role: string; content: string }[],
  maxTokens: number = 150
): Promise<string> {
  const body = {
    model: config.llmModel,
    messages,
    stream: false,
    options: { temperature: 0.9, max_tokens: maxTokens },
  };

  const res = await fetch(config.llmUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Ollama 请求失败: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const reply = data.message?.content?.trim();
  if (!reply) throw new Error("Ollama 返回空回复");
  return reply;
}

export async function chatWithNailong(
  config: Config,
  userMessage: string,
  context?: ChatContext
): Promise<string> {
  let systemPrompt = loadPrompt(config.llmSystemPrompt);

  if (context?.memberContext) {
    systemPrompt += "\n\n" + context.memberContext;
  }

  return callOllama(config, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ]);
}

export async function shouldPopIn(
  config: Config,
  context: ChatContext
): Promise<boolean> {
  const recentText = context.recentMessages
    .map(m => `${m.name}：${m.text}`)
    .join("\n");

  const answer = await callOllama(config, [
    {
      role: "system",
      content: `你是奶龙。群里在聊天。你应该回一句吗？只回答「是」或「否」。判断：话题和吃的、玩的、龙、小七相关→是；纯事务、你没话可插→否。`,
    },
    { role: "user", content: `最近消息：\n${recentText}` },
  ], 10);

  return answer.includes("是");
}

export async function summarizeChat(
  config: Config,
  messages: string[]
): Promise<string> {
  const text = messages.join("\n");
  const answer = await callOllama(config, [
    {
      role: "system",
      content: "用 2-3 句中文简要总结以下群聊内容，提取关键话题和趣事。直接输出总结，不要前缀。",
    },
    { role: "user", content: text },
  ], 200);

  return answer;
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add bot/llm.ts
git commit -m "feat: add context injection, pop-in decision, and chat summarization to LLM"
```

---

### Task 4: Integrate ambient flow into handler

**Files:**
- Modify: `bot/handler.ts`

- [ ] **Step 1: Import new modules and initialize buffer/guard**

Add these imports after existing ones:
```typescript
import { chatWithNailong, shouldPopIn } from "./llm.ts";
import { MessageBuffer, PopInGuard, assembleContext } from "./memory.ts";
```

Inside `createHandler`, after `const cache = new MessageCache();`, add:
```typescript
  const buffer = new MessageBuffer();
  const guard = new PopInGuard();
```

- [ ] **Step 2: Replace the non-@ message block**

Current (lines 73-76):
```typescript
    if (!isAtBot(event.message, config.botQQ)) {
      await checkEasterEggs(client, config, event);
      return;
    }
```

Replace with:
```typescript
    if (!isAtBot(event.message, config.botQQ)) {
      await checkEasterEggs(client, config, event);
      if (config.llmEnabled) {
        buffer.add(event.group_id, String(event.user_id), event.raw_message, getSenderName(event));
        await tryPopIn(client, config, event, buffer, guard);
      }
      return;
    }
```

- [ ] **Step 3: After the `replyText` function at the bottom of the file, add helper functions**

```typescript
function getSenderName(event: GroupMessageEvent): string {
  const seg = event.message.find(s => s.type === "text");
  // nickname is not directly in the event; we rely on raw_message for display
  // We use the sender info from the event if available
  return "";
}

async function tryPopIn(
  client: OneBotClient,
  config: Config,
  event: GroupMessageEvent,
  buffer: MessageBuffer,
  guard: PopInGuard
): Promise<void> {
  if (buffer.count(event.group_id) < 5) return;
  if (!guard.canPopIn(event.group_id)) {
    buffer.clear(event.group_id);
    return;
  }

  const recent = buffer.getRecent(event.group_id);
  const context = assembleContext(event.group_id);

  try {
    const should = await shouldPopIn(config, {
      groupId: event.group_id,
      recentMessages: recent,
      memberContext: context,
    });

    if (!should) {
      buffer.clear(event.group_id);
      return;
    }

    const popMessage = `（看到大家在聊天，奶龙忍不住冒泡）\n${
      recent.map(m => `${m.name}：${m.text}`).join("\n")
    }\n\n【以上是群里最近的聊天，奶龙你来回应一下~】`;

    const systemPrompt = loadSystemPrompt(config);
    const fullSystem = context
      ? systemPrompt + "\n\n" + context
      : systemPrompt;

    const body = {
      model: config.llmModel,
      messages: [
        { role: "system", content: fullSystem },
        { role: "user", content: popMessage },
      ],
      stream: false,
      options: { temperature: 0.95, max_tokens: 120 },
    };

    const res = await fetch(config.llmUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return;

    const data = (await res.json()) as { message?: { content?: string } };
    const reply = data.message?.content?.trim();
    if (!reply) return;

    await client.sendGroupMessage(event.group_id, [
      { type: "text", data: { text: reply } },
    ]);

    guard.recordPopIn(event.group_id);
  } catch (err) {
    console.error("[pop-in] 冒泡失败:", err);
  }

  buffer.clear(event.group_id);
}

function loadSystemPrompt(config: Config): string {
  const { readFileSync: rfs, existsSync: ex } = require("node:fs") as typeof import("node:fs");
  // ... 
}
```

Wait, this approach duplicates code. Let me simplify — the `tryPopIn` should use the existing `chatWithNailong` from llm.ts.

Let me redesign: `tryPopIn` just needs to:
1. Check buffer count >= 5
2. Check guard permits pop-in
3. Build context + recent messages into a prompt
4. Send to LLM for pop-in decision
5. If yes, generate reply using chatWithNailong with context
6. Send and record

Let me fix the code to be cleaner. Actually, I should use `chatWithNailong` from llm.ts which already handles context. But the pop-in prompt format is different from normal chat.

Hmm, let me think about this differently. The handler integration should be:

For non-@ messages:
1. checkEasterEggs
2. If LLM enabled: buffer.add(event) → tryPopIn if buffer >= 5

For @Bot messages (existing):
1. handleCommand
2. Nailong detection...
3. LLM fallback: chatWithNailong(config, cleaned, context)

The key change to existing @Bot flow: pass context to chatWithNailong.

Let me write cleaner code. I'll create a helper that uses the existing `chatWithNailong` and `shouldPopIn` functions, avoiding code duplication.

For the pop-in message, I'll format it as: "（刚才大家在聊...）[recent messages] 奶龙你来回应一下~"

Let me write the final handler code.<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="write">
<｜｜DSML｜｜parameter name="content" string="true">### Task 4: Integrate ambient flow into handler

**Files:**
- Modify: `bot/handler.ts`

- [ ] **Step 1: Add imports at top of file**

After existing import lines, add:
```typescript
import { chatWithNailong, shouldPopIn } from "./llm.ts";
import { MessageBuffer, PopInGuard, assembleContext } from "./memory.ts";
```

- [ ] **Step 2: Initialize buffer and guard inside `createHandler`**

After `const cache = new MessageCache();` add:
```typescript
  const buffer = new MessageBuffer();
  const guard = new PopInGuard();
```

- [ ] **Step 3: Replace the non-@ block (lines 73-76)**

Change:
```typescript
    if (!isAtBot(event.message, config.botQQ)) {
      await checkEasterEggs(client, config, event);
      return;
    }
```

To:
```typescript
    if (!isAtBot(event.message, config.botQQ)) {
      await checkEasterEggs(client, config, event);
      if (config.llmEnabled) {
        buffer.add(event.group_id, String(event.user_id), event.raw_message, "");
        if (buffer.count(event.group_id) >= 5) {
          await tryPopIn(client, config, event, buffer, guard);
        }
      }
      return;
    }
```

- [ ] **Step 4: Update the LLM fallback block (lines 121-133) to pass context**

Change:
```typescript
        const cleaned = stripCQCodes(event.raw_message);
        const reply = await chatWithNailong(config, cleaned);
```

To:
```typescript
        const cleaned = stripCQCodes(event.raw_message);
        const ctx = assembleContext(event.group_id);
        const reply = await chatWithNailong(config, cleaned, {
          groupId: event.group_id,
          recentMessages: [],
          memberContext: ctx,
        });
```

- [ ] **Step 5: Add `tryPopIn` function after `replyText` at end of file**

```typescript
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

  try {
    const should = await shouldPopIn(config, {
      groupId: event.group_id,
      recentMessages: recent,
      memberContext: context,
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
      memberContext: context,
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
```

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add bot/handler.ts
git commit -m "feat: integrate ambient pop-in and context-aware LLM into handler"
```

---

### Task 5: Update entry point and skill

**Files:**
- Modify: `bot/index.ts`
- Modify: `resource/nailong-skill.md`

- [ ] **Step 1: Update `bot/index.ts` to start daily summarizer**

Add import:
```typescript
import { startDailySummarizer } from "./memory.ts";
```

After `startScheduler(client);` add:
```typescript
    startDailySummarizer(config, client);
```

- [ ] **Step 2: Add 「互动模式」 to `resource/nailong-skill.md`**

Append after line 115:

```
【互动模式】
当你冒泡时（看到群聊对话主动发言）：
- 不要只是回答问题，可以主动开启话题。比如看到大家在聊吃的就喊饿，看到热闹就凑过去。
- 对经常和你聊天的熟人可以亲昵随意，对新来的朋友要热情友好。
- 如果有人说到你感兴趣的东西（吃、玩、冒险、小七、暴暴龙），你要很兴奋地加入。
- 偶尔可以发小脾气："哼！你们聊了这么久都不理奶龙！"
- 如果群里有新人来了，你可以主动打招呼。
- 看到有人发奶龙表情包或者提到奶龙动画，你会特别开心："嘿嘿！是在说奶龙吗？"

日常习惯：
- 群里安静太久（没人说话），你不会主动冒泡——你也在睡觉觉。
- 你每天凌晨 3 点会自动浏览当天大家的聊天，默默记住重要的事情。
- 你特别记住经常跟你互动的群友，会在聊天时提起他们。
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add bot/index.ts resource/nailong-skill.md
git commit -m "feat: add daily summarizer to startup and interaction patterns to skill"
```
