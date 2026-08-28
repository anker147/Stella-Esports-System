const path = require('node:path');
const { execFile } = require('node:child_process');

const SCRIPT_PATH = path.join(__dirname, 'media-session.ps1');
const DEFAULT_STATE = {
  available: false,
  source: null,
  title: null,
  artist: null,
  album: null,
  playing: false,
  playbackStatus: 'closed',
  positionSeconds: 0,
  durationSeconds: 0,
  volume: null,
  updatedAt: 0,
  error: null
};

function runPowerShell(action, volume) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH, '-Action', action];
  if (Number.isFinite(volume)) args.push('-Volume', String(volume));
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', args, { encoding: 'utf8', timeout: 8000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message).trim()));
        return;
      }
      try {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
        resolve(JSON.parse(line));
      } catch {
        reject(new Error('无法解析网易云媒体状态'));
      }
    });
  });
}

class MusicController {
  constructor({ runner = runPowerShell, cacheMs = 1500, trackRefreshDelayMs = 500 } = {}) {
    this.runner = runner;
    this.cacheMs = cacheMs;
    this.trackRefreshDelayMs = trackRefreshDelayMs;
    this.state = { ...DEFAULT_STATE };
    this.pendingStatus = null;
  }

  async status({ force = false } = {}) {
    if (!force && Date.now() - this.state.updatedAt < this.cacheMs) return { ...this.state };
    if (this.pendingStatus) return this.pendingStatus;
    this.pendingStatus = this.runner('status')
      .then(result => {
        if (result.playbackStatus === 'unknown' && this.state.source === result.source && this.state.title === result.title) {
          result.playing = this.state.playing;
        }
        if (result.playbackStatus === 'unknown' && !Number.isFinite(result.volume)) {
          result.volume = Number.isFinite(this.state.volume) ? this.state.volume : 50;
        }
        this.state = { ...DEFAULT_STATE, ...result, updatedAt: Date.now(), error: null };
        return { ...this.state };
      })
      .catch(error => {
        this.state = { ...this.state, available: false, playing: false, updatedAt: Date.now(), error: error.message };
        return { ...this.state };
      })
      .finally(() => { this.pendingStatus = null; });
    return this.pendingStatus;
  }

  async action(type, value) {
    const actions = new Set(['toggle', 'play', 'pause', 'previous', 'next']);
    if (type === 'set-volume') {
      const volume = Math.max(0, Math.min(100, Math.round(Number(value))));
      if (!Number.isFinite(volume)) throw new Error('音量必须是 0 到 100');
      const result = await this.runner('set-volume', volume);
      if (!result.available) throw new Error('网易云当前没有活动音频会话');
      this.state = { ...this.state, volume: result.volume, updatedAt: Date.now(), error: null };
      return { ...this.state };
    }
    if (!actions.has(type)) throw new Error(`未知音乐操作: ${type}`);
    let result = await this.runner(type);
    if (type === 'previous' || type === 'next') {
      if (this.trackRefreshDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.trackRefreshDelayMs));
      }
      result = await this.runner('status');
    }
    if (result.playbackStatus === 'unknown') {
      result.playing = type === 'toggle' ? !this.state.playing : type === 'pause' ? false : true;
      if (!Number.isFinite(result.volume)) result.volume = Number.isFinite(this.state.volume) ? this.state.volume : 50;
    }
    this.state = { ...DEFAULT_STATE, ...result, updatedAt: Date.now(), error: null };
    return { ...this.state };
  }
}

module.exports = { DEFAULT_STATE, MusicController, runPowerShell };
