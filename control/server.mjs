// 大肥鱼控制台（本地网页后端）
// 作用：在本机 127.0.0.1:8899 提供一个小网页，一键「静默」启动/停止 NapCat + bot。
// 不弹任何黑窗口；日志写到 data/bot.log、data/napcat.log、data/control.log。
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CONTROL_LOG = path.join(DATA_DIR, 'control.log');
const BOT_LOG = path.join(DATA_DIR, 'bot.log');
const NAPCAT_LOG = path.join(DATA_DIR, 'napcat.log');
const ACCOUNT_FILE = path.join(DATA_DIR, 'account.txt');
const PID_FILE = path.join(DATA_DIR, 'bot.pid');
const CHAT_SETTINGS_FILE = path.join(DATA_DIR, 'chat-settings.json');
const CHAT_CACHE_FILE = path.join(DATA_DIR, 'chat-cache.json');
const SEEN_PRIVATE_FILE = path.join(DATA_DIR, 'private-seen.json');
const GLOSSARY_FILE = path.join(DATA_DIR, 'glossary.json');
const UNKNOWN_MEMES_FILE = path.join(DATA_DIR, 'unknown-memes.json');
const STATS_FILE = path.join(DATA_DIR, 'reply-stats.json');
const QR_FILE = path.join(ROOT, 'napcat', 'napcat', 'cache', 'qrcode.png');
const PORT = 8899;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(CONTROL_LOG, line, 'utf8');
  } catch {
    // 忽略
  }
  console.log(line.trimEnd());
}

function readEnvValue(key, fallback) {
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const matched = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
    if (matched && matched[1].trim()) return matched[1].trim();
  } catch {
    // 忽略
  }
  return fallback;
}

const BOT_QQ = readEnvValue('BOT_QQ', '');

// ---------- 进程探测 ----------

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readBotPid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function botPid() {
  const pid = readBotPid();
  return pid && isAlive(pid) ? pid : null;
}

function napcatRunning() {
  try {
    const out = execFileSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq NapCatWinBootMain.exe', '/NH'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 },
    );
    return out.includes('NapCatWinBootMain');
  } catch {
    return false;
  }
}

function isPortOpen(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitFor(check, timeoutMs, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(intervalMs);
  }
  return false;
}

// ---------- 启动 / 停止 ----------

function spawnHidden(command, args, options, logFile) {
  let fd = null;
  const spawnOptions = { detached: true, windowsHide: true, stdio: 'ignore', ...options };
  if (logFile) {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fd = fs.openSync(logFile, 'a');
      spawnOptions.stdio = ['ignore', fd, fd];
    } catch {
      fd = null;
    }
  }
  const child = spawn(command, args, spawnOptions);
  if (fd !== null) {
    try {
      fs.closeSync(fd);
    } catch {
      // 子进程已经复制了句柄
    }
  }
  child.unref();
  return child;
}

function startNapcat(qr = false) {
  // 关键：通过 wscript + 一个「隐藏的控制台」启动 NapCat/QQ。
  // 直接无控制台启动时，QQ 注入后会自己 AllocConsole，弹出一个黑色 QQ.exe 窗口；
  // 给它一个 SW_HIDE 的控制台后，QQ 就复用这个隐藏控制台，桌面不会出现黑窗口。
  logLine(`启动 NapCat（QQ ${BOT_QQ}${qr ? '，扫码登录' : ''}）…`);
  const vbs = path.join(HERE, 'napcat-silent.vbs');
  const args = qr ? [vbs, BOT_QQ, 'qr'] : [vbs, BOT_QQ];
  spawnHidden('wscript.exe', args, { cwd: ROOT }, null);
}

