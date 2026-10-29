// 自检脚本：npm run doctor
// 检查 Node 版本、.env、人设文件、大模型接口、NapCat WebSocket 是否通。
// 启动前先跑一遍，哪里不通它会把原因和下一步告诉你的。
import fs from 'node:fs';
import { WebSocket } from 'ws';
import { config } from '../src/config.js';

const results = [];

function ok(title, detail = '') {
  results.push({ level: 'ok', title, detail });
  console.log(`✅ ${title}${detail ? `：${detail}` : ''}`);
}

function bad(title, detail = '') {
  results.push({ level: 'bad', title, detail });
  console.log(`❌ ${title}${detail ? `：${detail}` : ''}`);
}

function skip(title, detail = '') {
  results.push({ level: 'skip', title, detail });
  console.log(`⚠️  ${title}${detail ? `：${detail}` : ''}`);
}

async function checkNode() {
  const version = process.versions.node;
  const major = Number(version.split('.')[0]);
  if (major >= 24) ok('Node.js 版本', `v${version}`);
  else bad('Node.js 版本太低', `v${version}，需要 24 或更高（内置 node:sqlite）；去 https://nodejs.org/zh-cn 装 LTS`);
}

function checkFiles() {
  const envPath = new URL('../.env', import.meta.url);
  if (fs.existsSync(envPath)) ok('.env 配置文件', '存在');
  else bad('.env 不存在', '先执行 copy .env.example .env，再填里面的内容');

  if (fs.existsSync(config.personaFile)) ok('人设文件', 'prompts/persona.md 存在');
  else bad('人设文件缺失', config.personaFile);
}

function checkConfigValues() {
  if (config.llm.apiKey) {
    const masked = `${config.llm.apiKey.slice(0, 3)}***`;
    ok('LLM_API_KEY', `已填写（${masked}，共 ${config.llm.apiKey.length} 位）`);
  } else {
    bad('LLM_API_KEY 为空', '去 https://platform.deepseek.com/api_keys 申请一个填进 .env');
  }

  ok('模型接口地址', config.llm.baseUrl);
  ok('模型名称', config.llm.model);
  ok('OneBot 地址', config.onebot.url);
  if (config.onebot.token) ok('OneBot Token', '已设置');
  else skip('OneBot Token', '没设置（能连就行，但建议在 NapCat 里加一个）');

  if (config.bot.allowedGroups.length > 0) {
    ok('工作群白名单', config.bot.allowedGroups.join('、'));
  } else {
    skip('工作群白名单', '没设 ALLOWED_GROUPS：所有群都会接话（测试期建议填上测试群群号）');
  }
  ok('触发关键词', config.behavior.keywords.length > 0 ? config.behavior.keywords.join('、') : '（无，只回 @）');
}

async function checkLLM() {
  if (!config.llm.apiKey) {
    skip('大模型接口', '没有 API Key，跳过');
    return;
  }
  const url = `${config.llm.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.apiKey}` },
      body: JSON.stringify({
        model: config.llm.model,
        messages: [{ role: 'user', content: '只回复两个字：在的' }],
        max_tokens: 10,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const costMs = Date.now() - startedAt;
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      bad('大模型接口不可用', `HTTP ${response.status}：${body.slice(0, 200)}`);
      return;
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    ok('大模型接口', `${costMs}ms，回复「${String(content).trim().slice(0, 20)}」`);
  } catch (err) {
    bad('大模型接口连不上', err.message);
  }
}

function checkOneBot() {
  return new Promise((resolve) => {
    const url = config.onebot.url;
    let finished = false;
    let ws;

    const finish = (success, detail) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // 忽略
      }
      if (success) ok('NapCat WebSocket', detail);
      else bad('NapCat WebSocket 连不上', detail);
      resolve();
    };

    const timer = setTimeout(() => finish(false, '8 秒内没完成握手；确认 NapCat 开着、WebSocket 服务器已启用'), 8000);

    try {
      ws = new WebSocket(url, {
        headers: config.onebot.token ? { Authorization: `Bearer ${config.onebot.token}` } : undefined,
      });
    } catch (err) {
      finish(false, err.message);
      return;
    }

    // 连上之后发一个 get_login_info，既验证 echo 配对，也顺便看看登录的是哪个号
    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({ action: 'get_login_info', params: {}, echo: 'doctor-check' }));
      } catch (err) {
        finish(false, `握手成功但发不出请求：${err.message}`);
      }
    });

    ws.on('message', (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (payload?.echo !== 'doctor-check') return;
      if (payload.status === 'ok' && payload.data?.user_id) {
        const nickname = payload.data.nickname || '(无昵称)';
        finish(true, `已连通，登录账号：${nickname}（${payload.data.user_id}）`);
      } else {
        finish(false, `连上了但 get_login_info 失败：${payload.wording ?? payload.retcode ?? '未知错误'}`);
      }
    });

    ws.on('error', (err) => finish(false, `${err.message}；检查端口/Token 是否和 NapCat 网络配置一致`));
  });
}

async function main() {
  console.log('\n🫧 蓝色大肥鱼 · 环境自检\n');
  await checkNode();
  checkFiles();
  checkConfigValues();
  await checkLLM();
  await checkOneBot();

  const failed = results.filter((item) => item.level === 'bad');
  console.log('');
  if (failed.length === 0) {
    console.log('🎉 全通了。执行 npm start 启动大肥鱼，然后去群里 @ 它试试。\n');
    process.exit(0);
  }
  console.log(`还有 ${failed.length} 项没通，按上面的提示修好再启动。\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error('自检脚本自己出错了：', err);
  process.exit(1);
});
