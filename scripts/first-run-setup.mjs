// 首次配置向导：交互式写入 .env（或通过命令行参数自动写入）。
// 用法：
//   双击根目录「首次配置.bat」
//   或：node scripts/first-run-setup.mjs
//   自动化：node scripts/first-run-setup.mjs --key sk-xxx --qq 123456789 --owner "昵称,QQ" --token xxx --yes
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env');
const EXAMPLE_FILE = path.join(ROOT, '.env.example');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    args[key] = value;
  }
  return args;
}

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    values[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return values;
}

function setEnvValue(text, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, line);
  return `${text.replace(/\s*$/, '')}\n${line}\n`;
}

function mask(value) {
  if (!value) return '(empty)';
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-3)}`;
}

async function ask(rl, question, fallback = '') {
  const suffix = fallback ? ` [默认: ${mask(fallback)}]` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || fallback;
}

function validQQ(value) {
  return /^\d{5,12}$/.test(String(value).trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseFile = fs.existsSync(ENV_FILE) ? ENV_FILE : EXAMPLE_FILE;
  if (!fs.existsSync(baseFile)) {
    throw new Error('找不到 .env.example，请确认在项目根目录运行。');
  }
  let text = fs.readFileSync(baseFile, 'utf8');
  const current = parseEnv(text);
  const interactive = !args.yes && !args.key && !args.qq;

  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    let apiKey = String(args.key ?? current.LLM_API_KEY ?? '').trim();
    if (interactive) {
      apiKey = await ask(rl, '1) DeepSeek API Key（sk- 开头）', apiKey);
    }
    if (!apiKey || apiKey.includes('在这里填')) {
      throw new Error('API Key 不能为空（去 https://platform.deepseek.com/api_keys 申请）');
    }
    if (!apiKey.startsWith('sk-')) {
      console.warn('[警告] API Key 通常以 sk- 开头，请确认没有复制错。');
    }

    let qq = String(args.qq ?? current.BOT_QQ ?? '').trim();
    while (!validQQ(qq)) {
      if (!interactive) throw new Error(`BOT_QQ 不合法：${qq || '(空)'}，应为 5~12 位数字`);
      qq = await ask(rl, '2) 机器人 QQ 号（只填数字）', current.BOT_QQ || '');
      if (!validQQ(qq)) console.log('  QQ 号应为 5~12 位数字，请重试。');
    }

    let ownerNames = String(args.owner ?? current.OWNER_NAMES ?? '').trim();
    if (interactive && /^你的昵称,你的QQ号$/.test(ownerNames)) ownerNames = '';
    if (interactive) {
      ownerNames = await ask(rl, '3) 主人/男朋友的昵称或QQ（可留空）', ownerNames);
    }

    let token = String(args.token ?? current.ONEBOT_ACCESS_TOKEN ?? '').trim();
    if (!token) token = crypto.randomBytes(12).toString('hex');
    if (interactive) {
      token = await ask(rl, '4) OneBot 访问 Token（回车自动生成）', token);
    }
    if (!token) token = crypto.randomBytes(12).toString('hex');

    const updates = {
      LLM_API_KEY: apiKey,
      BOT_QQ: qq,
      OWNER_NAMES: ownerNames,
      ONEBOT_ACCESS_TOKEN: token,
    };
    for (const [key, value] of Object.entries(updates)) {
      text = setEnvValue(text, key, value);
    }

    fs.writeFileSync(ENV_FILE, text, 'utf8');
    console.log('');
    console.log('[完成] 已写入 .env：');
    console.log(`  LLM_API_KEY        = ${mask(apiKey)}`);
    console.log(`  BOT_QQ             = ${qq}`);
    console.log(`  OWNER_NAMES        = ${ownerNames || '(空)'}`);
    console.log(`  ONEBOT_ACCESS_TOKEN= ${mask(token)}`);
    console.log('');
    console.log('下一步：');
    console.log('- 双击 启动.bat 启动 bot + NapCat');
    console.log('- 首次运行 NapCat 会弹出二维码，用手机 QQ 登录机器人小号扫码');
    if (rl) await rl.question('按回车结束配置…');
  } finally {
    rl?.close();
  }
}

main().catch((err) => {
  console.error(`\n[配置失败] ${err.message}`);
  process.exitCode = 1;
});