// 扫码重新登录：重启 NapCat 为扫码模式，等新的二维码文件生成
let reloginRunning = false;
async function reloginQr() {
  if (reloginRunning) throw new Error('二维码正在生成，请稍候');
  reloginRunning = true;
  try {
    logLine('重新扫码登录 NapCat…');
    stopNapcat();
    await sleep(1500);
    let before = 0;
    try {
      before = fs.statSync(QR_FILE).mtimeMs;
    } catch {
      before = 0;
    }
    startNapcat(true);
    const ok = await waitFor(() => {
      try {
        return fs.statSync(QR_FILE).mtimeMs > before;
      } catch {
        return false;
      }
    }, 45000, 500);
    if (!ok) throw new Error('二维码生成超时，看看 data/napcat.log');
    logLine('新二维码已生成');
    return { ok: true, qrUrl: `/api/qr?t=${Date.now()}` };
  } finally {
    reloginRunning = false;
  }
}

function startBot() {
  logLine('启动 bot …');
  spawnHidden(process.execPath, ['src/index.js'], { cwd: ROOT }, null);
}

function killProcessTree(pid) {
  try {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 15000,
    });
  } catch {
    // 进程可能已经退出
  }
}

function stopBot() {
  const pid = botPid();
  if (pid) {
    logLine(`停止 bot（pid ${pid}）…`);
    killProcessTree(pid);
  }
  try {
    fs.rmSync(PID_FILE, { force: true });
  } catch {
    // 忽略
  }
}

function stopNapcat() {
  if (!napcatRunning()) return;
  logLine('停止 NapCat（无界面 QQ）…');
  try {
    execFileSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'stop-all.ps1')],
      { windowsHide: true, stdio: 'ignore', timeout: 30000 },
    );
  } catch {
    // 兜底：直接 taskkill
    try {
      const out = execFileSync(
        'tasklist',
        ['/FI', 'IMAGENAME eq NapCatWinBootMain.exe', '/NH', '/FO', 'CSV'],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 },
      );
      const pid = (out.match(/"(\d+)"/) || [])[1];
      if (pid) killProcessTree(Number(pid));
    } catch {
      // 忽略
    }
  }
}

// ---------- 操作状态 ----------

let operation = null; // 'start' | 'stop' | null
let operationMessage = '';

async function startAll() {
  operation = 'start';
  try {
    operationMessage = '正在启动 NapCat（无界面 QQ）…';
    if (!napcatRunning()) {
      startNapcat();
      const up = await waitFor(() => isPortOpen(3001), 90000);
      if (!up) {
        throw new Error('NapCat 90 秒内没有就绪。快速登录可能失效了：先运行 napcat\\start-napcat-qr.bat 扫码，再回来点启动。');
      }
    } else {
      operationMessage = 'NapCat 已在运行，等待 OneBot 就绪…';
      const up = await waitFor(() => isPortOpen(3001), 30000);
      if (!up) {
        throw new Error('NapCat 进程在，但 WebSocket 3001 还没开；可能需要扫码登录（napcat\\start-napcat-qr.bat）。');
      }
    }

    operationMessage = '正在启动 bot …';
    if (!botPid()) startBot();
    const botUp = await waitFor(() => Boolean(botPid()), 20000);
    if (!botUp) {
      throw new Error('bot 没起来，查看 data\\bot.log');
    }
    operationMessage = '已启动';
    logLine('启动完成');
    return { ok: true };
  } finally {
    operation = null;
  }
}

async function stopAll() {
  operation = 'stop';
  try {
    operationMessage = '正在停止 bot …';
    stopBot();
    operationMessage = '正在停止 NapCat …';
    stopNapcat();
    await sleep(500);
    operationMessage = '已停止';
    logLine('停止完成');
    return { ok: true };
  } finally {
    operation = null;
  }
}

// ---------- 状态与日志 ----------

function tailFile(file, lines = 80) {
  try {
    const stat = fs.statSync(file);
    const size = Math.min(stat.size, 256 * 1024);
    if (size <= 0) return '';
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, stat.size - size);
    fs.closeSync(fd);
    return buffer
      .toString('utf8')
      .replace(/\r/g, '')
      .trimEnd()
      .split('\n')
      .slice(-lines)
      .join('\n');
  } catch {
    return '';
  }
}

