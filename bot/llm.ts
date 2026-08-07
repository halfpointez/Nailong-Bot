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
    throw new Error(`Ollama request failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const reply = data.message?.content?.trim();
  if (!reply) throw new Error("Ollama returned empty reply");
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
    .map(m => `${m.name}: ${m.text}`)
    .join("\n");

  const answer = await callOllama(config, [
    {
      role: "system",
      content: "You are Nailong. People in the group are chatting. Should you respond? Reply only 'yes' or 'no'. Criteria: topic is about food, play, dragons, Xiaoqi => yes. Pure logistics, nothing to add => no.",
    },
    { role: "user", content: `Recent messages:\n${recentText}` },
  ], 10);

  return answer.toLowerCase().includes("yes");
}

export async function summarizeChat(
  config: Config,
  messages: string[]
): Promise<string> {
  const text = messages.join("\n");
  const answer = await callOllama(config, [
    {
      role: "system",
      content: "Summarize the following group chat in 2-3 short Chinese sentences. Extract key topics and interesting moments. Output the summary directly without prefix.",
    },
    { role: "user", content: text },
  ], 200);

  return answer;
}
