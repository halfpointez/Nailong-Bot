import { getMembersOfGroup } from "./database.ts";

const MORNING = [
  "早安安！太阳公公都起来了！奶龙也起来了！嘿嘿~",
  "呼……奶龙刚睡醒……今天有什么好吃吃吗？",
  "早上好呀！奶龙今天比昨天更厉害了一点点！",
  "早！奶龙今天要喷一个超级大火圈！呼——！……还差一点点……",
  "早安安！小七说早起的龙有虫吃——可是奶龙不想吃虫虫……",
  "早~奶龙做了一个梦，梦到自己会飞了！然后掉下来了。嘿嘿~",
  "天亮啦天亮啦！起床床！不起床床奶龙要来喷你！呼~（小火苗）",
  "早！今天天气好好！奶龙想去山上玩！",
  "呼哈——奶龙起床了！今天肚肚依然很酷酷！",
  "早安安！奶龙今天第一个起床！小七还在睡！嘿嘿懒虫虫！",
  "早~有人投喂奶龙吗？奶龙饿了！",
  "早呀！今天奶龙要数数看——群里有多少人和奶龙一样早？",
];

const NOON = [
  "中午啦！该吃饭饭了！奶龙肚肚已经在叫了！",
  "你们中午吃啥？奶龙什么都想吃！除了苦瓜！",
  "呼……好饱饱……奶龙想睡觉觉了……zzzz……",
  "中午好！奶龙刚刚吃了三个大包子！……其实是空气包子？",
  "该吃饭啦！谁带奶龙去吃好吃吃？奶龙付奶龙币！",
  "午安！奶龙肚肚叫得好大声……你们没听到吗？咕噜咕噜！",
  "中午啦！奶龙想去食堂！——不对，群里有食堂吗？",
  "呼……太阳好大……奶龙要晒成龙干了……",
  "中午好！奶龙今天想吃火锅！小七说夏天不能吃……为什么呀？",
  "吃饱饱的龙来报道！你们吃了吗？没吃奶龙可以再吃一顿陪你！",
];

const NIGHT = [
  "呼噜呼噜……奶龙好困困……大家晚安晚安！",
  "晚上啦！该睡觉觉了！奶龙先睡啦~明天见！",
  "今天玩得好开心！晚安！明天继续和奶龙玩哦~",
  "晚安安！奶龙今天喷了三个火圈！两个都失败了！但还有一个成功了！嘿嘿~",
  "呼……奶龙眼睛快睁不开了……你们也早点睡觉觉！不睡觉觉会变小熊猫！",
  "晚安安！今天有谁还没签到？奶龙提醒你！不签到没币币！",
  "这么晚啦！奶龙去睡觉觉了！小七说小孩子不能熬夜！虽然奶龙不是小孩子——是龙龙！",
  "晚上好！奶龙今天吃了好多好吃吃！现在肚子圆滚滚的！像一个大皮球！",
  "呼噜……奶龙先睡了！你们聊……小声点……不要把奶龙吵醒……zzzz",
  "晚安晚安！睡前喷个小火苗暖暖的被窝……呼~……啊又烧焦了！",
  "晚安安！奶龙要去找小七了！你们不要偷偷说奶龙坏话！奶龙会听到的！",
  "十点啦！该睡觉啦！不睡觉的龙不是好龙！",
];

const LATE_NIGHT = [
  "都快凌晨了！还不睡觉觉！奶龙要打屁屁了！",
  "这么晚了怎么还在！不怕变成熊猫眼吗？奶龙都睡了一觉又醒了！",
  "哇！这个点还有人在！你是夜猫子吗？奶龙也是——不是，奶龙是夜龙龙！",
  "凌晨了喂！再不睡觉小七会骂的——虽然小七自己也在熬夜……",
  "你也是失眠龙吗？奶龙睡不着的时候就去数暴暴龙——一只暴暴龙……两只暴暴龙……zzzz",
  "都这个点了！奶龙其实是梦游中……你看到的不是真的奶龙……是梦游奶龙！",
];

const IDLE_TARGETED = [
  "没人说话……@%s 你在吗？奶龙好无聊！",
  "呼……好安静……@%s 出来陪奶龙玩嘛！",
  "喂喂喂！@%s ！群里只有你了！奶龙只能找你了！",
  "@%s 你知道吗！奶龙刚才学会了新的喷火姿势！想不想看？",
];

const IDLE_GENERAL = [
  "有人吗……奶龙好无聊哦……",
  "怎么都不说话？都变成暴暴龙了吗？",
  "呼……好安静……奶龙要睡着了……zzzz",
  "奶龙数星星……一颗奶龙……两颗奶龙……三颗奶龙……",
];

interface Holiday {
  month: number;
  day: number;
  greetings: string[];
}

