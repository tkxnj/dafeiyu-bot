// 本地全链路自测：npm run selftest
// 不连真 QQ、不花 API 钱：用模拟的 OneBot WebSocket 服务端 + 模拟的 OpenAI 兼容接口，
// 验证「收消息 → 触发判断 → 调大模型 → 发出去」整条链路：
// 群聊里被 @ 会回；私聊里不用 @ 也会回。
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 自测用独立临时数据目录，避免把真实 bot 的 data/（pid、账号、日志、记忆）搞脏
const TEST_DATA_DIR = path.join(process.env.TEMP || process.env.TMP || '.', 'fatfish-selftest-data');
const LLM_PORT = 18080;
const ONEBOT_PORT = 18001;
const SELF_QQ = '10000001';
const GROUP_ID = 999888;
const USER_ID = 123456;
const PRIVATE_USER_ID = 654321;
const FIXED_REPLY = '收到，本鱼在。';

let botProcess = null;
let finished = false;
let timer = null;

function finish(code, message) {
  if (finished) return;
  finished = true;
  if (timer) clearTimeout(timer);
  if (message) console.log(message);
  try {
    botProcess?.kill();
  } catch {
    // 忽略
  }
  try {
    llmServer.close();
  } catch {
    // 忽略
  }
  try {
    wss.close();
  } catch {
    // 忽略
  }
  setTimeout(() => process.exit(code), 150);
}

// ---------- 模拟大模型接口（OpenAI 兼容） ----------
const llmServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    if (!String(req.url).endsWith('/chat/completions')) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    let payload = {};
    try {
      payload = JSON.parse(body);
    } catch {
      // 忽略
    }
    const last = payload?.messages?.at(-1)?.content ?? '';
    console.log(`[selftest] 模拟大模型收到请求（上下文 ${payload?.messages?.length ?? 0} 条，最后一条：${String(last).slice(0, 40)}）`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: FIXED_REPLY } }] }));
  });
});

// ---------- 模拟 OneBot 11 服务端 ----------
const wss = new WebSocketServer({ port: ONEBOT_PORT, host: '127.0.0.1' });

wss.on('connection', (socket) => {
  console.log('[selftest] bot 已连上模拟 OneBot');

  socket.on('message', (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (payload.action === 'get_login_info') {
      socket.send(JSON.stringify({
        status: 'ok', retcode: 0, echo: payload.echo,
        data: { user_id: Number(SELF_QQ), nickname: '测试大鱼' },
      }));
      // 拿到登录信息后，模拟群里有人 @ 它
      setTimeout(() => {
        socket.send(JSON.stringify({
          time: Math.floor(Date.now() / 1000),
          self_id: Number(SELF_QQ),
          post_type: 'message',
          message_type: 'group',
          sub_type: 'normal',
          group_id: GROUP_ID,
          user_id: USER_ID,
          message: [
            { type: 'at', data: { qq: SELF_QQ } },
            { type: 'text', data: { text: ' 在吗' } },
          ],
          raw_message: `[CQ:at,qq=${SELF_QQ}] 在吗`,
          sender: { user_id: USER_ID, nickname: '测试群友', card: '测试群友', role: 'member' },
        }));
      }, 300);
      return;
    }

    if (payload.action === 'send_group_msg') {
      const segments = payload.params?.message;
      const text = Array.isArray(segments)
        ? segments.filter((s) => s.type === 'text').map((s) => s.data.text).join('')
        : String(segments ?? '');
      const hasAt = Array.isArray(segments)
        && segments.some((s) => s.type === 'at' && String(s.data.qq) === String(USER_ID));
      console.log(`[selftest] bot 调用了 send_group_msg：${JSON.stringify(segments)}`);

      socket.send(JSON.stringify({ status: 'ok', retcode: 0, echo: payload.echo, data: { message_id: 1 } }));

      if (!text.includes('本鱼')) {
        finish(1, `[selftest] FAIL：群聊回复内容不对（${text}）`);
        return;
      }
      if (!hasAt) {
        finish(1, '[selftest] FAIL：群聊被 @ 的回复里没有带 at 段');
        return;
      }

      // 群聊验证通过后，模拟有人私聊它（私聊不需要 @）
      setTimeout(() => {
        socket.send(JSON.stringify({
          time: Math.floor(Date.now() / 1000),
          self_id: Number(SELF_QQ),
          post_type: 'message',
          message_type: 'private',
          sub_type: 'friend',
          user_id: PRIVATE_USER_ID,
          message: [{ type: 'text', data: { text: '在干嘛呢' } }],
          raw_message: '在干嘛呢',
          sender: { user_id: PRIVATE_USER_ID, nickname: '私聊群友' },
        }));
      }, 300);
      return;
    }

    if (payload.action === 'send_private_msg') {
      const segments = payload.params?.message;
      const text = Array.isArray(segments)
        ? segments.filter((s) => s.type === 'text').map((s) => s.data.text).join('')
        : String(segments ?? '');
      const hasAt = Array.isArray(segments) && segments.some((s) => s.type === 'at');
      console.log(`[selftest] bot 调用了 send_private_msg：${JSON.stringify(segments)}`);

      socket.send(JSON.stringify({ status: 'ok', retcode: 0, echo: payload.echo, data: { message_id: 2 } }));

      if (!text.includes('本鱼')) {
        finish(1, `[selftest] FAIL：私聊回复内容不对（${text}）`);
        return;
      }
      if (hasAt) {
        finish(1, '[selftest] FAIL：私聊回复里不应该带 at 段');
        return;
      }
      finish(0, '\n[selftest] PASS ✅ 群聊 @ 回复 + 私聊直接回复 全链路正常');
      return;
    }

    // 其它接口一律返回成功
    socket.send(JSON.stringify({ status: 'ok', retcode: 0, echo: payload.echo, data: {} }));
  });
});