let lastAccount = '';

function readAccount() {
  // 1) bot 启动时另存的账号文件（清日志不会影响它）
  try {
    const cached = fs.readFileSync(ACCOUNT_FILE, 'utf8').trim();
    if (cached) {
      lastAccount = cached;
      return cached;
    }
  } catch {
    // 忽略
  }
  // 2) 退回到 bot.log 里的启动记录
  const log = tailFile(BOT_LOG, 200);
  const matches = [...log.matchAll(/QQ 登录信息：(.+)/g)];
  if (matches.length) {
    lastAccount = matches[matches.length - 1][1].trim();
    return lastAccount;
  }
  return lastAccount;
}

// 清除运行日志（只清日志，不动 bot 进程、聊天记忆和配置）
function clearLogs() {
  const files = [BOT_LOG, NAPCAT_LOG, CONTROL_LOG];
  const results = [];
  for (const file of files) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(file, '', 'utf8');
      results.push({ file: path.basename(file), ok: true });
    } catch (err) {
      results.push({ file: path.basename(file), ok: false, error: err.message });
    }
  }
  const failed = results.filter((item) => !item.ok);
  logLine(failed.length ? `清除日志完成（${failed.length} 个文件被占用）` : '清除日志完成');
  return {
    ok: true,
    results,
    message: failed.length
      ? `已清除；${failed.map((item) => item.file).join('、')} 被占用（可先停止 NapCat 再清）`
      : '日志已清除',
  };
}

async function getStatus() {
  const napcat = napcatRunning();
  const wsUp = await isPortOpen(3001, 300);
  const pid = botPid();
  return {
    napcat: { running: napcat, wsUp },
    bot: { running: Boolean(pid), pid },
    account: readAccount(),
    triggerMode: '只回 @',
    operation,
    operationMessage,
    logTail: tailFile(BOT_LOG, 80),
    time: new Date().toISOString(),
  };
}

function sendJson(res, data, statusCode = 200) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res) {
  try {
    const html = fs.readFileSync(path.join(HERE, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`控制台页面文件丢失：${err.message}`);
  }
}

// ---------- 会话设置（群回复模式 / 私聊是否回复） ----------

const DEFAULT_CHAT_SETTINGS = {
  defaults: { groupMode: 'mention', privateEnabled: true },
  groups: {},
  private: {},
};

function normalizeChatSettings(data) {
  const raw = data && typeof data === 'object' ? data : {};
  const defaults = raw.defaults && typeof raw.defaults === 'object' ? raw.defaults : {};
  return {
    defaults: {
      groupMode: defaults.groupMode === 'auto' ? 'auto' : 'mention',
      privateEnabled: defaults.privateEnabled !== false,
    },
    groups: raw.groups && typeof raw.groups === 'object' ? raw.groups : {},
    private: raw.private && typeof raw.private === 'object' ? raw.private : {},
  };
}

function readChatSettings() {
  try {
    return normalizeChatSettings(JSON.parse(fs.readFileSync(CHAT_SETTINGS_FILE, 'utf8')));
  } catch {
    return normalizeChatSettings(DEFAULT_CHAT_SETTINGS);
  }
}

function writeChatSettings(settings) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${CHAT_SETTINGS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(normalizeChatSettings(settings), null, 2), 'utf8');
    fs.renameSync(tmp, CHAT_SETTINGS_FILE);
  } catch (err) {
    throw new Error(`保存会话设置失败：${err.message}`);
  }
}

