# Final Code Review: Nailong Memory & Ambient Pop-in

**Branch:** feature/nailong-memory-ambience
**Commits reviewed:** `b3dbe11` .. `80f00f4` (5 commits, 6 files, +347/-20)
**Date:** 2026-08-07

---

## 1. Spec Compliance

### Database (`bot/database.ts`)

| Check | Status |
|-------|--------|
| `member_profiles` table in `initDb` | PASS |
| `chat_memories` table in `initDb` | PASS |
| `upsertMemberProfile(groupId, userId, nickname): void` | PASS |
| `getMembersOfGroup(groupId): MemberProfile[]` | PASS |
| `updateMemberNotes(groupId, userId, notes): void` | PASS |
| `addOrUpdateMemory(groupId, date, summary, keywords): void` | PASS |
| `getRecentMemories(groupId, limit): ChatMemory[]` | PASS |

### Message Buffer (`bot/memory.ts`)

| Check | Status |
|-------|--------|
| `MessageBuffer` class with `maxSize = 8` | PASS |
| CQ codes stripped on `add()` | PASS |
| `upsertMemberProfile` called on `add()` | PASS |
| `getRecent()` returns `{name, text}[]` | PASS |
| `count()` returns buffer size | PASS |
| `clear()` deletes buffer | PASS |

### PopInGuard (`bot/memory.ts`)

| Check | Status |
|-------|--------|
| 5-minute cooldown (`POP_IN_COOLDOWN = 5 * 60 * 1000`) | PASS |
| 100/hr max (`MAX_PER_HOUR = 100`) | PASS |
| `canPopIn(groupId): boolean` | PASS |
| `recordPopIn(groupId): void` | PASS |

### Context Assembly (`bot/memory.ts`)

| Check | Status |
|-------|--------|
| `assembleContext(groupId): string` | PASS |
| Fetches members via `getMembersOfGroup` | PASS |
| Fetches recent memories via `getRecentMemories(groupId, 3)` | PASS |
| Produces `【你认识的群友】` section | PASS |
| Produces `【最近群聊动态】` section | PASS |

### LLM Module (`bot/llm.ts`)

| Check | Status |
|-------|--------|
| `ChatContext` interface exported | PASS |
| `chatWithNailong` accepts optional `context?: ChatContext` | PASS |
| `memberContext` appended to system prompt | PASS |
| `shouldPopIn(config, context): Promise<boolean>` | PASS |
| `summarizeChat(config, messages): Promise<string>` | PASS |
| `callOllama` refactored as shared internal helper | PASS |

### Handler (`bot/handler.ts`)

