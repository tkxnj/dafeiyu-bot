// 接话决策：一条群消息要不要理、为什么理。
// 把规则都集中在这里，方便你按群的脾气调。
import { isAtMe } from './util.js';

export class TriggerEngine {
  constructor(config) {
    this.config = config;
    this.selfQq = String(config.bot.selfQq || '');
    this.lastReplyAt = new Map(); // groupId -> 时间戳
    this.replyTimes = new Map(); // groupId -> [时间戳]
  }

  setSelfQq(qq) {
    if (qq) this.selfQq = String(qq);
  }

  shouldReply(event, text, options = {}) {
    if (!event || event.post_type !== 'message') {
      return { reply: false, reason: '不是消息' };
    }

    const isGroup = event.message_type === 'group';
    const isPrivate = event.message_type === 'private';
    if (!isGroup && !isPrivate) {
      return { reply: false, reason: '不支持的消息类型' };
    }

    const userId = String(event.user_id ?? '');
    const selfId = String(event.self_id ?? this.selfQq);

    // 不跟自己说话
    if (userId && (userId === selfId || (this.selfQq && userId === this.selfQq))) {
      return { reply: false, reason: '自己发的消息' };
    }

    // 黑名单：别的机器人、讨厌的人
    if (this.config.bot.ignoreQqs.includes(userId)) {
      return { reply: false, reason: '黑名单用户' };
    }

    // 安静时段（群聊和私聊都遵守）
    if (this._isQuietHour()) {
      return { reply: false, reason: '安静时段' };
    }

    // ---------- 私聊：不需要 @，每条都回（留个每小时上限防刷） ----------
    if (isPrivate) {
      const privateKey = `private:${userId}`;
      const limits = options.limits || {};
      const perHour = this._effectiveLimit(limits.perHour, this.config.behavior.maxRepliesPerHour);
      const perMinute = this._effectiveLimit(limits.perMinute, this.config.behavior.maxPrivateRepliesPerMinute);
      if (this._reachedHourlyCap(privateKey, perHour)) {
        return { reply: false, reason: '私聊本小时回复数到顶' };
      }
      if (this._reachedMinuteCap(privateKey, perMinute)) {
        return { reply: false, reason: '私聊本分钟回复数到顶' };
      }
      // 固定接梗白名单（token来/白饭来/寿来）：私聊也接，不走大模型
      if (options.memeReply) {
        return { reply: true, mode: 'meme', reply: options.memeReply };
      }
      return { reply: true, mode: 'private' };
    }

    // ---------- 群聊 ----------
    const groupId = String(event.group_id ?? '');
    const chatKey = groupId;

    // 群白名单：填了就先只在这些群工作
    const allowed = this.config.bot.allowedGroups;
    if (allowed.length > 0 && !allowed.includes(groupId)) {
      return { reply: false, reason: '群不在白名单' };
    }

    // 每小时回复上限（控制台可以给这个群单独设）
    const limits = options.limits || {};
    const perHour = this._effectiveLimit(limits.perHour, this.config.behavior.maxRepliesPerHour);
    const perMinute = this._effectiveLimit(limits.perMinute, this.config.behavior.maxRepliesPerMinute);
    if (this._reachedHourlyCap(chatKey, perHour)) {
      return { reply: false, reason: '本群本小时回复数到顶' };
    }

    // 每分钟回复上限
    if (this._reachedMinuteCap(chatKey, perMinute)) {
      return { reply: false, reason: '本群本分钟回复数到顶' };
    }

    // 固定接梗白名单（token来/白饭来/寿来）：优先于自动回复，且不走大模型
    if (options.memeReply) {
      return { reply: true, mode: 'meme', reply: options.memeReply };
    }

    // 控制台把这个群设成「直接回复」：不用 @ 也回（仍受白名单/安静时段/每小时上限约束）
    if (options.autoReply === true) {
      return { reply: true, mode: 'auto' };
    }

    // 被 @ 是最高优先级，不参与冷却判断
    if (isAtMe(event.message, selfId)) {
      return { reply: true, mode: 'at' };
    }

    // 主动接话要等冷却结束
    const cooldownLeft = this._cooldownLeft(chatKey);
    if (cooldownLeft > 0) {
      return { reply: false, reason: `冷却中（还有 ${Math.ceil(cooldownLeft / 1000)} 秒）` };
    }

    // 关键词
    const keyword = this.config.behavior.keywords.find((word) => word && text.includes(word));
    if (keyword) {
      return { reply: true, mode: 'keyword', keyword };
    }

    // 随机插话
    if (Math.random() < this.config.behavior.replyRate) {
      return { reply: true, mode: 'random' };
    }

    return { reply: false };
  }

  // 真正发出回复后调用，用来记冷却和小时配额
  noteReply(groupId) {
    const key = String(groupId);
    const now = Date.now();
    this.lastReplyAt.set(key, now);

    const times = this.replyTimes.get(key) ?? [];
    times.push(now);
    const oneHourAgo = now - 3600 * 1000;
    while (times.length > 0 && times[0] < oneHourAgo) times.shift();
    this.replyTimes.set(key, times);
  }

  _cooldownLeft(groupId) {
    const last = this.lastReplyAt.get(String(groupId));
    if (!last) return 0;
    const waitMs = Math.max(0, this.config.behavior.cooldownSeconds) * 1000;
    return Math.max(0, waitMs - (Date.now() - last));
  }

  // 控制台给单个会话设的限额优先；非法/没设就用全局默认
  _effectiveLimit(override, fallback) {
    const value = Number(override);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  _reachedHourlyCap(groupId, overrideLimit = null) {
    const cap = this._effectiveLimit(overrideLimit, this.config.behavior.maxRepliesPerHour);
    // 校验阶段已经拦掉 <=0，这里再兜一层：非法值按“到顶”处理，宁可不回也别刷屏
    if (!Number.isFinite(cap) || cap <= 0) return true;
    const times = this.replyTimes.get(String(groupId)) ?? [];
    const oneHourAgo = Date.now() - 3600 * 1000;
    const recent = times.filter((time) => time >= oneHourAgo);
    this.replyTimes.set(String(groupId), recent);
    return recent.length >= cap;
  }

  _reachedMinuteCap(chatKey, limit) {
    if (!Number.isFinite(limit) || limit <= 0) return false;
    const times = this.replyTimes.get(String(chatKey)) ?? [];
    const oneMinuteAgo = Date.now() - 60 * 1000;
    const recent = times.filter((time) => time >= oneMinuteAgo);
    return recent.length >= limit;
  }

  // 发送前的最后一道限流：防止排队补答绕过每分钟/每小时上限
  canReplyNow(chatKey, limits = null, kind = 'group') {
    const perHour = this._effectiveLimit(limits?.perHour, this.config.behavior.maxRepliesPerHour);
    const perMinute = this._effectiveLimit(
      limits?.perMinute,
      kind === 'private' ? this.config.behavior.maxPrivateRepliesPerMinute : this.config.behavior.maxRepliesPerMinute,
    );
    if (this._reachedHourlyCap(chatKey, perHour)) return false;
    if (this._reachedMinuteCap(chatKey, perMinute)) return false;
    return true;
  }

  _isQuietHour() {
    const range = this.config.behavior.quietHours;
    if (!range) return false;
    const hour = new Date().getHours();
    const { start, end } = range;
    if (start === end) return false;
    return start < end ? hour >= start && hour < end : hour >= start || hour < end;
  }
}