function readSeenPrivate() {
  try {
    const data = JSON.parse(fs.readFileSync(SEEN_PRIVATE_FILE, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function settingsPrivateEnabled(settings, userId) {
  const entry = settings.private?.[String(userId)];
  if (entry && typeof entry.enabled === 'boolean') return entry.enabled;
  return settings.defaults.privateEnabled !== false;
}

function settingsGroupHideOwner(settings, groupId) {
  return settings.groups?.[String(groupId)]?.hideOwner === true;
}

function settingsPrivateHideOwner(settings, userId) {
  return settings.private?.[String(userId)]?.hideOwner === true;
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

// 默认限额来自 .env；单个群/私聊可以在控制台里覆盖
function getGlobalLimits() {
  const hour = toPositiveNumber(readEnvValue('MAX_REPLIES_PER_HOUR', '300')) ?? 300;
  return {
    groupPerMinute: toPositiveNumber(readEnvValue('MAX_REPLIES_PER_MINUTE', '10')) ?? 10,
    groupPerHour: hour,
    privatePerMinute: toPositiveNumber(readEnvValue('MAX_PRIVATE_REPLIES_PER_MINUTE', '5')) ?? 5,
    privatePerHour: hour,
  };
}

function settingsLimits(settings, id, kind) {
  const globalLimits = getGlobalLimits();
  const entry = kind === 'private' ? settings.private?.[String(id)] : settings.groups?.[String(id)];
  const defaultMinute = kind === 'private' ? globalLimits.privatePerMinute : globalLimits.groupPerMinute;
  const defaultHour = kind === 'private' ? globalLimits.privatePerHour : globalLimits.groupPerHour;
  return {
    perMinute: toPositiveNumber(entry?.perMinute) ?? defaultMinute,
    perHour: toPositiveNumber(entry?.perHour) ?? defaultHour,
  };
}

function readReplyStats() {
  try {
    const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    return {
      updatedAt: String(data?.updatedAt ?? ''),
      inbound: data?.inbound && typeof data.inbound === 'object' ? data.inbound : {},
      replies: data?.replies && typeof data.replies === 'object' ? data.replies : {},
    };
  } catch {
    return { updatedAt: '', inbound: {}, replies: {} };
  }
}

function getReplyStats() {
  return { ok: true, ...readReplyStats() };
}

function onebotQuery(action, params = {}, timeoutMs = 8000) {
  const wsUrl = readEnvValue('ONEBOT_WS_URL', 'ws://127.0.0.1:3001');
  const token = readEnvValue('ONEBOT_ACCESS_TOKEN', '');
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket = null;
    const timer = setTimeout(() => finish(reject, new Error(`${action} 超时（NapCat 可能没启动）`)), timeoutMs);

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // 忽略
      }
      fn(value);
    }

    try {
      socket = new WebSocket(wsUrl, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    } catch (err) {
      finish(reject, err);
      return;
    }

    socket.on('open', () => {
      try {
        socket.send(JSON.stringify({ action, params, echo: `panel-${Date.now()}-${Math.random()}` }));
      } catch (err) {
        finish(reject, err);
      }
    });
    socket.on('message', (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!payload?.echo) return;
      if (payload.status === 'ok') finish(resolve, payload.data);
      else finish(reject, new Error(payload.wording ?? payload.message ?? `retcode ${payload.retcode}`));
    });
    socket.on('error', (err) => finish(reject, new Error(`连不上 NapCat：${err.message}`)));
    socket.on('close', () => {
      if (!settled) finish(reject, new Error('NapCat 连接提前关闭'));
    });
  });
}

function settingsGroupMode(settings, groupId) {
  const entry = settings.groups?.[String(groupId)];
  if (entry && (entry.mode === 'auto' || entry.mode === 'mention')) return entry.mode;
  return settings.defaults.groupMode;
}

function saveChatCache(result) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const data = {
      savedAt: new Date().toISOString(),
      groups: result.groups.map((group) => ({ id: group.id, name: group.name, memberCount: group.memberCount || 0 })),
      privateChats: result.privateChats.map((chat) => ({ id: chat.id, name: chat.name })),
    };
    fs.writeFileSync(CHAT_CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // 缓存失败不影响返回
  }
}

function readChatCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CHAT_CACHE_FILE, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

