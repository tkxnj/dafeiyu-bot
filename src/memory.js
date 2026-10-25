// 群聊短期记忆：每个群记住最近 N 条消息（包括机器人自己的回复），
// 可选持久化到 data/memory.json，重启后还能接上话。
import fs from 'node:fs';
import path from 'node:path';
import { warn } from './util.js';

export class GroupMemory {
  constructor({ turns = 16, file = null, persist = true } = {}) {
    this.maxEntries = Math.max(2, turns);
    this.file = file;
    this.persist = persist && Boolean(file);
    this.groups = new Map(); // groupId(string) -> [{ time, name, text, bot }]
    this.saveTimer = null;
    this._load();
  }

  history(groupId) {
    return this.groups.get(String(groupId)) ?? [];
  }

  add(groupId, entry) {
    const key = String(groupId);
    const list = this.groups.get(key) ?? [];
    list.push({
      time: Date.now(),
      name: String(entry.name ?? '群友'),
      text: String(entry.text ?? ''),
      bot: Boolean(entry.bot),
    });

    while (list.length > this.maxEntries) list.shift();
    this.groups.set(key, list);
    this._scheduleSave();
  }

  _load() {
    if (!this.persist) return;
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      const groups = parsed?.groups;
      if (!groups || typeof groups !== 'object') return;
      for (const [groupId, list] of Object.entries(groups)) {
        if (!Array.isArray(list)) continue;
        this.groups.set(
          groupId,
          list
            .filter((item) => item && typeof item.text === 'string')
            .slice(-this.maxEntries)
            .map((item) => ({
              time: Number(item.time) || Date.now(),
              name: String(item.name ?? '群友'),
              text: String(item.text ?? ''),
              bot: Boolean(item.bot),
            })),
        );
      }
    } catch (err) {
      if (err.code !== 'ENOENT') warn(`读取聊天记忆失败（忽略，从空白开始）：${err.message}`);
    }
  }

  _scheduleSave() {
    if (!this.persist || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 1500);
    this.saveTimer.unref?.();
  }

  flush() {
    if (!this.persist) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const data = { savedAt: new Date().toISOString(), groups: Object.fromEntries(this.groups) };
      // 先写临时文件再原子替换，避免写到一半断电/崩溃把记忆文件写坏
      const tmpFile = `${this.file}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpFile, this.file);
    } catch (err) {
      warn(`保存聊天记忆失败：${err.message}`);
    }
  }

  stop() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.flush();
  }
}
