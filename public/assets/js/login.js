(function () {
  const tabs = [...document.querySelectorAll('[data-login-tab]')];
  const formsBox = document.getElementById('loginForms');
  const status = document.getElementById('loginStatus');
  const errorDialog = document.getElementById('loginErrorDialog');
  const errorMessage = document.getElementById('loginErrorMessage');
  const errorClose = document.getElementById('loginErrorClose');
  const forms = {
    user: document.getElementById('loginFormUser'),
    developer: document.getElementById('loginFormDeveloper')
  };
  const order = ['user', 'developer'];
  const AUTH_NOTICE_KEY = 'stella.auth.notice';
  const loginErrorTextKeys = Object.freeze({
    ACCOUNT_DISABLED: 'login.accountDisabled',
    SYSTEM_ACCESS_CLOSED: 'login.systemClosed',
    INVALID_USER_CREDENTIALS: 'login.userInvalid',
    INVALID_ADMIN_CREDENTIALS: 'login.adminInvalid'
  });
  let active = 'user';
  let setupRequired = false;
  let lastFocusedElement = null;

  function closeErrorDialog() {
    if (!errorDialog?.open) return;
    errorDialog.close();
    if (lastFocusedElement && document.contains(lastFocusedElement)) lastFocusedElement.focus();
  }

  function showErrorDialog(message) {
    if (!errorDialog?.showModal || !errorMessage) return;
    lastFocusedElement = document.activeElement;
    errorMessage.textContent = message;
    errorDialog.showModal();
    errorClose?.focus();
  }

  function switchTo(next) {
    if (next === active || !forms[next]) return;
    formsBox.dataset.dir = next === 'developer' ? 'fwd' : 'back';
    active = next;
    document.querySelector('.login-tabs').dataset.active = next;
    tabs.forEach(tab => {
      const isActive = tab.dataset.loginTab === next;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    Object.entries(forms).forEach(([name, form]) => {
      form.classList.toggle('is-active', name === next);
    });
    status.textContent = '';
    status.className = 'login-status';
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTo(tab.dataset.loginTab));
  });

  // 回车按表单顺序推进：账号 → 密码 → 登录按钮；按钮上再次回车提交
  Object.values(forms).forEach(form => {
    const steps = [
      form.querySelector('input[name="account"]'),
      form.querySelector('input[name="password"]'),
      form.querySelector('button[type="submit"]')
    ].filter(Boolean);
    steps.slice(0, -1).forEach((control, index) => {
      control.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        steps[index + 1].focus();
      });
    });
  });

  // 焦点不在文本输入框时，回车直接激活当前身份的登录按钮
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || event.repeat) return;
    const target = event.target;
    const isTextInput = target instanceof HTMLInputElement
      && ['text', 'password', 'email', 'search', 'tel', 'url', 'number'].includes(target.type);
    if (isTextInput || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
    const submit = forms[active]?.querySelector('button[type="submit"]');
    if (!submit || target === submit) return;
    event.preventDefault();
    submit.click();
  });

  // Tab 键 = 身份切换（Shift+Tab 反向），不移动浏览器焦点
  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const current = order.indexOf(active);
    const next = event.shiftKey
      ? order[(current - 1 + order.length) % order.length]
      : order[(current + 1) % order.length];
    switchTo(next);
  });

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const textKey = loginErrorTextKeys[data.code];
      const message = textKey ? t(textKey) : (data.error || t('login.notConnected'));
      const error = new Error(message);
      error.code = data.code;
      throw error;
    }
    return data;
  }

  async function postLogin(payload) {
    return postJson('/api/auth/login', { ...payload, ...await readDeviceContext() });
  }

  function browserName() {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Edg/')) return 'Microsoft Edge';
    if (userAgent.includes('Chrome/')) return 'Google Chrome';
    if (userAgent.includes('Firefox/')) return 'Mozilla Firefox';
    if (userAgent.includes('Safari/')) return 'Safari';
    return '浏览器';
  }

  async function readDeviceContext() {
    const storageKey = 'stella.device.id';
    let deviceId = '';
    try {
      deviceId = localStorage.getItem(storageKey) || '';
      if (!deviceId) {
        deviceId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(storageKey, deviceId);
      }
    } catch {
      deviceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
    const traits = [
      deviceId,
      navigator.userAgent,
      navigator.platform,
      navigator.language,
      (navigator.languages || []).join(','),
      timeZone,
      navigator.hardwareConcurrency || 0,
      navigator.deviceMemory || 0,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      navigator.maxTouchPoints || 0
    ].join('|');
    let deviceFingerprint = '';
    if (crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(traits));
      deviceFingerprint = [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return {
      deviceId,
      deviceFingerprint,
      deviceName: `${navigator.platform || '未知平台'} · ${browserName()}`
    };
  }

  function fail(message) {
    status.textContent = message;
    status.className = 'login-status error';
    showErrorDialog(message);
  }

  errorClose?.addEventListener('click', closeErrorDialog);
  errorDialog?.addEventListener('cancel', event => {
    event.preventDefault();
    closeErrorDialog();
  });
  errorDialog?.addEventListener('click', event => {
    if (event.target === errorDialog) closeErrorDialog();
  });

  try {
    const notice = sessionStorage.getItem(AUTH_NOTICE_KEY);
    sessionStorage.removeItem(AUTH_NOTICE_KEY);
    if (notice === 'system-access-closed') fail(t('login.sessionClosedBySystem'));
    else if (notice === 'session-revoked') fail(t('login.sessionRevoked'));
  } catch {}

  forms.user.addEventListener('submit', async event => {
    event.preventDefault();
    const account = forms.user.account.value.trim();
    const password = forms.user.password.value;
    try {
      await postLogin({
        role: 'user',
        account,
        password,
        remember: Boolean(forms.user.remember?.checked)
      });
      status.textContent = '';
      window.location.href = '/?page=personalCenter';
    } catch (error) {
      fail(error.message);
    }
  });

  forms.developer.addEventListener('submit', async event => {
    event.preventDefault();
    const account = forms.developer.account.value.trim();
    const password = forms.developer.password.value;
    try {
      if (setupRequired) {
        await postJson('/api/auth/setup', { password });
        setupRequired = false;
        forms.developer.account.value = 'administrator';
        forms.developer.querySelector('[name="account"]').closest('.login-field').hidden = false;
        document.querySelector('.login-card-title').textContent = t('login.cardTitle');
        forms.developer.querySelector('button[type="submit"]').textContent = t('login.submit');
        status.textContent = t('login.setupDone');
        status.className = 'login-status success';
        return;
      }
      await postLogin({ role: 'developer', account, password, remember: true });
      status.textContent = '';
      window.location.href = '/?page=personalCenter';
    } catch (error) {
      fail(error.message);
    }
  });

  fetch('/api/auth/status')
    .then(response => response.json())
    .then(data => {
      if (!data.setupRequired) return;
      setupRequired = true;
      switchTo('developer');
      forms.developer.querySelector('[name="account"]').closest('.login-field').hidden = true;
      document.querySelector('.login-card-title').textContent = t('login.setupTitle');
      document.querySelector('.login-hint').textContent = t('login.setupDesc');
      forms.developer.querySelector('button[type="submit"]').textContent = t('login.setupSubmit');
      forms.developer.password.focus();
    })
    .catch(() => {});
})();