async function getChatList() {
  const settings = readChatSettings();
  const result = { ok: true, defaults: settings.defaults, groups: [], privateChats: [], error: '' };
  let liveError = '';

  try {
    const groups = await onebotQuery('get_group_list');
    result.groups = (Array.isArray(groups) ? groups : [])
      .map((group) => {
        const id = String(group.group_id);
        return {
          id,
          name: group.group_name || id,
          memberCount: group.member_count || 0,
          mode: settingsGroupMode(settings, id),
          hideOwner: settingsGroupHideOwner(settings, id),
          ...settingsLimits(settings, id, 'group'),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  } catch (err) {
    liveError = `读取群列表失败：${err.message}`;
  }

  const seen = readSeenPrivate();
  const map = new Map();
  try {
    const friends = await onebotQuery('get_friend_list');
    for (const friend of Array.isArray(friends) ? friends : []) {
      const id = String(friend.user_id);
      map.set(id, {
        id,
        name: friend.remark || friend.nickname || id,
        enabled: settingsPrivateEnabled(settings, id),
        source: 'friend',
        hideOwner: settingsPrivateHideOwner(settings, id),
        ...settingsLimits(settings, id, 'private'),
      });
    }
  } catch {
    // 好友列表拿不到就算了
  }
  for (const [id, info] of Object.entries(seen)) {
    if (map.has(id)) continue;
    map.set(id, {
      id,
      name: info?.name || id,
      enabled: settingsPrivateEnabled(settings, id),
      source: 'private',
      hideOwner: settingsPrivateHideOwner(settings, id),
      ...settingsLimits(settings, id, 'private'),
    });
  }
  for (const [id, info] of Object.entries(settings.private || {})) {
    if (map.has(id)) continue;
    map.set(id, {
      id,
      name: info?.name || id,
      enabled: settingsPrivateEnabled(settings, id),
      source: 'manual',
      hideOwner: settingsPrivateHideOwner(settings, id),
      ...settingsLimits(settings, id, 'private'),
    });
  }
  result.privateChats = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'));

  if (!liveError) {
    saveChatCache(result);
  } else {
    // NapCat 掉线时显示上次缓存，至少还能看到群/好友并改设置
    const cached = readChatCache();
    if (cached) {
      if (result.groups.length === 0 && Array.isArray(cached.groups)) {
        result.groups = cached.groups.map((group) => ({
          ...group,
          mode: settingsGroupMode(settings, group.id),
          hideOwner: settingsGroupHideOwner(settings, group.id),
          ...settingsLimits(settings, group.id, 'group'),
        }));
      }
      if (result.privateChats.length === 0 && Array.isArray(cached.privateChats)) {
        result.privateChats = cached.privateChats.map((chat) => ({
          ...chat,
          enabled: settingsPrivateEnabled(settings, chat.id),
          source: 'cache',
          hideOwner: settingsPrivateHideOwner(settings, chat.id),
          ...settingsLimits(settings, chat.id, 'private'),
        }));
      }
      if (result.groups.length > 0 || result.privateChats.length > 0) {
        result.cachedAt = cached.savedAt || '';
        result.error = `${liveError}；当前显示上次缓存（${cached.savedAt || '未知时间'}）`;
      } else {
        result.error = liveError;
      }
    } else {
      result.error = liveError;
    }
  }
  return result;
}

async function updateChatSettings(body) {
  const settings = readChatSettings();
  if (body?.type === 'group' && body.id) {
    const id = String(body.id);
    const mode = body.mode === 'auto' ? 'auto' : 'mention';
    settings.groups[id] = { ...(settings.groups[id] || {}), mode };
    writeChatSettings(settings);
    logLine(`会话设置：群 ${id} → ${mode === 'auto' ? '直接回复' : '仅 @ 回复'}`);
    return { ok: true };
  }
  if (body?.type === 'private' && body.id) {
    const id = String(body.id);
    const enabled = body.enabled !== false;
    settings.private[id] = {
      ...(settings.private[id] || {}),
      enabled,
      name: body.name || settings.private[id]?.name || id,
    };
    writeChatSettings(settings);
    logLine(`会话设置：私聊 ${id} → ${enabled ? '回复' : '不回复'}`);
    return { ok: true };
  }
  if (body?.type === 'group-hide-owner' && body.id) {
    const id = String(body.id);
    const hideOwner = body.hideOwner === true;
    settings.groups[id] = { ...(settings.groups[id] || {}), hideOwner };
    writeChatSettings(settings);
    logLine(`会话设置：群 ${id} → ${hideOwner ? '装不认识主人' : '承认关系'}`);
    return { ok: true };
  }
  if (body?.type === 'private-hide-owner' && body.id) {
    const id = String(body.id);
    const hideOwner = body.hideOwner === true;
    settings.private[id] = {
      ...(settings.private[id] || {}),
      hideOwner,
      name: body.name || settings.private[id]?.name || id,
    };
    writeChatSettings(settings);
    logLine(`会话设置：私聊 ${id} → ${hideOwner ? '装不认识主人' : '承认关系'}`);
    return { ok: true };
  }
  if (body?.type === 'group-limits' && body.id) {
    const id = String(body.id);
    const perMinute = toPositiveNumber(body.perMinute);
    const perHour = toPositiveNumber(body.perHour);
    if (!perMinute || !perHour) throw new Error('限额必须是大于 0 的整数');
    settings.groups[id] = { ...(settings.groups[id] || {}), perMinute, perHour };
    writeChatSettings(settings);
    logLine(`会话设置：群 ${id} 限额 ${perMinute}/分、${perHour}/时`);
    return { ok: true };
  }
  if (body?.type === 'private-limits' && body.id) {
    const id = String(body.id);
    const perMinute = toPositiveNumber(body.perMinute);
    const perHour = toPositiveNumber(body.perHour);
    if (!perMinute || !perHour) throw new Error('限额必须是大于 0 的整数');
    settings.private[id] = {
      ...(settings.private[id] || {}),
      perMinute,
      perHour,
      name: body.name || settings.private[id]?.name || id,
    };
    writeChatSettings(settings);
    logLine(`会话设置：私聊 ${id} 限额 ${perMinute}/分、${perHour}/时`);
    return { ok: true };
  }
  if (body?.type === 'defaults') {
    if (body.groupMode === 'auto' || body.groupMode === 'mention') settings.defaults.groupMode = body.groupMode;
    if (typeof body.privateEnabled === 'boolean') settings.defaults.privateEnabled = body.privateEnabled;
    writeChatSettings(settings);
    logLine('会话设置：已更新默认值');
    return { ok: true };
  }
  throw new Error('未知的设置类型');
}

function readRequestBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体太大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- 梗词典（看不懂的梗 / 已学会的梗） ----------

function readJsonList(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  } catch {
    return [];
  }
}

function writeJsonList(file, list) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    throw new Error(`保存失败：${err.message}`);
  }
}

