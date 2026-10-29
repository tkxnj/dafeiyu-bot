// RAG 长期记忆检索与群友画像系统
// 采用 BM25 / TF-IDF 向量空间模型实现轻量级混合检索，无需外部模型，低延迟零依赖。
import { MemoryStore } from './db.js';

// 中文分词与 unigram + bigram 词元切分（标准 CJK 倒排索引方案）
function tokenize(text) {
  if (!text) return [];
  const clean = String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

  const words = clean.split(/\s+/).filter(Boolean);
  const tokens = [];

  for (const word of words) {
    if (/^[a-z0-9]+$/i.test(word)) {
      tokens.push(word);
    } else {
      // 中文字符串：添加单字 unigram（提升简称与交叉命中召回）
      for (let i = 0; i < word.length; i += 1) {
        tokens.push(word[i]);
      }
      // 添加双字 bigram（保证短语语义精度）
      for (let i = 0; i < word.length - 1; i += 1) {
        tokens.push(word.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

export class MemoryRetriever {
  constructor(dbPath) {
    this.store = new MemoryStore(dbPath);
  }

  // 获取群友画像
  getUserProfile(userId) {
    return this.store.getUserProfile(userId);
  }

  // 更新群友画像
  upsertUserProfile(userId, data) {
    return this.store.upsertUserProfile(userId, data);
  }

  // 调整好感度
  adjustAffinity(userId, delta) {
    return this.store.adjustAffinity(userId, delta);
  }

  // 记录长期记忆
  recordMemory({ chatKey, userId, userName, content, keywords = '' }) {
    this.store.addLongtermMemory({ chatKey, userId, userName, content, keywords });
  }

  // BM25 检索算法实现
  retrieveRelevantMemories(chatKey, query, topK = 3) {
    const candidates = this.store.getMemories(chatKey, 60);
    if (!candidates || candidates.length === 0) return [];
    if (!query || !query.trim()) return candidates.slice(0, topK);

    const qTokens = tokenize(query);
    if (qTokens.length === 0) return candidates.slice(0, topK);

    const N = candidates.length;
    // 统计各 token 的文档频率 DF
    const docTokensList = candidates.map((c) => tokenize(`${c.content} ${c.keywords} ${c.user_name}`));
    const avgdl = docTokensList.reduce((acc, cur) => acc + cur.length, 0) / (N || 1);

    const dfMap = new Map();
    for (const tokens of docTokensList) {
      const unique = new Set(tokens);
      for (const t of unique) {
        dfMap.set(t, (dfMap.get(t) || 0) + 1);
      }
    }

    // BM25 参数
    const k1 = 1.2;
    const b = 0.75;

    const scored = candidates.map((cand, idx) => {
      const docTokens = docTokensList[idx];
      const D = docTokens.length;

      // 词频 TF 映射
      const tfMap = new Map();
      for (const t of docTokens) {
        tfMap.set(t, (tfMap.get(t) || 0) + 1);
      }

      let score = 0;
      for (const qt of qTokens) {
        const tf = tfMap.get(qt) || 0;
        if (tf === 0) continue;
        const df = dfMap.get(qt) || 1;
        // IDF 计算（标准平滑公式）
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        const termScore = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (D / (avgdl || 1)))));
        score += termScore;
      }

      return { ...cand, score };
    });

    return scored
      .filter((item) => item.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // 格式化为注入 System Prompt 的上下文字符串
  formatContextForPrompt({ chatKey, userId, userName, currentText }) {
    const sections = [];

    // 1. 群友画像与好感度
    if (userId) {
      const profile = this.getUserProfile(userId);
      const affinity = profile ? profile.affinity : 50;
      let affinityDesc = '普通群友';
      if (affinity >= 85) affinityDesc = '极高（超级亲近、非常宠ta）';
      else if (affinity >= 70) affinityDesc = '较好（亲切友好、喜欢和ta聊天）';
      else if (affinity <= 25) affinityDesc = '很低（对ta很不爽、爱理不理、毒舌冷嘲）';
      else if (affinity <= 40) affinityDesc = '较低（稍显嫌弃敷衍）';

      const details = [];
      details.push(`- 当前对话群友：${userName || '群友'} (QQ: ${userId})`);
      details.push(`- 对ta的好感度：${affinity}/100（态度倾向：${affinityDesc}）`);
      if (profile?.tags) details.push(`- 群友标签/特点：${profile.tags}`);
      if (profile?.notes) details.push(`- 历史背景备注：${profile.notes}`);

      sections.push('【群友画像与好感度】\n' + details.join('\n'));
    }

    // 2. 检索历史长期记忆
    const relevant = this.retrieveRelevantMemories(chatKey, currentText, 3);
    if (relevant.length > 0) {
      const memLines = relevant.map((m) => {
        const timeStr = new Date(m.created_at).toLocaleDateString('zh-CN');
        return `- [${timeStr}] ${m.user_name || '群友'}：${m.content}`;
      });
      sections.push('【检索到的相关历史记忆（可作为对话参考）】\n' + memLines.join('\n'));
    }

    return sections.join('\n\n');
  }

  // 规则被动调节好感度（投喂、赞美与怼人）
  evaluatePassiveAffinity(userId, text) {
    if (!userId || !text) return 0;
    let delta = 0;
    // 投喂食物/白饭/夸奖
    if (/请你吃|投喂|白饭|小鱼干|大肥鱼真棒|大肥鱼真可爱|大肥鱼真聪明|喜欢大肥鱼/.test(text)) {
      delta += 3;
    }
    // 辱骂/恶意调戏
    if (/死肥鱼|笨鱼|讨厌你|大肥猪|垃圾机器人/.test(text)) {
      delta -= 4;
    }
    if (delta !== 0) {
      this.adjustAffinity(userId, delta);
    }
    return delta;
  }
}
