# Nailong Bot

奶龙语 QQ 群聊翻译机器人，通过 NapCat（OneBot v11 协议）接入 QQ。

## 功能

- 在群聊中 @Bot + 奶龙语，自动翻译为原文
- 支持 @Bot 引用一条奶龙语消息进行翻译
- 自动检测上一条消息中的奶龙语并翻译

## 使用

```bash
npm install
```

### 1. 配置

复制 `.env.example` 为 `.env`，填入配置：

```env
NAPCT_WS_URL=ws://127.0.0.1:3001
NAPCT_HTTP_URL=http://127.0.0.1:3000
BOT_QQ=你的QQ号
```

回复文案可按需修改（`REPLY_DECODE_FAIL`、`REPLY_NOT_FOUND`、`REPLY_TIMEOUT`）。

### 2. 启动 NapCat

下载并启动 [NapCat](https://github.com/NapNeko/NapCatQQ)，确保 OneBot11 配置中启用了 WebSocket 服务端（端口 3001）和 HTTP 服务端（端口 3000）。

### 3. 启动 Bot

```bash
npm run bot
```

## 翻译原理

[视频讲解](https://www.bilibili.com/video/BV1Tk6ZB3EAE)

1. 将文本按 UTF-8 编码为字节
2. 每个字节转换为 4 组 2 位二进制
3. 每组 2 位二进制映射为 4 种零宽字符之一（U+200B=00、U+200C=01、U+200D=10、U+2060=11）
4. 输出为一个「哈」开头 + 零宽字符流 + 若干个「哈」结尾

解密时去掉所有「哈」，每 4 个零宽字符还原 1 个字节，再按 UTF-8 解码。

## 教程

📖 详细教程请访问：[奶龙语官方指南](https://www.bilibili.com/video/BV1Tk6ZB3EAE)

## License

MIT
