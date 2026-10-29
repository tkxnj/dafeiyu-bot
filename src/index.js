// 蓝色大肥鱼 · 入口
// 流程：连上 NapCat（OneBot 11）→ 收到群消息 → 记进记忆 → 判断要不要接话
//       → 调大模型生成回复 → 发回群里。
import fs from 'node:fs';
import path from 'node:path';
import { config, validateConfig } from './config.js';
import { log, warn, error, sleep, rand, toText, extractMessageParts, resolveImageToBase64, sanitizeReply, splitBubbles, truncate } from './util.js';
import { OneBotClient } from './onebot.js';
import { GroupMemory } from './memory.js';
import { TriggerEngine } from './trigger.js';
import { loadPersona, generateReply } from './llm.js';
import { ChatSettings } from './settings.js';
import { Glossary } from './glossary.js';
import { MemoryRetriever } from './rag.js';
import { TOOL_DEFINITIONS, shouldEnableTools } from './tools/definitions.js';
import { ToolExecutor } from './tools/executor.js';
import { MemeManager } from './meme.js';

const MAX_CONCURRENT_REPLIES = 4; // 同时最多生成几条回复，防止一次涌进来一堆消息时打爆接口
// 装不认识的会话里，过滤历史中提过主人/男朋友的消息（主人昵称从 .env 读取，不写死）
const RELATION_HIDE_PATTERN = new RegExp(
  [...config.bot.ownerNames, '主人', '男朋友']
    .filter(Boolean)
    .map((word) => String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'),
  'i',
);
const UNKNOWN_MARKER_RE = /^【看不懂的梗】(.+)$/gm;

function extractUnknownMarkers(raw) {
  const terms = [];
  const clean = String(raw ?? '')
    .replace(UNKNOWN_MARKER_RE, (match, term) => {
      const value = String(term ?? '').trim();
      if (value) terms.push(value);
      return '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { clean, terms };
}
// 固定接梗白名单：只有这三组「X来 → X回」，别的「来」不许乱套
const MEME_CALLS = [
  { call: /token\s*来/i, reply: 'token回' },
  { call: /白饭来/, reply: '白饭回' },
  { call: /寿来/, reply: '寿回' },
];

function detectMemeReply(text) {
  for (const item of MEME_CALLS) {
    if (item.call.test(text)) return item.reply;
  }
  return '';
}

validateConfig();

let persona;
try {
  persona = loadPersona(config.personaFile);
} catch (err) {
  error(err.message);
  process.exit(1);
}

// 写 PID 文件：桌面控制台靠它判断 bot 是否在跑、并精准停止它
const PID_FILE = path.join(config.dataDir, 'bot.pid');
try {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
} catch {
  // 写不了就算了，不影响运行
}
function removePidFile() {
  try {
    fs.rmSync(PID_FILE, { force: true });
  } catch {
    // 忽略
  }
}
process.on('exit', removePidFile);

const client = new OneBotClient(config.onebot);
const memory = new GroupMemory({
  turns: config.behavior.contextTurns,
  file: path.join(config.dataDir, 'memory.json'),
  persist: config.behavior.persistMemory,
});
const trigger = new TriggerEngine(config);
// 控制台「会话设置」：群回复模式、私聊是否回复（存 data/chat-settings.json，2 秒内生效）
const chatSettings = new ChatSettings({ file: path.join(config.dataDir, 'chat-settings.json') });
// 梗词典：模型标出的「看不懂的梗」记在 unknown-memes.json；控制台解释后进 glossary.json
const glossary = new Glossary({
  glossaryFile: path.join(config.dataDir, 'glossary.json'),
  unknownFile: path.join(config.dataDir, 'unknown-memes.json'),
});

// AI 能力升级：RAG 长期记忆检索、工具调用 (Function Calling) 与富表情互动
const memoryRetriever = new MemoryRetriever(config.dbFile);
const toolExecutor = new ToolExecutor({ memoryRetriever });
const memeManager = new MemeManager({ memesDir: config.memesDir });

// 会话统计：记录每个会话收到/发出的时间戳，控制台用来算「近 1 分钟 / 近 1 小时」条数
const STATS_FILE = path.join(config.dataDir, 'reply-stats.json');
const chatStats = { inbound: {}, replies: {} };
let statsTimer = null;
try {
  const rawStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  const hourAgo = Date.now() - 3600 * 1000;
  for (const kind of ['inbound', 'replies']) {
    for (const [key, times] of Object.entries(rawStats?.[kind] ?? {})) {
      if (Array.isArray(times)) {
        chatStats[kind][String(key)] = times.filter((time) => Number.isFinite(time) && time >= hourAgo);
      }
    }
  }
} catch {
  // 没有统计文件就从空开始
}

function recordChatStat(kind, chatKey) {
  const map = chatStats[kind];
  if (!map) return;
  const key = String(chatKey);
  const now = Date.now();
  const hourAgo = now - 3600 * 1000;
  const times = (map[key] ?? []).filter((time) => time >= hourAgo);
  times.push(now);
  map[key] = times.slice(-5000);
  if (!statsTimer) statsTimer = setTimeout(flushChatStats, 800);
}

function flushChatStats() {
  statsTimer = null;
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const hourAgo = Date.now() - 3600 * 1000;
    const output = { updatedAt: new Date().toISOString(), inbound: {}, replies: {} };
    for (const kind of ['inbound', 'replies']) {
      for (const [key, times] of Object.entries(chatStats[kind])) {
        const recent = times.filter((time) => time >= hourAgo);
        if (recent.length > 0) output[kind][key] = recent;
        else delete chatStats[kind][key];
      }
    }
    fs.writeFileSync(STATS_FILE, JSON.stringify(output, null, 2), 'utf8');
  } catch {
    // 统计写失败不影响回复
  }
}

const SEEN_PRIVATE_FILE = path.join(config.dataDir, 'private-seen.json');

const replyingChats = new Set(); // 正在生成回复的会话（群号 / private:QQ号），避免同会话并发
const pendingReplies = new Map(); // chatKey -> 忙时排队、等会儿补答的消息
let activeReplies = 0;
let shuttingDown = false;

function printBanner() {
  log('==============================================');
  log('  蓝色大肥鱼 QQ 群 AI 群友 启动中…');
  log(`  模型：${config.llm.model} @ ${config.llm.baseUrl}`);
  log(`  OneBot：${config.onebot.url}`);
  log('  触发：群聊默认只回 @；私聊默认直接回（具体看控制台「会话设置」）');
  log(`  关键词：${config.behavior.keywords.join('、') || '无'}；随机接话：${Math.round(config.behavior.replyRate * 100)}%`);
  log(`  冷却：${config.behavior.cooldownSeconds} 秒；群聊 ${config.behavior.maxRepliesPerMinute} 条/分、${config.behavior.maxRepliesPerHour} 条/时；私聊 ${config.behavior.maxPrivateRepliesPerMinute} 条/分`);
  log(`  响应加速：微延迟 ${config.behavior.typingDelayMs}ms，气泡间隔 ${config.behavior.bubbleDelayMs}ms，流式传输：${config.behavior.stream ? '开启' : '关闭'}`);
  if (config.bot.allowedGroups.length > 0) {
    log(`  只在指定群工作：${config.bot.allowedGroups.join('、')}`);
  } else {
    log('  未设 ALLOWED_GROUPS：所有群都会接话，测试期建议先去 .env 里填上测试群号');
  }
  log('==============================================');
}

// 记下最近私聊过的人（控制台「私聊设置」里就是列这个），最多保留 100 个
function rememberPrivate(userId, name) {
  try {
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(SEEN_PRIVATE_FILE, 'utf8'));
    } catch {
      data = {};
    }
    if (!data || typeof data !== 'object') data = {};
    data[String(userId)] = { name: String(name || ''), lastAt: new Date().toISOString() };
    const entries = Object.entries(data)
      .sort((a, b) => String(b[1]?.lastAt ?? '').localeCompare(String(a[1]?.lastAt ?? '')))
      .slice(0, 100);
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(SEEN_PRIVATE_FILE, JSON.stringify(Object.fromEntries(entries), null, 2), 'utf8');
  } catch {
    // 记录失败不影响回复
  }
}