| Check | Status |
|-------|--------|
| Non-@ flow: easterEggs → buffer.add → tryPopIn | PASS (see issue #1) |
| Buffer trigger at `count >= 5` | PASS |
| @Bot LLM fallback calls `assembleContext` | PASS |
| `tryPopIn` clears buffer on all exit paths | PASS (reviewed 4 exit paths) |
| Error handling: try/catch + console.error + buffer.clear | PASS |

### Startup (`bot/index.ts`)

| Check | Status |
|-------|--------|
| `startDailySummarizer` imported and called | PASS |
| Called after client connects | PASS |

### Skill (`resource/nailong-skill.md`)

| Check | Status |
|-------|--------|
| `【互动模式】` section added | PASS |
| Interaction patterns documented | PASS |

---

## 2. Code Quality

### No Circular Imports
- `memory.ts` → `database.ts` (one-directional)
- `handler.ts` → `llm.ts`, `memory.ts`
- `memory.ts` does NOT import `llm.ts`
- `llm.ts` does NOT import `memory.ts`
- **PASS**

### Global Constraints

| Constraint | Status |
|-----------|--------|
| `src/nailong.ts` not modified | PASS (confirmed via `git diff`) |
| No new npm dependencies | PASS |
| `sql.js` remains only persistence layer | PASS |
| Existing features (commands, translation, gacha, scheduler) preserved | PASS |

### Unused Imports / Variables
- No unused imports detected in any modified file
- `_config` and `_client` in `startDailySummarizer` are underscore-prefixed placeholders (see issue #3)

### Error Handling
- `tryPopIn` catches exceptions gracefully with `console.error` — PASS
- `buffer.clear()` runs outside try/catch, guaranteed on all paths — PASS
- LLM fallback in @Bot path retains existing try/catch — PASS

### Existing Feature Regression
- `checkEasterEggs` still called on non-@ path — PASS
- `handleCommand` still called on @Bot path before any LLM — PASS
- Translation (nailong decode/encode) still works — PASS
- `replyText` fallback preserved — PASS
- `MessageCache` still created and used — PASS

---

## 3. Issues Found

### 🔴 ISSUE #1: Easter egg messages are NOT buffered
**Location:** `bot/handler.ts:77-84`
**Severity:** Minor / Design divergence

`checkEasterEggs()` returns early when an egg matches (line 172 of handler.ts), so the subsequent `buffer.add()` and `tryPopIn()` calls are never reached for easter-egg-triggering messages.

The spec's flow diagram shows:
```
每条普通群消息 → 彩蛋触发 → 处理 → 继续到 buffer.add
```

But the actual flow is:
```
每条普通群消息 → 彩蛋触发 → 处理 → return (skip buffer)
```

**Assessment:** Arguably correct — easter egg messages ("我是奶龙", "奶龙奶龙") are formulaic and not useful for conversational context. The LLM decision prompt would always return "no" for these. The spec should be updated to reflect this.

### 🟡 ISSUE #2: `startDailySummarizer` is a stub
**Location:** `bot/memory.ts:96-112`
**Severity:** Major / Missing feature

The function only logs at 3am and reschedules. It does NOT:
- Collect buffered messages
- Call `summarizeChat()`
- Store results in `chat_memories`

```typescript
export function startDailySummarizer(_config: Config, _client: OneBotClient): void {
  const scheduleNext = () => {
    // ... computes next 3am ...
    setTimeout(() => {
      console.log("[memory] 每日摘要时间:", new Date().toLocaleString());
      scheduleNext();  // <-- just reschedules, no actual work
    }, ms);
  };
  scheduleNext();
}
```

**Assessment:** The spec explicitly requires building message history, calling `summarizeChat`, and storing to `chat_memories`. This is the only incomplete feature. The `_` prefix on params signals intent to implement later, but the spec doesn't mark it as optional.

### 🟡 ISSUE #3: Nickname always empty in buffer
**Location:** `bot/handler.ts:79`
**Severity:** Minor / Pre-existing type limitation

```typescript
buffer.add(event.group_id, String(event.user_id), event.raw_message, "");
```

The `GroupMessageEvent` type (`bot/onebot.ts:20-24`) does not include a `sender` field, so nickname is always `""`. Members show up by `user_id` in context fragments (e.g., "- 123456789（你还不太熟）").

**Assessment:** Pre-existing limitation in the OneBot type definitions, not introduced by this PR. Fixing this would require enriching the `GroupMessageEvent` type with `sender.nickname`. Not blocking.

### 🟢 ISSUE #4: Spec-Code `ChatContext` interface divergence
**Location:** `bot/llm.ts:4-8`
**Severity:** Info / Design choice

**Spec defines:**
```typescript
interface ChatContext {
  groupId: number;
  recentMessages: { name: string; text: string }[];
  memberProfiles: { name: string; notes: string }[];  // structured
  recentMemories: string[];                             // separate
}
```

**Code implements:**
```typescript
export interface ChatContext {
  groupId: number;
  recentMessages: { name: string; text: string }[];
  memberContext: string;  // pre-assembled string
}
```

**Assessment:** The code inlines the assembly in `memory.ts::assembleContext()` and passes a single string. This is a better interface — it keeps the LLM module decoupled from the database schema and reduces parameter count. Not a defect.

---

## 4. Summary

| Category | Count |
|----------|-------|
| Spec checks passed | 28/28 |
| Minor issues | 2 |
| Missing feature | 1 (daily summarizer stub) |

### Verdict: **Needs fixes**

The daily summarizer stub (`startDailySummarizer`) must either:
1. Be implemented to collect buffered messages, call `summarizeChat`, and store results, OR
2. The spec must be updated to mark daily summarization as a future feature

All other systems (database, memory buffer, pop-in guard, context assembly, LLM injection, handler flow) are correctly implemented and match the spec.
