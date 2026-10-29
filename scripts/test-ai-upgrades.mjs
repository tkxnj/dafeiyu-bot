// 针对三大 AI 升级特性的自动化单元/集成测试：
// 1. 多模态感知与表情包互动
// 2. 长短期记忆（SQLite）与 BM25 RAG 检索
// 3. Tool Use / Function Calling 智能体工具执行
import assert from 'node:assert/strict';
import { extractMessageParts, resolveImageToBase64 } from '../src/util.js';
import { MemeManager } from '../src/meme.js';
import { MemoryRetriever } from '../src/rag.js';
import { ToolExecutor } from '../src/tools/executor.js';
import { TOOL_DEFINITIONS } from '../src/tools/definitions.js';

console.log('--- 开始测试三大 AI 升级特性 ---\n');

// ========== 测试 1：多模态感知与表情包解析 ==========
console.log('【测试 1】多模态消息解析与富媒体表情');
{
  // 1.1 OneBot 11 消息段多模态提取
  const segments = [
    { type: 'text', data: { text: '看我这只猫咪：' } },
    { type: 'image', data: { file: 'cat.png', url: 'https://example.com/cat.png' } },
    { type: 'face', data: { id: '14' } },
  ];
  const parts = extractMessageParts(segments, '');
  assert.equal(parts.text, '看我这只猫咪：');
  assert.equal(parts.images.length, 1);
  assert.equal(parts.images[0].url, 'https://example.com/cat.png');
  assert.equal(parts.faces[0], '14');

  // 1.2 CQ 码多模态提取
  const cqStr = '这题怎么做？[CQ:image,file=problem.jpg,url=https://example.com/p.jpg]';
  const cqParts = extractMessageParts(cqStr);
  assert.equal(cqParts.text, '这题怎么做？');
  assert.equal(cqParts.images.length, 1);
  assert.equal(cqParts.images[0].url, 'https://example.com/p.jpg');

  // 1.3 表情包与 Face 转换
  const memeManager = new MemeManager();
  const replyBubble = '才不是呢！[表情: 傲娇] 本鱼去吃白饭了 [CQ:face,id=61]';
  const outSegments = memeManager.parseMessageToSegments(replyBubble);
  assert.ok(outSegments.some((s) => s.type === 'face' && s.data.id === '21')); // 傲娇 -> 21
  assert.ok(outSegments.some((s) => s.type === 'face' && s.data.id === '61')); // 经典吃白饭 face 61

  console.log('  ✓ 多模态消息提取与表情段映射全部正常通过\n');
}

// ========== 测试 2：长短期混合记忆与 BM25 RAG 检索 ==========
console.log('【测试 2】SQLite 长期记忆与 BM25 检索算法');
{
  const retriever = new MemoryRetriever(':memory:');

  // 2.1 用户画像与好感度动态调整
  retriever.upsertUserProfile('2026001', {
    nickname: '南小智',
    affinity: 60,
    tags: '南京大学,人工智能专业,大一新生',
    notes: '喜欢吃白饭，自学 Python 和 C++',
  });

  const profile = retriever.getUserProfile('2026001');
  assert.equal(profile.nickname, '南小智');
  assert.equal(profile.affinity, 60);

  // 被动好感度规则测试
  retriever.evaluatePassiveAffinity('2026001', '请你吃大白饭和小鱼干');
  assert.equal(retriever.getUserProfile('2026001').affinity, 63);

  retriever.evaluatePassiveAffinity('2026001', '笨鱼大肥鱼');
  assert.equal(retriever.getUserProfile('2026001').affinity, 59);

  // 2.2 长期记忆存取与 BM25 检索
  retriever.recordMemory({
    chatKey: 'group_nju_ai',
    userId: '2026001',
    userName: '南小智',
    content: '南小智下周三要在鼓楼校区参加线性代数期中考试',
    keywords: '线性代数 考试 鼓楼 南京大学',
  });
  retriever.recordMemory({
    chatKey: 'group_nju_ai',
    userId: '2026002',
    userName: '群友乙',
    content: '今天仙林校区的食堂二楼白饭很好吃',
    keywords: '食堂 仙林 白饭',
  });

  // 检索线性代数相关记忆
  const results = retriever.retrieveRelevantMemories('group_nju_ai', '小智什么时候考线代', 2);
  assert.ok(results.length > 0);
  assert.ok(results[0].content.includes('线性代数期中考试'));

  // 提示词注入格式化验证
  const promptContext = retriever.formatContextForPrompt({
    chatKey: 'group_nju_ai',
    userId: '2026001',
    userName: '南小智',
    currentText: '我明天要复习线代',
  });
  assert.ok(promptContext.includes('【群友画像与好感度】'));
  assert.ok(promptContext.includes('南京大学,人工智能专业'));
  assert.ok(promptContext.includes('【检索到的相关历史记忆'));

  console.log('  ✓ SQLite 用户画像、好感度增减、BM25 检索算法全部正常通过\n');
}

// ========== 测试 3：Tool Use / Function Calling 智能体 ==========
console.log('【测试 3】智能体工具执行 (Function Calling)');
async function testTools() {
  const retriever = new MemoryRetriever(':memory:');
  const executor = new ToolExecutor({ memoryRetriever: retriever });

  // 3.1 时间工具
  const timeRes = await executor.execute('get_current_time');
  assert.ok(timeRes.datetime);
  assert.ok(timeRes.weekday);

  // 3.2 骰子与决策工具
  const diceRes = await executor.execute('roll_dice', { options: ['吃白饭', '吃寿喜烧'] });
  assert.equal(diceRes.type, 'choice');
  assert.ok(['吃白饭', '吃寿喜烧'].includes(diceRes.picked));

  // 3.3 数学安全计算器
  const calcRes = await executor.execute('calculate', { expression: '2^8 + sqrt(64) * 5' });
  assert.equal(calcRes.result, 296);

  // 3.4 记忆记录工具
  const recordRes = await executor.execute(
    'record_user_profile',
    { tags: 'AI大一,擅长刷题', notes: '喜欢写代码和做数学题' },
    { chatKey: 'test_chat', userId: '888999', userName: '算法神仙' },
  );
  assert.equal(recordRes.status, 'success');
  const p = retriever.getUserProfile('888999');
  assert.ok(p.tags.includes('AI大一'));
  assert.ok(p.notes.includes('喜欢写代码'));

  console.log('  ✓ 工具箱 (时间、随机决策、数学计算、档案主动记录) 全部正常通过\n');
}

testTools()
  .then(() => {
    console.log('==============================================');
    console.log('🎉 所有三大 AI 升级能力测试 100% 全部通过！');
    console.log('==============================================');
    process.exit(0);
  })
  .catch((err) => {
    console.error('测试失败:', err);
    process.exit(1);
  });