async function onReady() {
  log('已连上 NapCat，读取登录信息…');
  try {
    const info = await client.getLoginInfo();
    if (info.qq) {
      trigger.setSelfQq(info.qq);
      const accountText = `${info.nickname || '(无昵称)'}（${info.qq}）`;
      log(`QQ 登录信息：${accountText}`);
      // 另存一份账号信息，桌面控制台清日志后仍能显示
      try {
        fs.writeFileSync(path.join(config.dataDir, 'account.txt'), accountText, 'utf8');
      } catch {
        // 忽略
      }
    }
  } catch (err) {
    warn(`读取登录信息失败（不影响接话，可能只是接口差异）：${err.message}`);
  }
  log('就绪：群里 @ 我，或者私聊我，都会回。');
}

function onEvent(event) {
  if (!event || event.post_type !== 'message') return;
  if (event.message_type !== 'group' && event.message_type !== 'private') return;
  handleIncomingMessage(event).catch((err) => {
    error(`处理消息出错：${err.stack || err.message}`);
  });
}

async function handleIncomingMessage(event) {
  const isPrivate = event.message_type === 'private';
  const userId = String(event.user_id ?? '');
  const sender = event.sender ?? {};
  const name = String(sender.card || sender.nickname || (isPrivate ? `QQ${userId}` : `群友${userId}`));

  // 多模态解析：提取文本、图片列表与表情
  const { text: parsedText, images } = extractMessageParts(event.message, event.raw_message, config.behavior.maxInputChars);
  let text = parsedText;
  if (!text && images.length > 0) {
    text = '[发送了一张图片]';
  }

  let chatKey;
  let autoReply = false;
  let strangerSession = false; // 这个会话是否要装不认识主人（控制台逐会话开关）
  if (isPrivate) {
    chatKey = `private:${userId}`;
    rememberPrivate(userId, name);
    if (!chatSettings.privateEnabled(userId)) {
      log(`[私聊 ${userId}] 控制台里关闭了这个人的私聊，已忽略`);
      return;
    }
    strangerSession = chatSettings.privateHideOwner(userId);
  } else {
    const groupId = String(event.group_id ?? '');
    chatKey = groupId;
    // 群白名单：名单外的消息连记忆都不写，避免收集无关群的聊天记录
    const allowed = config.bot.allowedGroups;
    if (allowed.length > 0 && !allowed.includes(groupId)) return;
    autoReply = chatSettings.groupMode(groupId) === 'auto';
    strangerSession = config.bot.strangerGroups.includes(groupId) || chatSettings.groupHideOwner(groupId);
  }

  if (config.bot.ignoreQqs.includes(userId)) return;

  // 既无文字又无图片的内容不处理
  if (!text && images.length === 0) return;

  // 好感度被动评估（投喂白饭/赞美加分，恶意辱骂减分）
  memoryRetriever.evaluatePassiveAffinity(userId, text);

  // 统计：这条会话收到一条消息
  recordChatStat('inbound', chatKey);

  // 1) 消息进记忆（哪怕这次不接话），这样大肥鱼才有上下文
  const storedText = images.length > 0 && !text.includes('[图片]') ? `${text} [图片]` : text;
  memory.add(chatKey, { name, text: storedText, bot: false });

  // 2) 决策（autoReply：这个群在控制台设成了「直接回复」；memeReply：命中固定接梗白名单）
  const limits = isPrivate ? chatSettings.privateLimits(userId) : chatSettings.groupLimits(chatKey);
  const decision = trigger.shouldReply(event, text, {
    autoReply,
    memeReply: detectMemeReply(text),
    limits,
  });
  if (!decision.reply) return;

  // 3) 同一会话串行；@ 或私聊消息撞上正在生成时，排队补答
  await scheduleReply({ chatKey, isPrivate, userId, name, decision, lastText: text, images, limits, strangerSession });
}

