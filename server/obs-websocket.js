const crypto = require('crypto');
const { EventEmitter } = require('events');

function sha256Base64(value) {
  return crypto.createHash('sha256').update(value).digest('base64');
}

class ObsWebSocketClient extends EventEmitter {
  constructor({ url = 'ws://127.0.0.1:4455', password = '' } = {}) {
    super();
    this.url = url;
    this.password = password;
    this.socket = null;
    this.connected = false;
    this.connecting = null;
    this.pending = new Map();
    this.requestCounter = 0;
    this.lastError = null;
  }

  status() {
    return {
      url: this.url,
      passwordSaved: Boolean(this.password),
      connected: this.connected,
      connecting: Boolean(this.connecting),
      lastError: this.lastError
    };
  }

  configure({ url, password }) {
    const nextUrl = url || this.url;
    const nextPassword = typeof password === 'string' ? password : this.password;
    if (nextUrl !== this.url || nextPassword !== this.password) this.disconnect();
    this.url = nextUrl;
    this.password = nextPassword;
  }

  connect() {
    if (this.connected) return Promise.resolve(this.status());
    if (this.connecting) return this.connecting;
    if (typeof WebSocket === 'undefined') return Promise.reject(new Error('当前Node版本不支持WebSocket'));

    this.connecting = new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const connectionTimeout = setTimeout(() => {
        fail(new Error(`OBS WebSocket连接超时: ${this.url}`));
        socket.close();
      }, 5000);
      connectionTimeout.unref?.();

      const fail = error => {
        const message = error?.message || String(error || 'OBS WebSocket连接失败');
        this.lastError = message;
        if (!settled) {
          settled = true;
          clearTimeout(connectionTimeout);
          reject(new Error(message));
        }
      };

      socket.addEventListener('message', event => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.op === 0) {
            const identify = { rpcVersion: 1, eventSubscriptions: 5 };
            if (message.d.authentication) {
              const secret = sha256Base64(this.password + message.d.authentication.salt);
              identify.authentication = sha256Base64(secret + message.d.authentication.challenge);
            }
            socket.send(JSON.stringify({ op: 1, d: identify }));
            return;
          }
          if (message.op === 2) {
            this.connected = true;
            this.lastError = null;
            this.emit('status', this.status());
            if (!settled) {
              settled = true;
              clearTimeout(connectionTimeout);
              resolve(this.status());
            }
            return;
          }
          if (message.op === 7) {
            const pending = this.pending.get(message.d.requestId);
            if (!pending) return;
            this.pending.delete(message.d.requestId);
            if (message.d.requestStatus.result) pending.resolve(message.d.responseData || {});
            else pending.reject(new Error(message.d.requestStatus.comment || `OBS请求失败: ${message.d.requestStatus.code}`));
            return;
          }
          if (message.op === 5) {
            const eventType = message.d.eventType;
            const eventData = message.d.eventData || {};
            this.emit('event', eventType, eventData);
            this.emit(eventType, eventData);
          }
        } catch (error) {
          fail(error);
        }
      });

      socket.addEventListener('error', () => fail(new Error('OBS WebSocket连接错误')));
      socket.addEventListener('close', event => {
        if (this.socket === socket) {
          this.connected = false;
          this.socket = null;
        }
        for (const pending of this.pending.values()) pending.reject(new Error('OBS WebSocket连接已断开'));
        this.pending.clear();
        this.lastError = event.reason || this.lastError || `连接关闭(${event.code})`;
        this.emit('status', this.status());
        fail(new Error(this.lastError));
      });
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  disconnect() {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    socket?.close();
  }

  async request(requestType, requestData = {}) {
    if (!this.connected) await this.connect();
    const requestId = `zfb-${Date.now()}-${++this.requestCounter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.socket.send(JSON.stringify({
        op: 6,
        d: { requestType, requestId, requestData }
      }));
      const timeout = setTimeout(() => {
        if (!this.pending.delete(requestId)) return;
        reject(new Error(`OBS请求超时: ${requestType}`));
      }, 5000);
      timeout.unref?.();
      const pending = this.pending.get(requestId);
      pending.resolve = value => {
        clearTimeout(timeout);
        resolve(value);
      };
      pending.reject = error => {
        clearTimeout(timeout);
        reject(error);
      };
    });
  }
}

module.exports = { ObsWebSocketClient };
