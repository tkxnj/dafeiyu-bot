// 本地试聊脚本：npm run demo
// 不需要 QQ、不需要 NapCat，直接在终端里和大肥鱼聊天，用来调人设、验证 API。
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { config, validateConfig } from '../src/config.js';
import { loadPersona, generateReply } from '../src/llm.js';
import { sanitizeReply, splitBubbles, truncate } from '../src/util.js';

validateConfig();

let persona;
try {
  persona = loadPersona(config.personaFile);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const history = []; // 结构跟真实运行时一样：{ name, text, bot }

const rl = readline.createInterface({ input, output });

console.log('\n🫧 本地试聊模式（不连 QQ，不花额外钱，调人设用）');
console.log('输入一句话回车；直接回车退出。\n');

while (true) {
  const text = (await rl.question('你：')).trim();
  if (!text) break;

  history.push({ name: '你', text, bot: false });
  // 跟真实运行时一样，只保留最近 CONTEXT_TURNS 条
  while (history.length > config.behavior.contextTurns) history.shift();

  try {
    const raw = await generateReply({ config, persona, history, groupId: 'demo' });
    const reply = truncate(sanitizeReply(raw), config.behavior.maxReplyChars);
    if (!reply) {
      console.log('大肥鱼：（这次没说话）\n');
      history.pop();
      continue;
    }
    const bubbles = config.behavior.multiBubble ? splitBubbles(reply, 3) : [reply];
    for (const bubble of bubbles) console.log(`大肥鱼：${bubble}`);
    console.log('');
    history.push({ name: config.bot.nickname, text: reply, bot: true });
    while (history.length > config.behavior.contextTurns) history.shift();
  } catch (err) {
    console.error(`\n出错了：${err.message}\n`);
    history.pop();
  }
}

rl.close();
console.log('\n再见，本鱼去群里潜水了。');
