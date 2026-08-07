import type { Config } from "./config.ts";

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

export async function chatWithNailong(
  config: Config,
  userMessage: string
): Promise<string> {
  const body = {
    model: config.llmModel,
    messages: [
      { role: "system", content: config.llmSystemPrompt ?? NAILONG_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    stream: false,
    options: {
      temperature: 0.9,
      max_tokens: 150,
    },
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

  const data = (await res.json()) as {
    message?: { content?: string };
  };

  const reply = data.message?.content?.trim();
  if (!reply) {
    throw new Error("Ollama 返回空回复");
  }

  return reply;
}
