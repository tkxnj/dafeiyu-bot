// 账号小检查：npm run check
// 连到正在运行的 NapCat，打印登录账号、在哪些群、好友数量。
// 用来确认「机器人到底登没登、进没进群」。
import { WebSocket } from 'ws';
import { config } from '../src/config.js';

const ws = new WebSocket(config.onebot.url, {
  headers: config.onebot.token ? { Authorization: `Bearer ${config.onebot.token}` } : undefined,
});

let seq = 0;
const pending = new Map();

function call(action, params = {}) {
  return new Promise((resolve, reject) => {
    const echo = `check-${++seq}`;
    pending.set(echo, { resolve, reject });
    ws.send(JSON.stringify({ action, params, echo }));
    setTimeout(() => {
      if (pending.has(echo)) {
        pending.delete(echo);
        reject(new Error(`${action} 超时`));
      }
    }, 8000);
  });
}

ws.on('message', (raw) => {
  let payload;
  try {
    payload = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (!payload?.echo || !pending.has(payload.echo)) return;
  const waiter = pending.get(payload.echo);
  pending.delete(payload.echo);
  if (payload.status === 'ok') waiter.resolve(payload.data);
  else waiter.reject(new Error(payload.wording ?? payload.message ?? `retcode ${payload.retcode}`));
});

ws.on('open', async () => {
  try {
    const info = await call('get_login_info');
    console.log(`登录账号：${info.nickname}（${info.user_id}）`);

    const groups = await call('get_group_list');
    console.log(`所在群：${groups.length} 个`);
    for (const group of groups) {
      console.log(`  - ${group.group_name}（${group.group_id}）`);
    }

    const friends = await call('get_friend_list');
    console.log(`好友：${friends.length} 个`);

    ws.close();
    process.exit(0);
  } catch (err) {
    console.error(`检查失败：${err.message}`);
    process.exit(1);
  }
});

ws.on('error', (err) => {
  console.error(`连不上 NapCat（${config.onebot.url}）：${err.message}`);
  process.exit(1);
});

setTimeout(() => {
  console.error('连接超时');
  process.exit(1);
}, 10000);