wss.on('listening', () => {
  console.log(`[selftest] 模拟 OneBot 已监听 127.0.0.1:${ONEBOT_PORT}`);
  startBot();
});

wss.on('error', (err) => finish(1, `[selftest] FAIL：模拟 OneBot 启动失败：${err.message}`));

llmServer.on('error', (err) => finish(1, `[selftest] FAIL：模拟大模型启动失败：${err.message}`));

llmServer.listen(LLM_PORT, '127.0.0.1', () => {
  console.log(`[selftest] 模拟大模型已监听 127.0.0.1:${LLM_PORT}`);
});

function startBot() {
  const env = {
    ...process.env,
    ONEBOT_WS_URL: `ws://127.0.0.1:${ONEBOT_PORT}`,
    ONEBOT_ACCESS_TOKEN: 'selftest-token',
    LLM_BASE_URL: `http://127.0.0.1:${LLM_PORT}/v1`,
    LLM_API_KEY: 'selftest-key',
    LLM_MODEL: 'selftest-model',
    LLM_TIMEOUT_MS: '15000',
    BOT_QQ: SELF_QQ,
    BOT_NICKNAME: '测试大鱼',
    ALLOWED_GROUPS: '',
    IGNORE_QQS: '',
    REPLY_RATE: '0',
    COOLDOWN_SECONDS: '1',
    MAX_REPLIES_PER_HOUR: '10',
    CONTEXT_TURNS: '8',
    PERSIST_MEMORY: 'false',
    QUIET_HOURS: '',
    DATA_DIR: TEST_DATA_DIR,
    LOG_FILE: path.join(TEST_DATA_DIR, 'bot.log'),
  };

  botProcess = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  botProcess.stdout.on('data', (chunk) => process.stdout.write(`[bot] ${chunk}`));
  botProcess.stderr.on('data', (chunk) => process.stderr.write(`[bot] ${chunk}`));
  botProcess.on('exit', (code) => {
    if (!finished) finish(1, `[selftest] FAIL：bot 提前退出（code ${code}）`);
  });

  timer = setTimeout(() => {
    finish(1, '[selftest] FAIL：20 秒内没有走完链路（看上面 bot 日志）');
  }, 30000);
}
