import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ReplyMessages {
  readonly decodeFail: string;
  readonly notFound: string;
  readonly timeout: string;
}

export interface EasterEgg {
  readonly keyword: string;
  readonly reply: string;
  readonly coins: number;
}

export interface Config {
  readonly wsUrl: string;
  readonly httpUrl: string;
  readonly botQQ: string;
  readonly adminQQ: string;
  readonly replies: ReplyMessages;
  readonly nailongResourceDir: string;
  readonly easterEggs: EasterEgg[];
  readonly llmEnabled: boolean;
  readonly llmUrl: string;
  readonly llmModel: string;
  readonly llmSystemPrompt: string;
}

function parseEnvFile(path: string): Record<string, string> {
  const content = readFileSync(path, "utf-8");
  const map: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    map[key] = value;
  }
  return map;
}

export function loadConfig(): Config {
  const envPath = resolve(process.cwd(), ".env");
  let env: Record<string, string> = {};
  try {
    env = parseEnvFile(envPath);
  } catch {
    console.error("找不到 .env 文件，请从 .env.example 复制并填写配置");
    process.exit(1);
  }

  const wsUrl = env["NAPCT_WS_URL"] ?? process.env["NAPCT_WS_URL"];
  const httpUrl = env["NAPCT_HTTP_URL"] ?? process.env["NAPCT_HTTP_URL"];
  const botQQ = env["BOT_QQ"] ?? process.env["BOT_QQ"];

  if (!wsUrl) { console.error("缺少 NAPCT_WS_URL 配置"); process.exit(1); }
  if (!httpUrl) { console.error("缺少 NAPCT_HTTP_URL 配置"); process.exit(1); }
  if (!botQQ) { console.error("缺少 BOT_QQ 配置"); process.exit(1); }

  return {
    wsUrl,
    httpUrl,
    botQQ,
    adminQQ: env["ADMIN_QQ"] ?? process.env["ADMIN_QQ"] ?? "",
    replies: {
      decodeFail: env["REPLY_DECODE_FAIL"] ?? process.env["REPLY_DECODE_FAIL"] ?? "翻译失败，奶龙语的语法有误哦",
      notFound: env["REPLY_NOT_FOUND"] ?? process.env["REPLY_NOT_FOUND"] ?? "没有检测到奶龙语，请 @我 + 奶龙语 或引用一条奶龙语消息",
      timeout: env["REPLY_TIMEOUT"] ?? process.env["REPLY_TIMEOUT"] ?? "Bot 暂时无法响应，请稍后再试",
    },
    nailongResourceDir: env["NAILONG_RESOURCE_DIR"] ?? process.env["NAILONG_RESOURCE_DIR"] ?? resolve(process.cwd(), "resource"),
    easterEggs: parseEasterEggs(env),
    llmEnabled: (env["LLM_ENABLED"] ?? process.env["LLM_ENABLED"] ?? "false") === "true",
    llmUrl: env["LLM_URL"] ?? process.env["LLM_URL"] ?? "http://localhost:11434/api/chat",
    llmModel: env["LLM_MODEL"] ?? process.env["LLM_MODEL"] ?? "qwen2.5:7b",
    llmSystemPrompt: env["LLM_SYSTEM_PROMPT"] ?? process.env["LLM_SYSTEM_PROMPT"] ?? "",
  };
}

function parseEasterEggs(env: Record<string, string>): EasterEgg[] {
  const raw = env["EASTER_EGGS"] ?? process.env["EASTER_EGGS"];
  if (!raw) {
    return [
      { keyword: "我是奶龙", reply: "我才是奶龙！+2奶龙币", coins: 2 },
      { keyword: "奶龙奶龙", reply: "叫我干嘛！+2奶龙币", coins: 2 },
      { keyword: "我喜欢奶龙", reply: "我也喜欢你！+2奶龙币", coins: 2 },
    ];
  }
  const eggs: EasterEgg[] = [];
  for (const part of raw.split(";")) {
    const m = part.match(/^(.+?)→(.+?)→(\d+)$/);
    if (m) {
      eggs.push({ keyword: m[1], reply: m[2], coins: parseInt(m[3], 10) });
    }
  }
  return eggs.length > 0 ? eggs : [
    { keyword: "我是奶龙", reply: "我才是奶龙！+2奶龙币", coins: 2 },
    { keyword: "奶龙奶龙", reply: "叫我干嘛！+2奶龙币", coins: 2 },
    { keyword: "我喜欢奶龙", reply: "我也喜欢你！+2奶龙币", coins: 2 },
  ];
}