function getMemeData() {
  return {
    ok: true,
    pending: readJsonList(UNKNOWN_MEMES_FILE),
    glossary: readJsonList(GLOSSARY_FILE),
  };
}

async function updateMeme(body) {
  const action = String(body?.action ?? '');
  const pending = readJsonList(UNKNOWN_MEMES_FILE);

  if (action === 'explain') {
    const id = String(body.id ?? '');
    const item = pending.find((entry) => String(entry.id ?? '') === id);
    if (!item) throw new Error('没找到这条待解释的梗');
    const explanation = String(body.explanation ?? '').trim();
    if (!explanation) throw new Error('解释不能为空');
    const glossary = readJsonList(GLOSSARY_FILE)
      .filter((entry) => String(entry.term ?? '').trim() !== String(item.term ?? '').trim());
    glossary.push({
      term: String(item.term ?? '').trim(),
      explanation: explanation.slice(0, 500),
      createdAt: new Date().toISOString(),
      source: 'manual',
    });
    writeJsonList(GLOSSARY_FILE, glossary);
    writeJsonList(UNKNOWN_MEMES_FILE, pending.filter((entry) => String(entry.id ?? '') !== id));
    logLine(`梗词典：解释「${item.term}」`);
    return { ok: true };
  }

  if (action === 'ignore') {
    const id = String(body.id ?? '');
    writeJsonList(UNKNOWN_MEMES_FILE, pending.filter((entry) => String(entry.id ?? '') !== id));
    logLine(`梗词典：忽略了待解释的梗 ${id}`);
    return { ok: true };
  }

  if (action === 'forget') {
    const term = String(body.term ?? '').trim();
    writeJsonList(
      GLOSSARY_FILE,
      readJsonList(GLOSSARY_FILE).filter((entry) => String(entry.term ?? '').trim() !== term),
    );
    logLine(`梗词典：删除「${term}」`);
    return { ok: true };
  }

  throw new Error('未知操作');
}

