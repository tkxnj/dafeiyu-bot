// 读取 .env 配置，集中成 config 对象。
// 其它模块只从这里拿配置，不直接摸 process.env。
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

function readString(name, fallback = '') {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const value = raw.trim();
  return value === '' ? fallback : value;
}

function readNumber(name, fallback) {
  const text = readString(name);
  if (text === '') return fallback;
  const value = Number(text);
  if (!Number.isFinite(value)) {
    console.warn(`[配置] ${name}="${text}" 不是数字，已使用默认值 ${fallback}`);
    return fallback;
  }
  return value;
}

function readInt(name, fallback) {
  return Math.round(readNumber(name, fallback));
}

function readBool(name, fallback) {
  const text = readString(name).toLowerCase();
  if (text === '') return fallback;
  return ['1', 'true', 'yes', 'on', '开'].includes(text);
}

// 支持 "a,b,c" / "a，b，c" / 空格分隔
function readList(name, fallback = []) {
  const text = readString(name);
  if (text === '') return fallback;
  return text
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// "1-7" / "23-6"，跨零点也支持；格式不对就认为没开安静时段
function readHourRange(name) {
  const text = readString(name);
  if (text === '') return null;
  const matched = text.match(/^(\d{1,2})\s*[-~到]\s*(\d{1,2})$/);
  if (!matched) {
    console.warn(`[配置] ${name}="${text}" 格式不对，已忽略（正确写法示例：1-7 或 23-6）`);
    return null;
  }
  const start = Number(matched[1]);
  const end = Number(matched[2]);
  if (start > 23 || end > 23) {
    console.warn(`[配置] ${name}="${text}" 小时数超出 0~23，已忽略`);
    return null;
  }
  return { start, end };
}

// 关键词特殊处理：显式留空表示「不用关键词，只回 @」
function readKeywords() {
  const raw = process.env.TRIGGER_KEYWORDS;
  if (raw === undefined) return ['大肥鱼', '肥鱼'];
  const text = raw.trim();
  if (text === '' || text === '-' || text === '无' || text.toLowerCase() === 'none') return [];
  return text
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 数据目录：默认项目下的 data/；可用 DATA_DIR 覆盖（自测脚本用临时目录，避免污染真实数据）
function readDataDir() {
  const custom = readString('DATA_DIR', '');
  if (!custom) return path.join(ROOT_DIR, 'data');
  return path.isAbsolute(custom) ? custom : path.resolve(ROOT_DIR, custom);
}

export const config = {
  onebot: {
    // NapCat 的 WebSocket 服务地址；bot 主动去连它
    url: readString('ONEBOT_WS_URL', 'ws://127.0.0.1:3001'),
    token: readString('ONEBOT_ACCESS_TOKEN', ''),
  },
  llm: {
    // 任何 OpenAI 兼容接口都可以：DeepSeek、硅基流动、Ollama 等
    baseUrl: readString('LLM_BASE_URL', 'https://api.deepseek.com/v1'),
    apiKey: readString('LLM_API_KEY', ''),
    model: readString('LLM_MODEL', 'deepseek-chat'),
    temperature: readNumber('LLM_TEMPERATURE', 1.1),
    maxTokens: readInt('LLM_MAX_TOKENS', 240),
    timeoutMs: readInt('LLM_TIMEOUT_MS', 60000),
  },
  bot: {
    nickname: readString('BOT_NICKNAME', '蓝色大肥鱼'),
    selfQq: readString('BOT_QQ', ''),
    allowedGroups: readList('ALLOWED_GROUPS'),
    ignoreQqs: readList('IGNORE_QQS'),
    // 长期记忆：主人 / 讨厌的人（按昵称或 QQ 号匹配）
    ownerNames: readList('OWNER_NAMES', []),
    nemesisNames: readList('NEMESIS_NAMES', ['xxxi']),
    // 这些群里要假装不认识主人/男朋友（班级群等）；控制台也能单独开关
    strangerGroups: readList('STRANGER_GROUPS'),
  },
  behavior: {
    keywords: readKeywords(),
    replyRate: readNumber('REPLY_RATE', 0.06),
    cooldownSeconds: readInt('COOLDOWN_SECONDS', 20),
    maxRepliesPerHour: readInt('MAX_REPLIES_PER_HOUR', 300),
    maxRepliesPerMinute: readInt('MAX_REPLIES_PER_MINUTE', 10),
    maxPrivateRepliesPerMinute: readInt('MAX_PRIVATE_REPLIES_PER_MINUTE', 5),
    contextTurns: readInt('CONTEXT_TURNS', 16),
    maxInputChars: readInt('MAX_INPUT_CHARS', 200),
    maxContextChars: readInt('MAX_CONTEXT_CHARS', 2000),
    maxReplyChars: readInt('MAX_REPLY_CHARS', 160),
    multiBubble: readBool('MULTI_BUBBLE', true),
    quietHours: readHourRange('QUIET_HOURS'),
    persistMemory: readBool('PERSIST_MEMORY', true),
  },
  personaFile: path.join(ROOT_DIR, 'prompts', 'persona.md'),
  dataDir: readDataDir(),
};

// 启动前检查关键配置，缺东西就直接把话说清楚，别让它带病跑
export function validateConfig() {
  const problems = [];

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    problems.push(`Node.js 版本太低（当前 v${process.versions.node}），需要 20 或更高；去 https://nodejs.org/zh-cn 装 LTS 版本`);
  }

  if (!config.llm.apiKey) {
    problems.push('LLM_API_KEY 是空的 —— 去 .env 里填大模型 API Key（DeepSeek 去 https://platform.deepseek.com/api_keys 申请）');
  }

  if (!/^wss?:\/\//i.test(config.onebot.url)) {
    problems.push(`ONEBOT_WS_URL="${config.onebot.url}" 不是合法的 ws:// 或 wss:// 地址`);
  }

  if (config.behavior.replyRate < 0 || config.behavior.replyRate > 1) {
    problems.push(`REPLY_RATE=${config.behavior.replyRate} 超出 0~1 范围（0.06 表示 6%）`);
  }

  if (config.behavior.contextTurns < 2) {
    problems.push(`CONTEXT_TURNS=${config.behavior.contextTurns} 太小了，至少给 2 条上下文`);
  }

  if (!Number.isFinite(config.behavior.maxRepliesPerHour) || config.behavior.maxRepliesPerHour <= 0) {
    problems.push(`MAX_REPLIES_PER_HOUR=${config.behavior.maxRepliesPerHour} 必须大于 0；不想让它接话请把 REPLY_RATE 设 0 并清空 TRIGGER_KEYWORDS`);
  }

  if (!Number.isFinite(config.behavior.maxRepliesPerMinute) || config.behavior.maxRepliesPerMinute <= 0) {
    problems.push(`MAX_REPLIES_PER_MINUTE=${config.behavior.maxRepliesPerMinute} 必须大于 0`);
  }

  if (!Number.isFinite(config.behavior.maxPrivateRepliesPerMinute) || config.behavior.maxPrivateRepliesPerMinute <= 0) {
    problems.push(`MAX_PRIVATE_REPLIES_PER_MINUTE=${config.behavior.maxPrivateRepliesPerMinute} 必须大于 0`);
  }

  if (config.behavior.cooldownSeconds < 0) {
    problems.push(`COOLDOWN_SECONDS=${config.behavior.cooldownSeconds} 不能是负数`);
  }

  // 白名单里混进了非数字（比如把群名填进去了），不致命，但基本不会生效
  const badGroups = config.bot.allowedGroups.filter((item) => !/^\d+$/.test(item));
  if (badGroups.length > 0) {
    console.warn(`[配置] ALLOWED_GROUPS 里有不像群号的值：${badGroups.join('、')}（群号应该是纯数字）`);
  }

  if (problems.length > 0) {
    console.error('\n[大肥鱼] 配置有点问题，先修一下再启动：');
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error('  （检查一下项目根目录下的 .env 文件）\n');
    process.exit(1);
  }
}
