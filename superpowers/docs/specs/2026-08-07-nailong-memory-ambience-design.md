# 奶龙上下文记忆 & 智能冒泡 — Design Spec

> 增强奶龙 LLM 能力：持久化群成员记忆、聊天摘要、自动间歇发言。

## Overview

在现有 LLM chat 基础上新增三个子系统：
1. **记忆系统**：SQLite 存储群成员档案和每日聊天摘要，注入 LLM 上下文
2. **智能冒泡**：非 @ 消息积攒后送 LLM 决策是否发言，带冷却
3. **Skill 增强**：提示词新增互动模式和上下文感知指导

## Database

新增两张表到 `resource/nailong.db`：

```sql
CREATE TABLE IF NOT EXISTS member_profiles (
  group_id  INTEGER NOT NULL,
  user_id   TEXT NOT NULL,
  nickname  TEXT,
  notes     TEXT DEFAULT '',
  last_seen TEXT,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_memories (
  group_id  INTEGER NOT NULL,
  date      TEXT NOT NULL,
  summary   TEXT NOT NULL,
  keywords  TEXT DEFAULT '',
  PRIMARY KEY (group_id, date)
);
```

### CRUD 导出

```
upsertMemberProfile(groupId, userId, nickname): void
getMembersOfGroup(groupId): MemberProfile[]
updateMemberNotes(groupId, userId, notes): void

addOrUpdateMemory(groupId, date, summary, keywords): void
getRecentMemories(groupId, limit): ChatMemory[]
```

## 记忆注入

LLM 调用前动态拼接上下文片段到 system prompt 末尾：

```
【你认识的群友】
- 张三（水群大王，天天喊饿，你跟他很熟）
- 李四（喜欢发奶龙表情包，新朋友）

【最近群聊动态】
- 昨天大家讨论吃什么吵了一下午，最后点了炸鸡
- 张三说他要减肥，但今天又在群里喊饿
```

## 智能冒泡流程

```
每条普通群消息 →
  ├─ 彩蛋触发 → 处理
  ├─ 预过滤（纯表情/单字/纯数字 → 跳过）
  ├─ 积累到消息缓冲区（最多 8 条）
  └─ 每积累 5 条 →
       ├─ 检查冷却（5 分钟 + 每小时 ≤ 100 条安全帽）
       └─ 送 LLM 决策 → 是 → 生成回复冒泡 → 发送
                    → 否 → 继续积累
```

### LLM 决策 Prompt

```
你是奶龙。群聊最近消息：
张三：好饿啊
李四：我也是 中午吃啥
张三：不知道 要不要点外卖
王五：带我一个

奶龙应该回应吗？只答「是」或「否」。
判断：话题和你相关（吃的、玩的、龙）→ 是；纯事务、不适合插嘴 → 否。
```

## LLM 模块变更

`chatWithNailong` 签名扩展：

```typescript
interface ChatContext {
  groupId: number;
  recentMessages: { name: string; text: string }[];
  memberProfiles: { name: string; notes: string }[];
  recentMemories: string[];
}

chatWithNailong(config: Config, userMessage: string, context?: ChatContext): Promise<string>
```

新增：

```typescript
shouldPopIn(config: Config, context: ChatContext): Promise<boolean>
summarizeChat(config: Config, messages: string[]): Promise<string>
```

## Skill 增强

在 `resource/nailong-skill.md` 末尾新增「互动模式」章节：

```
【互动模式】
- 冒泡时不只是回答问题，可以主动开启话题
- 对熟人说话亲昵随意，对新朋友热情友好
- 群里安静太久（10分钟没人说话）可以发："怎么都不说话呀？奶龙好无聊……"
- 记住谁对你特别好（经常@你聊天的人），你更喜欢他们
- 有人在群里说关于你的事（奶龙表情包、奶龙动画），你要很兴奋
```

## 消息缓冲区

`bot/memory.ts` 导出：

```
MessageBuffer: 按群分组的循环缓冲区（最近 8 条），提供 getRecent/clear
ContextAssembler: 从 DB 拉取成员档案 + 近期摘要，拼成 context fragment
```

## Handler 变更

现有非 @ 消息处理：
```
checkEasterEggs → return
```

改为：
```
checkEasterEggs → 进程完成
buffer.add(event)
每 5 条：
  isCoolingDown? → skip
  assemble context → shouldPopIn → yes → reply → update cooldown → clear buffer
                                    → no → clear buffer（不含已积累但待下次判断的消息）
```

## 每日摘要生成

`bot/memory.ts` 添加 `DailySummarizer`：
- 每天凌晨 3 点触发
- 把前一天每个群的消息缓冲区内容拼成一段
- 调用 `summarizeChat` 用 LLM 生成 2-3 句摘要
- 存入 `chat_memories`

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `bot/memory.ts` | Create | MessageBuffer, ContextAssembler, DailySummarizer |
| `bot/database.ts` | Modify | Add member_profiles + chat_memories tables & CRUD |
| `bot/llm.ts` | Modify | Extended chatWithNailong, add shouldPopIn, summarizeChat |
| `bot/handler.ts` | Modify | Integrate ambient pop-in flow |
| `bot/index.ts` | Modify | Init memory tables, start daily summarizer |
| `resource/nailong-skill.md` | Modify | Add 互动模式 section |

## Constraints

- `src/nailong.ts` must not be modified
- No new npm dependencies
- LLM disabled → memory still works, but only manual @Bot chat uses it
- All new DB tables use same sql.js path as existing tables