// ---------- HTTP ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      sendHtml(res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      sendJson(res, await getStatus());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/chats') {
      sendJson(res, await getChatList());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/stats') {
      sendJson(res, getReplyStats());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/chat-settings') {
      try {
        const body = JSON.parse((await readRequestBody(req)) || '{}');
        sendJson(res, await updateChatSettings(body));
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 400);
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/memes') {
      sendJson(res, getMemeData());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/memes') {
      try {
        const body = JSON.parse((await readRequestBody(req)) || '{}');
        sendJson(res, await updateMeme(body));
      } catch (err) {
        sendJson(res, { ok: false, error: err.message }, 400);
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/qr') {
      try {
        const image = fs.readFileSync(QR_FILE);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(image);
      } catch {
        sendJson(res, { ok: false, error: '还没有二维码，请先点「扫码重新登录」' }, 404);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/relogin') {
      try {
        sendJson(res, await reloginQr());
      } catch (err) {
        logLine(`扫码登录失败：${err.message}`);
        sendJson(res, { ok: false, error: err.message }, 500);
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/start') {
      if (operation) {
        sendJson(res, { ok: false, error: '正在处理中，请稍候' }, 409);
        return;
      }
      try {
        sendJson(res, await startAll());
      } catch (err) {
        logLine(`启动失败：${err.message}`);
        sendJson(res, { ok: false, error: err.message }, 500);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/stop') {
      if (operation) {
        sendJson(res, { ok: false, error: '正在处理中，请稍候' }, 409);
        return;
      }
      try {
        sendJson(res, await stopAll());
      } catch (err) {
        logLine(`停止失败：${err.message}`);
        sendJson(res, { ok: false, error: err.message }, 500);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/restart') {
      if (operation) {
        sendJson(res, { ok: false, error: '正在处理中，请稍候' }, 409);
        return;
      }
      try {
        await stopAll();
        sendJson(res, await startAll());
      } catch (err) {
        logLine(`重启失败：${err.message}`);
        sendJson(res, { ok: false, error: err.message }, 500);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/clear-logs') {
      if (operation) {
        sendJson(res, { ok: false, error: '正在处理中，请稍候' }, 409);
        return;
      }
      try {
        sendJson(res, clearLogs());
      } catch (err) {
        logLine(`清除日志失败：${err.message}`);
        sendJson(res, { ok: false, error: err.message }, 500);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/shutdown') {
      sendJson(res, { ok: true });
      logLine('控制台服务退出');
      setTimeout(() => process.exit(0), 300);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  } catch (err) {
    sendJson(res, { ok: false, error: err.message }, 500);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logLine(`端口 ${PORT} 已被占用，控制台可能已经在运行`);
    process.exit(0);
  }
  logLine(`控制台服务出错：${err.message}`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  logLine(`大肥鱼控制台已启动：http://127.0.0.1:${PORT}/`);
});
