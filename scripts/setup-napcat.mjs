// 首次启动前，根据 .env 生成 NapCat 的 OneBot 11 WebSocket 配置。
// 只在 napcat/napcat/config/onebot11_<BOT_QQ>.json 不存在时生成，不覆盖已有配置。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnv(file) {
  const values = {};
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index <= 0) continue;
      values[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
    }
  } catch {
    // 没有 .env 时由启动脚本提示用户
  }
  return values;
}

const env = readEnv(path.join(ROOT, '.env'));
const qq = String(env.BOT_QQ ?? '').trim();
if (!qq) {
  console.log('[setup] .env 里没有 BOT_QQ，跳过 NapCat 配置');
  process.exit(0);
}

const napcatDir = path.join(ROOT, 'napcat', 'napcat');
if (!fs.existsSync(napcatDir)) {
  console.log('[setup] 没有找到 napcat/，跳过（源码模式请自行安装 NapCat）');
  process.exit(0);
}

const configDir = path.join(napcatDir, 'config');
const configFile = path.join(configDir, `onebot11_${qq}.json`);
fs.mkdirSync(configDir, { recursive: true });

if (fs.existsSync(configFile)) {
  console.log('[setup] NapCat OneBot 配置已存在，跳过');
  process.exit(0);
}

let port = 3001;
try {
  port = Number(new URL(env.ONEBOT_WS_URL || 'ws://127.0.0.1:3001').port || 3001);
} catch {
  port = 3001;
}

const config = {
  network: {
    httpServers: [],
    httpSseServers: [],
    httpClients: [],
    websocketServers: [
      {
        name: 'fatfish-ws',
        enable: true,
        host: '127.0.0.1',
        port,
        messagePostFormat: 'array',
        reportSelfMessage: false,
        token: env.ONEBOT_ACCESS_TOKEN || '',
        enableForcePushEvent: true,
        debug: false,
        heartInterval: 30000,
      },
    ],
    websocketClients: [],
    plugins: [],
  },
  musicSignUrl: '',
  enableLocalFile2Url: false,
  parseMultMsg: false,
  imageDownloadProxy: '',
  timeout: {
    baseTimeout: 10000,
    uploadSpeedKBps: 256,
    downloadSpeedKBps: 256,
    maxTimeout: 1800000,
  },
};

fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
console.log(`[setup] 已生成 NapCat OneBot 配置：${configFile}`);
