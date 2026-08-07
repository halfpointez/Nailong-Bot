import { loadConfig } from "./config.ts";
import { OneBotClient } from "./onebot.ts";
import { createHandler } from "./handler.ts";
import { initDb } from "./database.ts";
import { startScheduler } from "./scheduler.ts";

const config = loadConfig();

initDb(config.nailongResourceDir)
  .then(() => {
    const client = new OneBotClient(config);
    client.onGroupMessage(createHandler(client, config));

    client
      .connect()
      .then(() => {
        console.log(`[bot] Nailong Bot 已启动 (QQ: ${config.botQQ})`);
        startScheduler(client);
      })
      .catch((err) => {
        console.error("[bot] 启动失败:", err.message);
        process.exit(1);
      });
  })
  .catch((err) => {
    console.error("[bot] 数据库初始化失败:", err.message);
    process.exit(1);
  });