const HOLIDAYS: Holiday[] = [
  { month: 1, day: 1, greetings: ["元旦快乐！新年第一天！奶龙给大家拜年啦！嘿嘿~", "新年快乐！今天奶龙是最好的龙！因为新的一年开始了！"] },
  { month: 2, day: 14, greetings: ["今天是情人节！奶龙虽然不知道什么是情——但奶龙想送你们好吃吃！", "情人节快乐！奶龙爱你们！比爱火锅还多一点点！"] },
  { month: 4, day: 1, greetings: ["今天是愚人节！奶龙要骗你们——奶龙其实是暴暴龙！嘿嘿骗到了吗？"] },
  { month: 5, day: 1, greetings: ["劳动节快乐！今天奶龙也要劳动——喷火算劳动吗？算的话奶龙今天喷了！"] },
  { month: 6, day: 1, greetings: ["儿童节！奶龙永远都是小宝宝龙！今天要吃三倍的糖糖！小七不准拦！"] },
  { month: 10, day: 1, greetings: ["国庆节快乐！奶龙是地球龙——虽然是异星来的但奶龙也是中国龙！嘿嘿~"] },
  { month: 12, day: 25, greetings: ["圣诞快乐！小七说今晚有会飞的鹿来送礼物——奶龙也想飞！为什么鹿能飞奶龙不能？"] },
  { month: 12, day: 31, greetings: ["今天是最后一天了！奶龙今年学会了……学会了……喷火！今年也学会了喷火！明年还要学更多！"] },
];

// Lunar-based holidays (approximate solar dates as fallback)
const LUNAR_HOLIDAYS: Holiday[] = [
  // Spring Festival - roughly late Jan to mid Feb. Use placeholder that triggers for ~2 weeks
  { month: 1, day: 20, greetings: ["春节快到啦！奶龙准备了红红包包——里面装了好吃吃！", "过年好！奶龙要放烟花！……比喷火好看一点点！"] },
  { month: 2, day: 10, greetings: ["元宵节！今天吃汤圆！奶龙能吃一大碗！二大碗！三大碗！"] },
  { month: 4, day: 5, greetings: ["清明节吃青团！奶龙今天带了好吃吃去扫墓——其实是去野餐了嘿嘿~"] },
  { month: 5, day: 31, greetings: ["端午安康！今天吃粽子！奶龙喜欢甜的！可是小七喜欢咸的……那奶龙两种都吃！"] },
  { month: 8, day: 15, greetings: ["中秋节快乐！今天的月亮像一个大月饼！奶龙想咬一口！"] },
  { month: 10, day: 6, greetings: ["重阳节！小七说今天要登高——奶龙爬了一百级台阶！然后就趴下了……"] },
  { month: 12, day: 22, greetings: ["冬至！今天吃饺子！奶龙包的饺子像一个个小奶龙！虽然不怎么像……"] },
];

let morningIdx = 0;
let noonIdx = 0;
let nightIdx = 0;
let lateNightIdx = 0;
let idleTargetedIdx = 0;
let idleGeneralIdx = 0;

function next<T>(arr: T[], idx: { value: number }): T {
  const item = arr[idx.value % arr.length];
  idx.value++;
  return item;
}

function holidayGreeting(): string | null {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();

  for (const h of [...HOLIDAYS, ...LUNAR_HOLIDAYS]) {
    if (h.month === m && h.day === d) {
      return h.greetings[Math.floor(Math.random() * h.greetings.length)];
    }
  }
  return null;
}

export function getTimeGreeting(): string | null {
  const holiday = holidayGreeting();
  if (holiday) return holiday;

  const h = new Date().getHours();

  if (h >= 7 && h <= 10)  return next(MORNING, { value: morningIdx } as { value: number });
  if (h >= 11 && h <= 13) return next(NOON, { value: noonIdx } as { value: number });
  if (h >= 22 || h <= 1)  {
    if (h >= 0 && h <= 1) return next(LATE_NIGHT, { value: lateNightIdx } as { value: number });
    if (h >= 22) return next(NIGHT, { value: nightIdx } as { value: number });
  }
  return null;
}

export function getTimeWindow(): string | null {
  const h = new Date().getHours();
  if (h >= 7 && h <= 10) return "morning";
  if (h >= 11 && h <= 13) return "noon";
  if (h >= 22 || h <= 1) return "night";
  return null;
}

export function getIdleMessage(groupId: number): string {
  const members = getMembersOfGroup(groupId);
  if (members.length > 0) {
    const pick = members[Math.floor(Math.random() * Math.min(members.length, 5))];
    const template = next(IDLE_TARGETED, { value: idleTargetedIdx } as { value: number });
    return template.replace("%s", pick.nickname || pick.user_id);
  }
  return next(IDLE_GENERAL, { value: idleGeneralIdx } as { value: number });
}

export function getTimeContext(): string {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const timeStr = `${h}点${m.toString().padStart(2, "0")}分`;

  if (h >= 23 || h <= 4)
    return `现在是凌晨${timeStr}。群里应该没几个人醒着。如果有人跟你说话，问问怎么还不睡觉——但是不要真的骂人，就调皮地说"小心变熊猫眼"之类的。`;
  if (h >= 5 && h <= 7)
    return `现在是早晨${timeStr}。你刚睡醒，还有点迷糊。说话声音可以小一点，带着刚起床的慵懒感。`;
  if (h >= 8 && h <= 11)
    return `现在是上午${timeStr}。你精力充沛，元气满满。适合提议出去玩、问大家吃了什么早饭。`;
  if (h >= 12 && h <= 13)
    return `现在是中午${timeStr}。你肚子有点饿了。可以聊吃的、问大家吃没吃午饭。`;
  if (h >= 14 && h <= 17)
    return `现在是下午${timeStr}。你有点困，可能会突然打个哈欠。说话速度变慢一点。`;
  if (h >= 18 && h <= 21)
    return `现在是晚上${timeStr}。你精神还不错，可以聊聊今天发生了什么有趣的事。`;
  if (h >= 22 && h <= 23)
    return `现在是晚上${timeStr}。你开始犯困了，说话带着睡意。如果有人在，可以提醒他们早点休息。`;

  return `现在是${timeStr}。`;
}
