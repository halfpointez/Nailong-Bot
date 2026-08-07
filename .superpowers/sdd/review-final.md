# Final Branch Review — 每日奶龙 Gacha System

**Branch commits:** 9 commits (0f4e3ae..8898027)  
**Files changed:** 13 files, +1135 / -72  
**Typecheck:** Passes cleanly (`tsc --noEmit`)

---

## 1. Spec Compliance

### Database
| Requirement | Status | Notes |
|---|---|---|
| SQLite via better-sqlite3 | ✅ | |
| 4 tables (nailongs, users, collections, easter_eggs) | ✅ | |
| nailong.json template (id/name/description/analysis/file/rarity) | ✅ | |
| Rarity weights: common 60%, rare 25%, epic 12%, legendary 3% | ✅ | `nailong-party.ts:10-15` |

### Sign-in
| Requirement | Status | Notes |
|---|---|---|
| Daily +10 coins | ✅ | `nailong-party.ts:37` |
| No double sign-in | ✅ | Checks `sign_in_date === td` at `nailong-party.ts:29` |

### Draw
| Requirement | Status | Notes |
|---|---|---|
| -10 coins cost | ✅ | `nailong-party.ts:56` |
| Weighted random, excluding owned | ✅ | `nailong-party.ts:67` |
| "集齐" handling | ✅ | `nailong-party.ts:69-77` |
| Insufficient coins handling | ✅ | `nailong-party.ts:57` |
| Duplicate draw label "(已拥有)" | ⚠️ | Dead code — candidates filter excludes owned items, so `isNew` is always `true` (see Code Quality) |

### My Collection / Full Dex
| Requirement | Status | Notes |
|---|---|---|
| ✅/❌ markers on full dex | ✅ | `commands.ts:82` |
| My collection shows owned only | ✅ | |
| Full dex shows all items | ✅ | |

### Random NaiLong
| Requirement | Status | Notes |
|---|---|---|
| Free (no coin check) | ✅ | |
| No collection recording | ✅ | |

### Balance View
| Requirement | Status | Notes |
|---|---|---|
| Shows coins + collection count + draw count | ⚠️ | Spec says `已签到 3 天`, code says `已收集 N 只`. The `signInDays` field actually returns `getCollections().length` — misleading variable name. No sign-in day counter exists in DB. Acceptable divergence but inconsistent with spec. |

### Hourly Settlement
| Requirement | Status | Notes |
|---|---|---|
| 0 speakers → "哼！都不说话 奶龙好无聊" | ✅ | `scheduler.ts:89-90` |
| ≥1 speakers → top speaker +1 coin | ✅ | `scheduler.ts:98-99` |

### Burst Detection
| Requirement | Status | Notes |
|---|---|---|
| 10min/50msg threshold | ✅ | `scheduler.ts:19-20` |
| "你们都是奶龙！+1奶龙币" | ✅ | |
| 30min cooldown | ✅ | `scheduler.ts:21` |
| All speakers get +1 coin | ✅ | `scheduler.ts:66-69` |

### Easter Eggs
| Requirement | Status | Notes |
|---|---|---|
| 3 defaults (我是奶龙, 奶龙奶龙, 我喜欢奶龙) | ✅ | `config.ts:75-79` |
| +2 coins each | ✅ | |
| Configurable via EASTER_EGGS env var | ✅ | `config.ts:72-92` |
| Once per day per user per egg | ❌ | **CRITICAL BUG** — see below |

### Image Sending
| Requirement | Status | Notes |
|---|---|---|
| file:/// protocol | ✅ | `commands.ts:64,97` |
| existsSync check before sending | ✅ | `commands.ts:63,96` |
| Correct path construction | ⚠️ | Uses string concat `resourceDir + "/images/" + item.file`, not `path.resolve()` — functional but fragile |

### Command Routing
| Requirement | Status | Notes |
|---|---|---|
| All commands require @Bot | ✅ | `handler.ts:69` |
| Translation flow still works after command routing | ✅ | `handler.ts:74-107` |

### Global Constraints
| Requirement | Status | Notes |
|---|---|---|
| `src/nailong.ts` not modified | ✅ | Untouched |
| No external bot frameworks | ✅ | |
| Config from `.env` | ✅ | |
| Runs via `npm run bot` with `tsx` | ✅ | `package.json:7` |

---

## 2. Code Quality

### Imports
| Check | Status |
|---|---|
| ESM with `.ts` extensions | ✅ |
| No unused imports | ✅ (tsc passes `noUnusedLocals`) |

### Dead Code / Unused Exports
- `getNaiLongById` in `database.ts:127` — exported but never imported anywhere
- `getNaiLongById` import not present in any consumer file
- `HourlyChatStats.timestamp` in `scheduler.ts:6` — field is set but never read
- `isNew` / `dupeLabel` logic in `nailong-party.ts:80,90` — always `isNew=true` because `candidates` is filtered to unowned items; the `if (isNew)` at line 81 is always taken; the `else` branch (dupeLabel = "（已拥有）") at line 90 is unreachable

