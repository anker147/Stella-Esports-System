// Site-wide link environment guard: detects developer-tools throttling,
// proxy interception on loopback, slow remote links, and stale caches after
// upgrades, then surfaces the likely cause to the operator.
// Detection only — this module never alters how the page loads assets.
(() => {
  const PROBE_INTERVAL_MS = 5 * 60 * 1000;
  const LOOPBACK_RTT_LIMIT_MS = 150;
  const THROUGHPUT_LIMIT_KBPS = 150;
  const SLOW_STRIKES = 2;
  const TOAST_REPEAT_MS = 30 * 60 * 1000;
  const VERSION_KEY = 'zfb.linkGuard.version';

  const state = {
    enabled: false,
    ready: false,
    host: location.hostname,
    hostKind: 'loopback',
    version: '',
    versionChanged: false,
    lastProbe: null,
    slow: false
  };
  let slowStrikes = 0;
  const lastToastAt = {};

  function classifyHost(hostname) {
    let host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (host.startsWith('::ffff:')) host = host.slice(7);
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return 'loopback';
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
      const first = Number(v4[1]);
      const second = Number(v4[2]);
      if (first === 10 || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168) || (first === 169 && second === 254)) return 'lan';
      return 'wan';
    }
    return 'wan';
  }

  function toast(message, tone) {
    const holder = document.createElement('div');
    holder.setAttribute('role', 'status');
    holder.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;max-width:340px;'
      + 'padding:12px 14px;border-radius:10px;font:13px/1.5 system-ui,sans-serif;color:#1f2937;'
      + 'background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.18);border:1px solid '
      + (tone === 'warn' ? '#f59e0b' : '#93c5fd') + ';';
    holder.textContent = message;
    document.body.append(holder);
    setTimeout(() => holder.remove(), 8000);
  }

  function emit() {
    window.dispatchEvent(new CustomEvent('stella:link-guard'));
  }

  function readStoredVersion() {
    try { return localStorage.getItem(VERSION_KEY); } catch { return null; }
  }

  function storeVersion(version) {
    try { localStorage.setItem(VERSION_KEY, version); } catch {}
  }

  function checkVersion(version) {
    state.version = version;
    const stored = readStoredVersion();
    if (stored && stored !== version) {
      state.versionChanged = true;
      toast(text('guard.toastVersionUpdated',
        '系统已更新至 {version}。如遇文字或图标缺失，请按 Ctrl+F5 硬刷新。', { version }), 'info');
    }
    storeVersion(version);
  }

  function announceSlow() {
    const probe = state.lastProbe;
    const reason = state.hostKind === 'loopback' ? 'slowLoopback' : 'slowLink';
    const now = Date.now();
    if (now - (lastToastAt[reason] || 0) < TOAST_REPEAT_MS) return;
    lastToastAt[reason] = now;
    const speed = probe && probe.kbps !== null ? probe.kbps : '—';
    if (reason === 'slowLoopback') {
      const rtt = probe ? probe.rttMs : '—';
      toast(text('guard.toastSlowLoopback',
        '本机回环链路异常缓慢（RTT {rtt}ms、约 {speed} KB/s）。常见原因：开发者工具的网络节流档位未关，或系统代理拦截了 127.0.0.1。',
        { rtt, speed }), 'warn');
    } else {
      toast(text('guard.toastSlowLink',
        '当前链路实测约 {speed} KB/s，图片与封面加载会偏慢。', { speed }), 'warn');
    }
  }

  function evaluateProbe() {
    const probe = state.lastProbe;
    if (!probe) return;
    const kbpsSlow = probe.kbps !== null && probe.kbps < THROUGHPUT_LIMIT_KBPS;
    const rttSlow = probe.rttMs > LOOPBACK_RTT_LIMIT_MS;
    state.slow = state.hostKind === 'loopback' ? (rttSlow || kbpsSlow) : kbpsSlow;
    if (state.slow) {
      slowStrikes += 1;
      if (slowStrikes >= SLOW_STRIKES) announceSlow();
    } else {
      slowStrikes = 0;
    }
  }

  async function probe() {
    if (!state.enabled || document.visibilityState === 'hidden') return;
    try {
      const startedAt = Date.now();
      const health = await fetch('/api/system/health', { cache: 'no-store' }).then(response => response.json());
      if (health?.guards?.link === false) {
        state.enabled = false;
        emit();
        return;
      }
      const rttMs = Date.now() - startedAt;
      let kbps = null;
      try {
        const transferStart = performance.now();
        const payload = await fetch('/assets/data/ui-text.json', { cache: 'no-store' }).then(r => r.arrayBuffer());
        kbps = Math.round(payload.byteLength / 1024 / ((performance.now() - transferStart) / 1000));
      } catch {}
      state.lastProbe = { at: Date.now(), rttMs, kbps };
      evaluateProbe();
    } catch {}
    emit();
  }

  window.LinkGuard = {
    snapshot() {
      return {
        ...state,
        lastProbe: state.lastProbe ? { ...state.lastProbe } : null
      };
    }
  };

  async function start() {
    state.hostKind = classifyHost(location.hostname);
    try {
      const health = await fetch('/api/system/health', { cache: 'no-store' }).then(response => response.json());
      state.enabled = health?.guards?.link !== false;
      state.ready = true;
      if (!state.enabled) {
        emit();
        return;
      }
      checkVersion(String(health?.version || ''));
      await probe();
      setInterval(probe, PROBE_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') probe();
      });
    } catch {
      state.ready = true;
      emit();
    }
  }

  start();
})();
