// 零碎工具：日志、延迟、OneBot 消息解析、回复清洗。
import fs from 'node:fs';
import path from 'node:path';

const BOT_TAG = '大肥鱼';

function timestamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function formatArgs(args) {
  return args
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item instanceof Error) return item.stack ?? item.message;
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    })
    .join(' ');
}

// 可选：把日志同时写进文件（.env 里配 LOG_FILE），方便后台运行时排查
function writeFileLine(line) {
  const target = process.env.LOG_FILE;
  if (!target) return;
  try {
    const resolved = path.resolve(target);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.appendFileSync(resolved, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch {
    // 日志文件写不进去就算了，不影响主流程
  }
}

export function log(...args) {
  console.log(`[${timestamp()}] [${BOT_TAG}]`, ...args);
  writeFileLine(`[${BOT_TAG}] ${formatArgs(args)}`);
}

export function warn(...args) {
  console.warn(`[${timestamp()}] [${BOT_TAG}][提醒]`, ...args);
  writeFileLine(`[${BOT_TAG}][提醒] ${formatArgs(args)}`);
}

export function error(...args) {
  console.error(`[${timestamp()}] [${BOT_TAG}][错误]`, ...args);
  writeFileLine(`[${BOT_TAG}][错误] ${formatArgs(args)}`);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function rand(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

// 只保留文字：图片、表情包、语音、视频、文件、@ 等结构一律丢弃（省 token）
function cqToText(text) {
  return text.replace(/\[CQ:[^\]]*\]/g, '');
}

// OneBot 11 的消息可能是「消息段数组」，也可能是 CQ 码字符串，两种都兼容。
// 只提取 text 段；图片、表情包（face/mface/marketface）、语音、视频、文件、@ 等一律忽略。
// maxChars 用于截断超长文本，默认 200 字。
export function toText(message, rawMessage = '', maxChars = 200) {
  let text = '';

  if (Array.isArray(message)) {
    const parts = [];
    for (const segment of message) {
      if (!segment || typeof segment !== 'object') continue;
      const { type, data = {} } = segment;
      if (type === 'text') parts.push(data.text ?? '');
      // 其它类型（image / face / mface / marketface / record / video / file / at ...）全部忽略
    }
    text = parts.join('');
  } else if (typeof message === 'string') {
    text = cqToText(message);
  } else if (typeof rawMessage === 'string') {
    text = cqToText(rawMessage);
  }

  text = text
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 200;
  if (text.length > limit) {
    text = `${text.slice(0, Math.max(1, limit - 1))}…`;
  }
  return text;
}

// 多模态解析：同时提取文本、图片列表与表情
export function extractMessageParts(message, rawMessage = '', maxChars = 200) {
  const images = [];
  const faces = [];
  const textParts = [];

  if (Array.isArray(message)) {
    for (const segment of message) {
      if (!segment || typeof segment !== 'object') continue;
      const { type, data = {} } = segment;
      if (type === 'text') {
        textParts.push(data.text ?? '');
      } else if (type === 'image') {
        const url = data.url || (data.file && /^https?:\/\//i.test(data.file) ? data.file : '');
        const file = data.file || data.path || '';
        images.push({ url, file, path: data.path || '' });
      } else if (type === 'face') {
        if (data.id) faces.push(String(data.id));
      }
    }
  }

  // 兼容 CQ 码解析
  const cqStr = typeof message === 'string' ? message : (typeof rawMessage === 'string' ? rawMessage : '');
  if (cqStr) {
    const imgMatches = cqStr.matchAll(/\[CQ:image,([^\]]+)\]/g);
    for (const m of imgMatches) {
      const params = m[1] || '';
      const urlMatch = params.match(/url=([^,]+)/);
      const fileMatch = params.match(/file=([^,]+)/);
      const url = urlMatch ? urlMatch[1] : (fileMatch && /^https?:\/\//i.test(fileMatch[1]) ? fileMatch[1] : '');
      const file = fileMatch ? fileMatch[1] : '';
      if (url || file) {
        images.push({ url, file });
      }
    }
  }

  let text = textParts.length > 0 ? textParts.join('') : toText(message, rawMessage, maxChars);
  text = text
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 200;
  if (text.length > limit) {
    text = `${text.slice(0, Math.max(1, limit - 1))}…`;
  }

  return { text, images, faces };
}

// 将远程图片或本地图片解析为 base64 Data URL 供多模态大模型理解
export async function resolveImageToBase64(imgObj) {
  if (!imgObj) return null;
  const target = imgObj.url || imgObj.file || imgObj.path;
  if (!target) return null;

  if (target.startsWith('data:image/')) return target;

  // 1. 本地文件
  if (target.startsWith('file://') || /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('/')) {
    try {
      const cleanPath = target.replace(/^file:\/\/\/?/, '');
      const buf = await fs.promises.readFile(cleanPath);
      const ext = path.extname(cleanPath).toLowerCase().replace('.', '') || 'jpeg';
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      return `data:image/${mime};base64,${buf.toString('base64')}`;
    } catch {
      // 本地读取失败
    }
  }

  // 2. 远程 HTTP(S) 图片（2.5 秒超时熔断，防止图片卡住事件循环）
  if (/^https?:\/\//i.test(target)) {
    try {
      const res = await fetch(target, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        // 限制在 4MB 以内，防止打爆内存或超 token
        if (buf.length <= 4 * 1024 * 1024) {
          const contentType = res.headers.get('content-type') || 'image/jpeg';
          return `data:${contentType};base64,${buf.toString('base64')}`;
        }
      }
    } catch {
      // 下载超时或失败，直接回退使用原 URL
    }
    return target;
  }

  return null;
}

// 判断这条消息是不是 @ 了机器人自己
export function isAtMe(message, selfId) {
  const id = String(selfId ?? '');
  if (!id) return false;

  if (Array.isArray(message)) {
    return message.some(
      (segment) => segment?.type === 'at' && String(segment?.data?.qq ?? '') === id,
    );
  }

  if (typeof message === 'string') {
    return message.includes(`[CQ:at,qq=${id}]`) || message.includes(`[CQ:at,qq=${id},`);
  }

  return false;
}

// 清洗大模型输出：去掉它自作主张加的前缀、引号、Markdown 装饰
export function sanitizeReply(text) {
  let reply = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();

  // 去掉代码块围栏（有些模型爱包一层）
  reply = reply.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

  // 去掉 “大肥鱼：”“蓝色大肥鱼:” 这类前缀
  reply = reply.replace(/^(?:蓝色大肥鱼|大肥鱼|肥鱼|本鱼|bot|ai|机器人)\s*[：:]\s*/i, '');

  // QQ 是纯文本，不支持斜体/加粗：把模型可能加的 Markdown 星号/下划线装饰处理掉
  // 1) *（内心OS）* / **（...）** / _（...）_ → （OS：...）
  reply = reply.replace(
    /(?:\*\*|__|\*|_)\s*[（(]\s*([^）)]*?)\s*[）)]\s*(?:\*\*|__|\*|_)/g,
    (match, inner) => {
      const content = String(inner ?? '').replace(/^\s*(?:OS|os|Os)\s*[：:]\s*/, '').trim();
      return content ? `（OS：${content}）` : '';
    },
  );
  // 2) 去掉成对的 **加粗** / __加粗__
  reply = reply.replace(/(?:\*\*|__)([^*_\n]+?)(?:\*\*|__)/g, '$1');
  // 3) 去掉成对的 *斜体* / ＊斜体＊（只在两侧是词边界时，避免误伤算式）
  reply = reply.replace(/(^|[\s（(【])[*＊]([^*＊\n]+?)[*＊](?=$|[\s）)】。！？，,；;])/gm, '$1$2');
  // 4) 清掉残留的星号（数字之间的乘号除外）
  reply = reply.replace(/(?<!\d)[*＊](?!\d)/g, '');

  // 去掉外层引号 / 书名号 / 加粗
  if (
    (reply.startsWith('"') && reply.endsWith('"')) ||
    (reply.startsWith('“') && reply.endsWith('”')) ||
    (reply.startsWith('「') && reply.endsWith('」')) ||
    (reply.startsWith('‘') && reply.endsWith('’'))
  ) {
    reply = reply.slice(1, -1).trim();
  }
  if (reply.length > 4 && reply.startsWith('**') && reply.endsWith('**')) {
    reply = reply.slice(2, -2).trim();
  }

  // 去掉行首的 “- ” “1. ” 之类列表符号（群聊里不需要）
  reply = reply.replace(/^\s*(?:[-*•]|\d+[.、)])\s+/gm, '');

  return reply.trim();
}

// 把回复按换行拆成 2~3 条气泡；没有换行就一条
export function splitBubbles(text, max = 3) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    const single = String(text ?? '').trim();
    return single ? [single] : [];
  }
  if (lines.length <= max) return lines;

  return [...lines.slice(0, max - 1), lines.slice(max - 1).join(' ')];
}

export function truncate(text, max) {
  const value = String(text ?? '').trim();
  if (!max || value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}