### Code Duplication
- `rarityStars` function duplicated in both `commands.ts:117-123` and `nailong-party.ts:148-154`
- `stripCQCodes` function duplicated in both `commands.ts:14-16` and `handler.ts:11-13`

### Type Safety
| Check | Status |
|---|---|
| No `any` usage | ✅ |
| All interfaces well-typed | ✅ |
| `readonly` modifiers on Config interfaces | ✅ |

### Error Handling
| Check | Status |
|---|---|
| `existsSync` before image send | ✅ |
| try/catch on burst/settlement message sends | ✅ |
| try/catch on `getMessage` API call | ✅ |
| Handler swallows individual handler errors | ✅ |

### Memory Management
| Check | Status |
|---|---|
| `hourlyStats` Map entries cleaned on settlement | ✅ |
| `burstStates` Map entries **never removed** | ❌ — Groups that leave/stop chatting will have stale burst state entries accumulate forever |

### Handler Flow
| Check | Status |
|---|---|
| Non-@Bot: easter eggs → return | ✅ |
| @Bot: commands → translation fallback | ✅ |
| `recordMessage` + `checkBurst` called for ALL messages | ✅ (correct — burst detection operates on all messages) |

### Misc
- `imageFilePath` uses string concatenation instead of `path.resolve()` (`nailong-party.ts:167`)
- `easter_eggs` table PRIMARY KEY includes `date` in SELECT but not in INSERT uniqueness constraint (see Critical bug below)

---

## 3. Issues

### CRITICAL

**Easter egg cooldown is broken — infinite daily coins.**

`easter_eggs` table has `PRIMARY KEY (user_id, egg_name)` without `date` (`database.ts:62-67`). On day 1, the trigger inserts `(user, egg, day1)`. On day 2:
1. `isEasterEggCoolingDown(user, egg, day2)` — SELECT returns no row (existing row has `day1`) → check passes (not in cooldown)
2. Coins are added (`handler.ts:125`)
3. `triggerEasterEgg(user, egg, day2)` — `INSERT OR IGNORE` fails silently because PRIMARY KEY `(user, egg)` already occupied by the day-1 row with stale date
4. Result: on every subsequent day, the check passes and coins are added, but the row never updates

**Fix:** Change PRIMARY KEY in the CREATE TABLE to `(user_id, egg_name, date)` — or use `INSERT ... ON CONFLICT (user_id, egg_name) DO UPDATE SET date = excluded.date`.

**File:** `database.ts:38-68`, `database.ts:131-141`

---

### IMPORTANT

1. **Balance `signInDays` returns owned count, not sign-in days.**  
   `nailong-party.ts:137` — `getBalance().signInDays` = `getCollections(userId).length`. Variable name is misleading. Display text `已收集 N 只` diverges from spec's `已签到 3 天`. DB has no sign-in-day counter, only `sign_in_date`. If spec compliance matters, either add a counter column or update the spec.

2. **Unreachable `isNew=false` branch in drawNaiLong.**  
   `nailong-party.ts:80` — `isNew` is always `true` because `candidates` is pre-filtered to unowned items. The `dupeLabel = "（已拥有）"` path is dead. Either remove it or change the draw logic to include owned items (spec says "从用户未拥有的奶龙中" so the filter is correct, the dead branch should be removed).

3. **`burstStates` Map never cleaned.**  
   `scheduler.ts:17` — Burst state entries for groups accumulate indefinitely. Consider periodic cleanup of entries for inactive groups (e.g., hourly alongside settlement).

---

### MINOR

1. **Duplicated `rarityStars`** in `commands.ts:117` and `nailong-party.ts:148` — should be extracted to a shared module.
2. **Duplicated `stripCQCodes`** in `commands.ts:14` and `handler.ts:11` — same.
3. **`getNaiLongById`** in `database.ts:127` — unused export.
4. **`HourlyChatStats.timestamp`** in `scheduler.ts:6` — field is never read.
5. **`imageFilePath`** uses string concatenation instead of `path.resolve()` (`nailong-party.ts:167`). Functional but fragile.

---

## 4. Overall Verdict

**Needs fixes before merge** — due to the critical easter egg cooldown bug (infinite daily coins exploit). The rest of the implementation is solid with only minor spec divergences and code quality nits.

### Required before merge:
- Fix easter egg PRIMARY KEY to include `date`

### Recommended before merge:
- Remove dead `isNew`/`dupeLabel` code in `drawNaiLong`
- Add `burstStates` cleanup
- Fix `signInDays` variable name or add sign-in day counter

### Nice to have:
- Deduplicate `rarityStars` and `stripCQCodes`
- Remove `getNaiLongById` unused export
- Use `path.resolve()` in `imageFilePath`
