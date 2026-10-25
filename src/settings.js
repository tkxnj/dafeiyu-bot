// 会话设置：每个群的回复模式、每个私聊对象是否回复。
// 配置存在 data/chat-settings.json，由桌面控制台写入；bot 每隔 2 秒重读一次，
// 所以在控制台改完不用重启 bot 就生效。
import fs from 'node:fs';

const DEFAULTS = {
  defaults: { groupMode: 'mention', privateEnabled: true },
  groups: {},
  private: {},
};

function normalize(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const defaults = data.defaults && typeof data.defaults === 'object' ? data.defaults : {};
  return {
    defaults: {
      groupMode: defaults.groupMode === 'auto' ? 'auto' : 'mention',
      privateEnabled: defaults.privateEnabled !== false,
    },
    groups: data.groups && typeof data.groups === 'object' ? data.groups : {},
    private: data.private && typeof data.private === 'object' ? data.private : {},
  };
}

function toPositiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

// 只取有效的自定义限额字段；没设置返回 null（用 .env 的默认值）
function pickLimits(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const perMinute = toPositiveInt(entry.perMinute);
  const perHour = toPositiveInt(entry.perHour);
  if (perMinute === undefined && perHour === undefined) return null;
  return { perMinute, perHour };
}

export class ChatSettings {
  constructor({ file, ttlMs = 2000 } = {}) {
    this.file = file;
    this.ttlMs = ttlMs;
    this.cache = null;
    this.cacheAt = 0;
  }

  load() {
    const now = Date.now();
    if (this.cache && now - this.cacheAt < this.ttlMs) return this.cache;
    let data = DEFAULTS;
    try {
      data = normalize(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      data = normalize(DEFAULTS);
    }
    this.cache = data;
    this.cacheAt = now;
    return data;
  }

  // 'mention' = 群里只回 @；'auto' = 群里直接回（不用 @）
  groupMode(groupId) {
    const settings = this.load();
    const entry = settings.groups[String(groupId)];
    if (entry && (entry.mode === 'auto' || entry.mode === 'mention')) return entry.mode;
    return settings.defaults.groupMode;
  }

  privateEnabled(userId) {
    const settings = this.load();
    const entry = settings.private[String(userId)];
    if (entry && typeof entry.enabled === 'boolean') return entry.enabled;
    return settings.defaults.privateEnabled;
  }

  // 这个群是否要假装不认识主人/男朋友
  groupHideOwner(groupId) {
    const entry = this.load().groups[String(groupId)];
    return entry?.hideOwner === true;
  }

  // 这个私聊对象是否要假装不认识主人/男朋友
  privateHideOwner(userId) {
    const entry = this.load().private[String(userId)];
    return entry?.hideOwner === true;
  }

  // 每个群的回复限额覆盖（控制台「快捷设置」写入）；没设置返回 null，用全局默认
  groupLimits(groupId) {
    return pickLimits(this.load().groups[String(groupId)]);
  }

  // 每个私聊对象的回复限额覆盖
  privateLimits(userId) {
    return pickLimits(this.load().private[String(userId)]);
  }
}