async function scheduleReply({ chatKey, isPrivate, userId, name, decision, lastText, images = [], limits, strangerSession }) {
  const label = isPrivate ? `[私聊 ${userId}]` : `[群 ${chatKey}]`;

  if (replyingChats.has(chatKey)) {
    if (decision.mode === 'at' || decision.mode === 'private' || decision.mode === 'auto' || decision.mode === 'meme') {
      pendingReplies.set(chatKey, { chatKey, isPrivate, userId, name, decision, lastText, images, limits, strangerSession });
      log(`${label} 上一条还在生成，这条先记下，稍后补答`);
    } else {
      log(`${label} 上一条还在生成，这条先放记忆里，不插队`);
    }
    return;
  }

  if (activeReplies >= MAX_CONCURRENT_REPLIES) {
    log(`${label} 当前同时生成中的回复太多，跳过`);
    return;
  }

  replyingChats.add(chatKey);
  activeReplies += 1;
  try {
    // 排队补答也要重新过一遍限额，防止绕过每分钟/每小时上限
    if (!trigger.canReplyNow(chatKey, limits, isPrivate ? 'private' : 'group')) {
      log(`${label} 达到每分钟/每小时上限，这条不再补答`);
      return;
    }
    await replyToChat({ chatKey, isPrivate, userId, name, decision, lastText, images, strangerSession });
  } catch (err) {
    warn(`${label} 回复失败：${err.message}`);
  } finally {
    replyingChats.delete(chatKey);
    activeReplies -= 1;

    // 有排队中的消息，等这一轮收尾后补答
    const queued = pendingReplies.get(chatKey);
    if (queued) {
      pendingReplies.delete(chatKey);
      setImmediate(() => {
        scheduleReply(queued).catch((err) => warn(`${label} 补答失败：${err.message}`));
      });
    }
  }
}

