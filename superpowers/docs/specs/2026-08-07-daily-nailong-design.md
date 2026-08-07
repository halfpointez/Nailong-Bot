# 每日奶龙 — Design Spec

> 为 Nailong Bot 添加奶龙收集系统：签到赚奶龙币、抽卡集图鉴、群聊互动奖励、每小时结算。

## Overview

在现有翻译 Bot 基础上新增一个奶龙收集子系统。用户通过签到、群聊发言和彩蛋获得奶龙币，消耗奶龙币抽取奶龙，收集并查看图鉴。引入稀有度系统和每小时群聊活跃结算。

## Database

SQLite 单文件 `resource/nailong.db`，通过 `better-sqlite3` 访问。初始化时从 `resource/nailong.json` 导入奶龙索引。

```sql
CREATE TABLE nailongs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  analysis    TEXT,
  file        TEXT NOT NULL,
  rarity      TEXT NOT NULL CHECK(rarity IN ('common','rare','epic','legendary'))
);

CREATE TABLE users (
  user_id       TEXT PRIMARY KEY,
  coins         INTEGER DEFAULT 0,
  sign_in_date  TEXT,
  total_draws   INTEGER DEFAULT 0
);

CREATE TABLE collections (
  user_id     TEXT NOT NULL,
  nailong_id  TEXT NOT NULL,
  obtained_at TEXT NOT NULL,
  PRIMARY KEY (user_id, nailong_id),
  FOREIGN KEY (nailong_id) REFERENCES nailongs(id)
);

CREATE TABLE easter_eggs (
  user_id  TEXT NOT NULL,
  egg_name TEXT NOT NULL,
  date     TEXT NOT NULL,
  PRIMARY KEY (user_id, egg_name)
);
```

## nailong.json Format

```json
[
  {
    "id": "happy-nailong",
    "name": "快乐奶龙",
    "description": "喜欢的食物是空气",
    "analysis": "你今天自带好心情光环……",
    "file": "happy-nailong.png",
    "rarity": "common"
  }
]
```

文件位于 `resource/nailong.json`，提交到 Git。图片放在 `resource/images/`（gitignore，由用户自行准备）。

## Rarity

| rarity | 概率 | 显示 |
|--------|------|------|
| common | 60% | ⭐ |
| rare | 25% | ⭐⭐ |
| epic | 12% | ⭐⭐⭐ |
| legendary | 3% | ⭐⭐⭐⭐ |

## 奶龙币系统

### 获取方式

| 方式 | 收益 | 冷却 |
|------|------|------|
| `/签到` | +10 奶龙币 | 每天一次 |
| 每小时结算 — 发言最多者 | +1 奶龙币 | 每小时 |
| 实时爆发 — 10min ≥ 50 条 | 所有发言者各 +1 | 冷却 30min |
| 彩蛋关键词 | +2 奶龙币 | 每种每天一次 |

### 消耗

| 操作 | 消耗 |
|------|------|
| `/抽奶龙` | -10 奶龙币 |

## Command System

所有指令均需 @Bot。指令解析在现有 handler 翻译逻辑之前。

| 指令 | 别名 | 行为 |
|------|------|------|
| `/签到` | — | 每日签到，+10 币 |
| `/抽奶龙` | `/每日奶龙` | 消耗 10 币，从用户未拥有的奶龙中按稀有度权重随机抽一只 |
| `/我的奶龙` | — | 列出已收集奶龙 |
| `/奶龙图鉴` | — | 列出全部奶龙（已拥有标记） |
| `/随机奶龙` | — | 免费随机发一张图，群内去重，不记入收集 |
| `/奶龙币` | — | 查看余额 & 统计 |

## Easter Eggs

普通群消息（不需 @Bot），每条每天每用户仅触发一次：

| 触发词 | 回复 | 币 |
|--------|------|------|
| `我是奶龙` | `我才是奶龙！+2奶龙币` | +2 |
| `奶龙奶龙` | `叫我干嘛！+2奶龙币` | +2 |
| `我喜欢奶龙` | `我也喜欢你！+2奶龙币` | +2 |

## Hourly Settlement

每整点结算上一小时群聊活跃：

| 发言人数 | 行为 |
|----------|------|
| = 0 | `哼！都不说话 奶龙好无聊` |
| ≥ 1 | `嘿嘿，你是奶龙！@发言最多者 +1奶龙币` |

## Burst Detection

实时监控 10 分钟窗口内消息数。≥ 50 条时触发：

`你们都是奶龙！+1奶龙币 @所有发言者`

触发后冷却 30 分钟。

## Reply Formats

### /签到
```
✅ 签到成功！+10奶龙币 | 余额：35币
```

### /抽奶龙（首次抽到）
```
[图片]
我是【快乐奶龙】
喜欢的食物是空气
你今天自带好心情光环……
（⭐ 消耗 10 币 | 余额 25 币）
```

### /抽奶龙（重复抽到已拥有的）
```
[图片]
我是【快乐奶龙】（已拥有）
喜欢的食物是空气
你今天自带好心情光环……
（⭐ 消耗 10 币 | 余额 25 币）
```

### /我的奶龙
```
你的奶龙图鉴 (3/20)：
⭐ 快乐奶龙
⭐ 睡觉奶龙
⭐⭐ 愤怒奶龙
```

### /奶龙图鉴
```
全部奶龙图鉴 (20)：
⭐ 快乐奶龙 ✅
⭐ 睡觉奶龙 ✅
⭐⭐ 愤怒奶龙 ✅
⭐⭐⭐ 传说奶龙 ❌
```

### /随机奶龙
```
[图片]
我是【愤怒奶龙】
偶尔生气也很正常
这是今天的随机奶龙~
```

### /奶龙币
```
💰 奶龙币：25 | 已签到 3 天 | 已抽卡 2 次
```

### 集齐处理
```
你已经抓到全部的奶龙了！（20/20）
```

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `resource/nailong.json` | Create | 奶龙图鉴索引（用户提供数据，提交模板） |
| `resource/images/.gitkeep` | Create | 图片目录占位 |
| `bot/database.ts` | Create | SQLite 初始化、查询封装 |
| `bot/nailong-party.ts` | Create | 抽卡/图鉴/货币核心逻辑 |
| `bot/scheduler.ts` | Create | 每小时结算 & 爆发检测 |
| `bot/commands.ts` | Create | 指令解析 & 路由 |
| `bot/handler.ts` | Modify | 集成命令路由、彩蛋检测、发言计数 |
| `bot/config.ts` | Modify | 新增 NaiLong 相关配置项 |
| `package.json` | Modify | + better-sqlite3, @types/better-sqlite3 |
| `.env.example` | Modify | 新增配置项 |
| `.gitignore` | Modify | + resource/images/, resource/*.db |

## Dependencies Added

| Package | Type | Purpose |
|---------|------|---------|
| `better-sqlite3` | runtime | SQLite 数据库 |
| `@types/better-sqlite3` | dev | 类型声明 |

## Global Constraints

- `src/nailong.ts` must not be modified
- No external bot frameworks
- All configurable values from `.env`
- Runs via `npm run bot` with `tsx`
- Existing translation flow must remain functional
- Command routing happens before translation fallback
