// OneBot 11 客户端：用 WebSocket 连到 NapCat，收群消息事件、调发消息接口。
// 只实现这个项目用得到的部分，代码尽量短，方便你改。
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { log, warn } from './util.js';

export class OneBotClient extends EventEmitter {
  constructor({
    url,
    token = '',
    reconnectMinMs = 1000,
    reconnectMaxMs = 30000,
  } = {}) {
    super();
    this.url = url;
    this.token = token;
    this.reconnectMinMs = reconnectMinMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.reconnectDelay = reconnectMinMs;

    this.ws = null;
    this.pending = new Map(); // echo -> { resolve, reject, timer, action }
    this.seq = 0;
    this.stopped = false;
    this.reconnectTimer = null;
  }

  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._rejectPending('bot 已停止');
    try {
      this.ws?.close();
    } catch {
      // 关不掉就算了
    }
  }

  _rejectPending(message) {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
    this.pending.clear();
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  _connect() {
    if (this.stopped) return;

    log(`正在连接 OneBot：${this.url}`);
    const headers = this.token ? { Authorization: `Bearer ${this.token}` } : undefined;

    let ws;
    try {
      ws = new WebSocket(this.url, { headers });
    } catch (err) {
      warn(`创建 WebSocket 失败：${err.message}`);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectDelay = this.reconnectMinMs;
      log('OneBot 已连接 ✅');
      this.emit('ready');
    });

    ws.on('message', (data) => this._handleFrame(data));

    ws.on('close', (code, reasonBuffer) => {
      if (this.stopped) return;
      const reason = reasonBuffer?.toString?.() ?? '';
      const seconds = Math.round(this.reconnectDelay / 1000);
      warn(`OneBot 连接断开（code=${code}${reason ? `，${reason}` : ''}），${seconds} 秒后重连`);
      this._rejectPending('OneBot 连接已断开');
      this._scheduleReconnect();
    });

    ws.on('error', (err) => {
      // 连不上时 ws 会先报 error 再报 close；这里只记日志，重连交给 close
      warn(`OneBot 连接出错：${err.message}`);
    });
  }

  _scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.reconnectMaxMs);
      this._connect();
    }, this.reconnectDelay);
  }

  _handleFrame(raw) {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      warn('收到一条不是 JSON 的帧，已忽略');
      return;
    }
    if (!payload || typeof payload !== 'object') return;

    // 接口调用的返回：带 echo 字段
    if ('echo' in payload) {
      const key = String(payload.echo);
      const waiter = this.pending.get(key);
      if (!waiter) return;
      this.pending.delete(key);
      clearTimeout(waiter.timer);

      const ok = payload.status === 'ok' && (payload.retcode === 0 || payload.retcode === undefined);
      if (ok) {
        waiter.resolve(payload.data ?? null);
      } else {
        const detail = payload.wording ?? payload.message ?? payload.retcode ?? '未知错误';
        waiter.reject(new Error(`OneBot 接口 ${waiter.action} 调用失败：${detail}`));
      }
      return;
    }

    // 事件推送（群消息、心跳等）
    if (payload.post_type) this.emit('event', payload);
  }

  // 调 OneBot 11 的接口，例如 get_login_info / send_group_msg
  call(action, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error(`OneBot 还没连上，无法调用 ${action}`));
        return;
      }

      const echo = `${Date.now()}-${++this.seq}`;
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`OneBot 接口 ${action} 超时`));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(echo, { resolve, reject, timer, action });

      try {
        this.ws.send(JSON.stringify({ action, params, echo }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(echo);
        reject(err);
      }
    });
  }

  async getLoginInfo() {
    const data = await this.call('get_login_info');
    return {
      qq: String(data?.user_id ?? ''),
      nickname: String(data?.nickname ?? ''),
    };
  }

  async sendGroupMsg(groupId, message) {
    return this.call('send_group_msg', {
      group_id: Number.isFinite(Number(groupId)) ? Number(groupId) : groupId,
      message,
    });
  }

  async sendPrivateMsg(userId, message) {
    return this.call('send_private_msg', {
      user_id: Number.isFinite(Number(userId)) ? Number(userId) : userId,
      message,
    });
  }
}