async function replyToChat({ chatKey, isPrivate, userId, name, decision, lastText, images = [], strangerSession = false }) {
  const label = isPrivate ? `[私聊 ${userId}]` : `[群 ${chatKey}]`;

  // 梗：token来→token回、白饭来→白饭回、寿来→寿回（固定接话，不调用大模型）
  if (decision.mode === 'meme') {
    const replyText = decision.reply || '收到。';
    await sleep(rand(150, 400));
    const segments = [{ type: 'text', data: { text: replyText } }];
    if (isPrivate) await client.sendPrivateMsg(userId, segments);
    else await client.sendGroupMsg(chatKey, segments);
    memory.add(chatKey, { name: config.bot.nickname, text: replyText, bot: true });
    trigger.noteReply(chatKey);
    recordChatStat('replies', chatKey);
    log(`${label} 固定接梗：${replyText}`);
    return;
  }

  // 轻量模拟打字前置微延迟（可配置 TYPING_DELAY_MS 控制，默认 75~150ms，彻底消除原 700~1800ms 死等待）
  const typingDelay = Math.max(0, config.behavior.typingDelayMs ?? 150);
  if (typingDelay > 0) {
    await sleep(rand(Math.floor(typingDelay / 2), typingDelay));
  }

  // 多模态：解析图片为 Base64 Data URL
  const resolvedImages = [];
  if (images && images.length > 0) {
    for (const img of images) {
      const b64 = await resolveImageToBase64(img);
      if (b64) resolvedImages.push(b64);
    }
  }

  // RAG 检索长期记忆与群友画像
  const ragContext = memoryRetriever.formatContextForPrompt({
    chatKey,
    userId,
    userName: name,
    currentText: lastText,
  });

  const history = [...memory.history(chatKey)];
  // 装不认识的会话：丢掉历史里以前承认过关系的消息（最后一条当前消息必须保留）
  const promptHistory = strangerSession
    ? history.filter((item, index) => index >= history.length - 1 || !RELATION_HIDE_PATTERN.test(item.text))
    : history;

  // 动态意图路由：纯闲聊/接梗走 Fast Path，仅在需要时携带 Tools，大幅缩减 TTFT 首包耗时
  const toolsToPass = shouldEnableTools(lastText) ? TOOL_DEFINITIONS : [];

  const startedAt = Date.now();
  const rawReply = await generateReply({
    config,
    persona,
    history: promptHistory,
    groupId: chatKey,
    isPrivate,
    peerName: name,
    peerUserId: userId,
    glossaryText: glossary.formatForPrompt(),
    strangerGroup: strangerSession,
    ragContext,
    currentImages: resolvedImages,
    tools: toolsToPass,
    toolExecutor,
  });
  const costMs = Date.now() - startedAt;

  // 模型遇到真看不懂的梗会带一行标记：剥掉标记，把梗记到控制台待解释
  const markerResult = extractUnknownMarkers(rawReply);
  let cleaned = truncate(sanitizeReply(markerResult.clean), config.behavior.maxReplyChars);
  if (!cleaned) {
    cleaned = truncate(sanitizeReply('（OS：这是什么新梗）哦鲸鲸……本鱼没看懂，展开讲讲？'), config.behavior.maxReplyChars);
  }

  const terms = [...markerResult.terms];
  // 兜底：模型没打标记、但回复明显在问「什么梗」时，把最后一条消息记为待解释
  const suspicious = /什么梗|啥梗|没听过这个梗|第一次听这个梗|不懂这个梗/.test(cleaned);
  if (terms.length === 0 && suspicious && lastText && String(lastText).trim().length <= 30) {
    terms.push(String(lastText).trim());
  }
  for (const term of terms) {
    const added = glossary.addUnknown({
      term,
      context: lastText,
      chatKey,
      userName: name,
      userId,
      isPrivate,
    });
    if (added) warn(`${label} 遇到看不懂的梗「${term}」，已记到控制台等你解释`);
  }

  if (!cleaned) {
    log(`${label} 模型没吐出有效内容，这次不回`);
    return;
  }

  const bubbles = config.behavior.multiBubble ? splitBubbles(cleaned, 3) : [cleaned];
  const sentBubbles = [];
  const withAt = !isPrivate && decision.mode === 'at';

  try {
    for (let index = 0; index < bubbles.length; index += 1) {
      const bubbleDelay = Math.max(0, config.behavior.bubbleDelayMs ?? 200);
      if (index > 0 && bubbleDelay > 0) {
        await sleep(rand(Math.floor(bubbleDelay / 2), bubbleDelay));
      }

      const rawBubble = bubbles[index];
      // 解析表情包标签 [表情: xxx] / [CQ:face,id=...]
      const segments = memeManager.parseMessageToSegments(rawBubble);

      // 群聊被 @ 时，回复的第一条气泡先带上 @；私聊不需要
      if (index === 0 && withAt) {
        segments.unshift({ type: 'text', data: { text: ' ' } });
        segments.unshift({ type: 'at', data: { qq: userId } });
      }

      if (isPrivate) await client.sendPrivateMsg(userId, segments);
      else await client.sendGroupMsg(chatKey, segments);
      sentBubbles.push(rawBubble);
    }
  } catch (err) {
    // 多气泡发到一半失败：已经发出去的部分也要记账，避免下一轮重复接话
    if (sentBubbles.length > 0) {
      memory.add(chatKey, { name: config.bot.nickname, text: sentBubbles.join('\n'), bot: true });
      trigger.noteReply(chatKey);
      recordChatStat('replies', chatKey);
    }
    throw err;
  }

  // 4) 自己说的话也记进记忆，下一轮才不会精神分裂
  memory.add(chatKey, { name: config.bot.nickname, text: cleaned, bot: true });
  trigger.noteReply(chatKey);
  recordChatStat('replies', chatKey);

  const reason = decision.mode === 'private'
    ? '私聊'
    : decision.mode === 'auto'
      ? '直接回复'
      : decision.mode === 'at'
        ? '被@'
        : decision.mode === 'keyword'
          ? `关键词「${decision.keyword}」`
          : '随机插话';
  const preview = cleaned.replace(/\n/g, ' / ');
  log(`${label} ${reason}（${costMs}ms，${bubbles.length} 条）：${preview}`);
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`收到 ${signal}，保存记忆并退出…`);
  memory.stop();
  memoryRetriever.store.close();
  flushChatStats();
  client.stop();
  removePidFile();
  setTimeout(() => process.exit(0), 300);
}

async function main() {
  // 配置了 LOG_FILE 的话，每次启动清空旧日志
  if (process.env.LOG_FILE) {
    try {
      const logPath = path.resolve(process.env.LOG_FILE);
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, '', 'utf8');
    } catch {
      // 写不了日志文件不影响运行
    }
  }

  printBanner();

  client.on('ready', onReady);
  client.on('event', onEvent);

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    warn(`未处理的 Promise 异常：${reason?.message ?? reason}`);
  });
  process.on('uncaughtException', (err) => {
    error(`未捕获异常：${err.stack || err.message}`);
  });

  client.start();
}

main().catch((err) => {
  error(`启动失败：${err.stack || err.message}`);
  process.exit(1);
});
