// 长期记忆与群友画像 SQLite 数据库存储
// 基于 Node.js 内置的 node:sqlite（零依赖、轻量、高性能）
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { warn, log } from './util.js';

let dbInstance = null;

export function initDatabase(dbPath) {
  if (dbInstance) return dbInstance;

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    // 开启 WAL 模式提升并发读写性能
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');

    // 1. 群友画像表 (User Profiles)
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        nickname TEXT,
        affinity INTEGER DEFAULT 50,
        tags TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        updated_at INTEGER
      );
    `);

    // 2. 长期记忆与历史事实表 (Longterm Memories)
    db.exec(`
      CREATE TABLE IF NOT EXISTS longterm_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_key TEXT,
        user_id TEXT,
        user_name TEXT,
        content TEXT,
        keywords TEXT,
        created_at INTEGER
      );
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_chat ON longterm_memories(chat_key);
      CREATE INDEX IF NOT EXISTS idx_memories_user ON longterm_memories(user_id);
    `);

    dbInstance = db;
    return db;
  } catch (err) {
    warn(`初始化 SQLite 数据库失败，将降级为内存模式：${err.message}`);
    const memDb = new DatabaseSync(':memory:');
    dbInstance = memDb;
    return memDb;
  }
}

export class MemoryStore {
  constructor(dbPath) {
    this.db = initDatabase(dbPath);
  }

  // 获取群友画像
  getUserProfile(userId) {
    if (!userId) return null;
    try {
      const stmt = this.db.prepare('SELECT * FROM user_profiles WHERE user_id = ?');
      const row = stmt.get(String(userId));
      return row || null;
    } catch (err) {
      warn(`读取群友画像失败 (${userId})：${err.message}`);
      return null;
    }
  }

  // 更新或创建群友画像
  upsertUserProfile(userId, { nickname, affinity, tags, notes } = {}) {
    if (!userId) return;
    const uid = String(userId);
    const existing = this.getUserProfile(uid);
    const now = Date.now();

    try {
      if (existing) {
        const newNick = nickname !== undefined ? String(nickname) : existing.nickname;
        const newAffinity = affinity !== undefined ? Math.max(0, Math.min(100, Number(affinity))) : existing.affinity;
        const newTags = tags !== undefined ? String(tags) : existing.tags;
        const newNotes = notes !== undefined ? String(notes) : existing.notes;

        const stmt = this.db.prepare(`
          UPDATE user_profiles 
          SET nickname = ?, affinity = ?, tags = ?, notes = ?, updated_at = ?
          WHERE user_id = ?
        `);
        stmt.run(newNick, newAffinity, newTags, newNotes, now, uid);
      } else {
        const stmt = this.db.prepare(`
          INSERT INTO user_profiles (user_id, nickname, affinity, tags, notes, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
          uid,
          String(nickname || `群友${uid}`),
          affinity !== undefined ? Math.max(0, Math.min(100, Number(affinity))) : 50,
          String(tags || ''),
          String(notes || ''),
          now,
        );
      }
    } catch (err) {
      warn(`更新群友画像失败 (${uid})：${err.message}`);
    }
  }

  // 调整好感度
  adjustAffinity(userId, delta) {
    if (!userId || !delta) return 50;
    const uid = String(userId);
    const profile = this.getUserProfile(uid);
    const current = profile ? profile.affinity : 50;
    const next = Math.max(0, Math.min(100, current + Number(delta)));
    this.upsertUserProfile(uid, { affinity: next });
    return next;
  }

  // 记录一条长期记忆
  addLongtermMemory({ chatKey, userId, userName, content, keywords = '' }) {
    if (!content || !content.trim()) return;
    try {
      const stmt = this.db.prepare(`
        INSERT INTO longterm_memories (chat_key, user_id, user_name, content, keywords, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        String(chatKey || 'global'),
        String(userId || ''),
        String(userName || '群友'),
        String(content).trim(),
        String(keywords || ''),
        Date.now(),
      );
    } catch (err) {
      warn(`记录长期记忆失败：${err.message}`);
    }
  }

  // 读取指定群或全局的长期记忆列表
  getMemories(chatKey, limit = 50) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM longterm_memories 
        WHERE chat_key = ? OR chat_key = 'global'
        ORDER BY created_at DESC 
        LIMIT ?
      `);
      return stmt.all(String(chatKey), limit);
    } catch (err) {
      warn(`获取长期记忆失败：${err.message}`);
      return [];
    }
  }

  close() {
    try {
      this.db?.close?.();
    } catch {
      // 忽略
    }
  }
}
