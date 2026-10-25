// 梗词典：bot 遇到看不懂的梗时记到 unknownFile（控制台展示，由用户手动解释）；
// 用户解释后写进 glossaryFile，之后每次请求都会作为「已学会的梗」带进 prompt。
import fs from 'node:fs';
import path from 'node:path';

function normalizeTerm(term) {
  return String(term ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeGlossary(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  return list
    .filter((item) => item && item.term && item.explanation)
    .map((item) => ({
      term: String(item.term).trim(),
      explanation: String(item.explanation).trim(),
      createdAt: String(item.createdAt ?? ''),
    }))
    .filter((item) => item.term && item.explanation)
    .slice(-200);
}

function normalizeUnknown(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  return list
    .filter((item) => item && item.term)
    .map((item) => ({
      id: String(item.id ?? ''),
      term: String(item.term).trim(),
      context: String(item.context ?? ''),
      chatKey: String(item.chatKey ?? ''),
      userName: String(item.userName ?? ''),
      userId: String(item.userId ?? ''),
      isPrivate: Boolean(item.isPrivate),
      createdAt: String(item.createdAt ?? ''),
    }))
    .filter((item) => item.term)
    .slice(-100);
}

export class Glossary {
  constructor({ glossaryFile, unknownFile, ttlMs = 2000, maxPromptEntries = 60 } = {}) {
    this.glossaryFile = glossaryFile;
    this.unknownFile = unknownFile;
    this.ttlMs = ttlMs;
    this.maxPromptEntries = maxPromptEntries;
    this.cache = null;
    this.cacheAt = 0;
  }

  readGlossary() {
    try {
      return normalizeGlossary(JSON.parse(fs.readFileSync(this.glossaryFile, 'utf8')));
    } catch {
      return [];
    }
  }

  load() {
    const now = Date.now();
    if (this.cache && now - this.cacheAt < this.ttlMs) return this.cache;
    this.cache = { glossary: this.readGlossary() };
    this.cacheAt = now;
    return this.cache;
  }

  // 拼成 system prompt 里的「已学会的梗」段落；没学过返回空串
  formatForPrompt() {
    const entries = this.load().glossary.slice(-this.maxPromptEntries);
    if (entries.length === 0) return '';
    return entries.map((item) => `- ${item.term}：${item.explanation}`).join('\n');
  }

  readUnknown() {
    try {
      return normalizeUnknown(JSON.parse(fs.readFileSync(this.unknownFile, 'utf8')));
    } catch {
      return [];
    }
  }

  writeUnknown(items) {
    try {
      fs.mkdirSync(path.dirname(this.unknownFile), { recursive: true });
      fs.writeFileSync(this.unknownFile, JSON.stringify(items.slice(-100), null, 2), 'utf8');
    } catch {
      // 写不了就算了，不影响回复
    }
  }

  // 记录一个看不懂的梗；同一个梗不重复记。返回是否新记录
  addUnknown({ term, context = '', chatKey = '', userName = '', userId = '', isPrivate = false } = {}) {
    const cleanTerm = String(term ?? '')
      .replace(/[【】\r\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    if (!cleanTerm) return false;

    const items = this.readUnknown();
    if (items.some((item) => normalizeTerm(item.term) === normalizeTerm(cleanTerm))) return false;

    items.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      term: cleanTerm,
      context: String(context ?? '').slice(0, 160),
      chatKey: String(chatKey ?? ''),
      userName: String(userName ?? ''),
      userId: String(userId ?? ''),
      isPrivate: Boolean(isPrivate),
      createdAt: new Date().toISOString(),
    });
    this.writeUnknown(items);
    return true;
  }
}
