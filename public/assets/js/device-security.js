// Device security center: trusted devices, security password, auto-login and lease management.
// Mounted as the "devices" tab inside the profile settings dialog. All copy comes from the
// ui-text catalog (devices.* namespace); this source must stay free of CJK characters.
(function () {
  'use strict';

  // Must mirror SENSITIVE_PAGES in server/device-security-service.js
  const SENSITIVE_PAGES = ['friends', 'addFriend', 'channels', 'bp', 'countdown', 'bracket', 'materials'];
  const AUTO_LOGIN_KEY = 'stella.autoLogin.token';
  const WINDOW_OPTIONS = [
    { minutes: 0, key: 'devices.window0' },
    { minutes: 60, key: 'devices.window60' },
    { minutes: 480, key: 'devices.window480' },
    { minutes: 1440, key: 'devices.window1440' },
    { minutes: 10080, key: 'devices.window10080' }
  ];
  const LEASE_OPTIONS = [
    { value: 'off', key: 'devices.leaseNone' },
    { value: '7', key: 'devices.lease7' },
    { value: '30', key: 'devices.lease30' },
    { value: '90', key: 'devices.lease90' },
    { value: '365', key: 'devices.lease365' },
    { value: 'permanent', key: 'devices.leasePermanent' }
  ];
  const CREDENTIAL_TYPE_LABELS = {
    numeric: 'devices.typeNumeric',
    pattern: 'devices.typePattern',
    mixed: 'devices.typeMixed'
  };

  const root = document.getElementById('deviceSecurityRoot');
  let cachedSecurity = null; // /api/auth/session security summary, kept fresh for the page gate
  let overview = null; // last /api/security/overview payload
  let accountsCache = null; // developer account dropdown source
  let view = { name: 'idle' };
  let opened = false;
  let pendingPage = null;
  let pagesDialog = null;
  let pagesSecretControl = null;

  const text = (key, params) => window.text(key, undefined, params);

  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('data-icon', name);
    return svg;
  }

  async function api(url, options = {}) {
    return window.StellaDataCache.json(url, options);
  }

  function invalidateSecurity() {
    window.StellaDataCache?.invalidate('/api/security');
    window.StellaDataCache?.invalidate('/api/auth/session');
    window.StellaDataCache?.invalidate('/api/profile');
  }

  async function mutate(url, method, body) {
    const result = await api(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {})
    });
    invalidateSecurity();
    return result;
  }

  async function refreshSecuritySummary() {
    try {
      const data = await api('/api/auth/session', { force: true });
      cachedSecurity = data?.security || null;
    } catch {
      // Keep the last known summary; the server enforces the real gate anyway.
    }
  }

  function formatTime(iso) {
    if (!iso) return '-';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
  }

  function setBusy(node, busy) {
    if (node) node.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  // ---- shared form pieces ----

  function statusLine() {
    const node = el('div', 'ds-status');
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    return node;
  }

  function fieldRow(labelText, control, helpText) {
    const label = el('label', 'form-stack ds-field');
    const caption = el('span', 'field-label', labelText);
    label.append(caption, control);
    if (helpText) label.appendChild(el('small', 'ds-help', helpText));
    return label;
  }

  function secretInput(type, props = {}) {
    if (type === 'pattern') return patternField();
    const input = el('input', 'input ds-secret-input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.enterKeyHint = 'done';
    if (type === 'numeric') {
      input.inputMode = 'numeric';
      input.maxLength = 12;
    } else {
      input.maxLength = 64;
    }
    if (props.placeholder) input.placeholder = props.placeholder;
    return input;
  }

  function secretValue(control) {
    return control?.value ?? '';
  }

  // 3x3 pattern lock; stores the path as digit indexes 0-8 joined in stroke order
  function patternField() {
    const wrap = el('div', 'ds-pattern');
    wrap.setAttribute('aria-hidden', 'true');
    const dots = [];
    let sequence = [];
    let pressing = false;
    for (let index = 0; index < 9; index += 1) {
      const dot = el('div', 'ds-pattern-dot');
      dot.dataset.index = String(index);
      dots.push(dot);
      wrap.appendChild(dot);
    }
    const addDot = dot => {
      const index = Number(dot.dataset.index);
      if (Number.isNaN(index) || sequence.includes(index)) return;
      sequence.push(index);
      dot.classList.add('is-on');
    };
    const dotAt = event => document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.ds-pattern-dot');
    wrap.addEventListener('pointerdown', event => {
      const dot = event.target.closest('.ds-pattern-dot');
      if (!dot) return;
      event.preventDefault();
      pressing = true;
      addDot(dot);
    });
    wrap.addEventListener('pointermove', event => {
      if (!pressing) return;
      const dot = dotAt(event);
      if (dot) addDot(dot);
    });
    const release = () => { pressing = false; };
    wrap.addEventListener('pointerup', release);
    wrap.addEventListener('pointercancel', release);
    return {
      isPattern: true,
      node: wrap,
      get value() { return sequence.join(''); },
      reset() {
        sequence = [];
        dots.forEach(dot => dot.classList.remove('is-on'));
      }
    };
  }

  function selectControl(options, currentValue) {
    const select = el('select', 'input ds-select');
    for (const option of options) {
      const node = el('option', '', option.label);
      node.value = option.value;
      if (option.value === currentValue) node.selected = true;
      select.appendChild(node);
    }
    return select;
  }

  // ---- data loading ----

  function initialView(data) {
    if (!data.viewer.isDeveloper && data.target.isSelf) {
      if (!data.credential.configured) return { name: 'challenge', purpose: 'setup' };
      if (!data.unlocked?.devices) return { name: 'verify' };
    }
    return { name: 'manage' };
  }

  async function loadOverview(userId) {
    view = { name: 'loading' };
    render();
    try {
      const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
      overview = await api(`/api/security/overview${query}`, { force: true });
      view = initialView(overview);
    } catch (error) {
      view = { name: 'error', message: error.message };
    }
    render();
  }

  async function loadAccounts(force = false) {
    if (accountsCache && !force) return accountsCache;
    try {
      const data = await api('/api/security/accounts', { force: true });
      accountsCache = data.accounts || [];
    } catch {
      accountsCache = null;
    }
    return accountsCache;
  }

  function open() {
    if (!root) return;
    opened = true;
    const targetId = overview?.target?.isSelf ? '' : overview?.target?.userId;
    loadOverview(targetId);
  }

  function close() {
    opened = false;
  }

  // ---- views ----

  function render() {
    if (!root) return;
    setBusy(root, view.name === 'loading');
    root.replaceChildren(buildView());
    window.PageText?.apply?.(root);
  }

  function buildView() {
    switch (view.name) {
      case 'loading': return buildLoading();
      case 'error': return buildError();
      case 'challenge': return buildChallenge();
      case 'define': return buildDefine();
      case 'verify': return buildVerify();
      case 'manage': return buildManage();
      default: return document.createDocumentFragment();
    }
  }

  function buildLoading() {
    const box = el('div', 'ds-loading');
    for (let index = 0; index < 3; index += 1) box.appendChild(el('span', 'ds-loading-bar'));
    return box;
  }

  function buildError() {
    const box = el('div', 'ds-card ds-error-card');
    const message = el('p', 'ds-error-text', view.message || text('devices.loadFailed'));
    const retry = el('button', 'btn btn-secondary', text('devices.retry'));
    retry.type = 'button';
    retry.addEventListener('click', () => loadOverview(currentQueryUserId()));
    box.append(message, retry);
    return box;
  }

  function currentQueryUserId() {
    if (!overview) return '';
    return overview.target?.isSelf ? '' : overview.target?.userId;
  }

  // Step 1 of setup/reset: prove identity with the account login password
  function buildChallenge() {
    const card = el('div', 'ds-card');
    const title = el('h3', 'ds-card-title', text(view.purpose === 'reset' ? 'devices.resetTitle' : 'devices.setupTitle'));
    const desc = el('p', 'ds-card-desc', text(view.purpose === 'reset' ? 'devices.resetDesc' : 'devices.setupDesc'));
    const form = el('form', 'ds-form');
    const password = el('input', 'input');
    password.type = 'password';
    password.autocomplete = 'current-password';
    password.required = true;
    const status = statusLine();
    const submit = el('button', 'btn btn-primary', text('devices.verifyIdentity'));
    submit.type = 'submit';
    form.append(fieldRow(text('devices.accountPassword'), password), status);
    const actions = el('div', 'ds-actions');
    actions.appendChild(submit);
    if (view.purpose === 'reset') {
      const back = el('button', 'btn btn-secondary', text('common.cancel'));
      back.type = 'button';
      back.addEventListener('click', () => {
        view = { name: 'verify' };
        render();
      });
      actions.appendChild(back);
    }
    form.appendChild(actions);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = text('devices.checking');
      status.className = 'ds-status';
      try {
        await mutate('/api/security/devices/challenge-account', 'POST', { password: password.value });
        view = { name: 'define' };
        render();
      } catch (error) {
        status.textContent = error.message;
        status.className = 'ds-status is-error';
      } finally {
        submit.disabled = false;
      }
    });
    password.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        form.requestSubmit?.();
      }
    });
    card.append(title, desc, form);
    return card;
  }

  // Step 2 of setup/reset: define the security password itself
  function buildDefine() {
    const credentialType = view.type || 'numeric';
    const card = el('div', 'ds-card');
    card.appendChild(el('h3', 'ds-card-title', text('devices.defineTitle')));
    card.appendChild(el('p', 'ds-card-desc', text('devices.defineDesc')));

    const typeGroup = el('div', 'ds-type-grid');
    for (const [value, key] of Object.entries(CREDENTIAL_TYPE_LABELS)) {
      const option = el('button', 'ds-type-option', text(key));
      option.type = 'button';
      option.classList.toggle('is-active', value === credentialType);
      option.addEventListener('click', () => {
        view = { name: 'define', type: value };
        render();
      });
      typeGroup.appendChild(option);
    }

    const form = el('form', 'ds-form');
    const secret = secretInput(credentialType, { placeholder: text(`devices.secretPlaceholder.${credentialType}`) });
    const secretHost = el('div', 'ds-secret-host');
    secretHost.appendChild(secret.node || secret);
    const status = statusLine();
    const submit = el('button', 'btn btn-primary', text('devices.setCredential'));
    submit.type = 'submit';

    let confirmInput = null;
    if (credentialType !== 'pattern') {
      confirmInput = el('input', 'input');
      confirmInput.type = 'password';
      confirmInput.autocomplete = 'off';
      confirmInput.maxLength = 64;
      if (credentialType === 'numeric') confirmInput.inputMode = 'numeric';
    }
    const windowSelect = selectControl(
      WINDOW_OPTIONS.map(option => ({ value: String(option.minutes), label: text(option.key) })),
      String(view.windowMinutes ?? 60)
    );

    form.append(
      el('p', 'ds-secret-hint', text(`devices.secretHint.${credentialType}`)),
      secretHost
    );
    if (confirmInput) {
      form.appendChild(fieldRow(text('devices.confirmSecret'), confirmInput));
    }
    form.appendChild(fieldRow(text('devices.windowLabel'), windowSelect));
    form.appendChild(status);
    const actions = el('div', 'ds-actions');
    actions.appendChild(submit);
    const back = el('button', 'btn btn-secondary', text('common.cancel'));
    back.type = 'button';
    back.addEventListener('click', () => {
      view = overview?.credential.configured ? { name: 'verify' } : { name: 'challenge', purpose: 'setup' };
      render();
    });
    actions.appendChild(back);
    form.appendChild(actions);

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const value = secretValue(secret);
      if (credentialType === 'pattern' && value.length < 4) {
        status.textContent = text('devices.secretTooShort');
        status.className = 'ds-status is-error';
        return;
      }
      if (confirmInput && value !== confirmInput.value) {
        status.textContent = text('devices.secretMismatch');
        status.className = 'ds-status is-error';
        return;
      }
      submit.disabled = true;
      status.textContent = text('devices.saving');
      status.className = 'ds-status';
      try {
        await mutate('/api/security/credential', 'PUT', {
          type: credentialType,
          secret: value,
          windowMinutes: Number(windowSelect.value)
        });
        status.textContent = text('devices.saved');
        status.className = 'ds-status is-ok';
        await loadOverview(currentQueryUserId());
      } catch (error) {
        status.textContent = error.message;
        status.className = 'ds-status is-error';
      } finally {
        submit.disabled = false;
      }
    });

    card.append(typeGroup, form);
    return card;
  }

  // Unlock gate for the devices page itself
  function buildVerify() {
    const credentialType = overview?.credential.type || 'numeric';
    const card = el('div', 'ds-card');
    card.appendChild(el('h3', 'ds-card-title', text('devices.verifyTitle')));
    card.appendChild(el('p', 'ds-card-desc', text('devices.verifyDesc', { type: text(CREDENTIAL_TYPE_LABELS[credentialType]) })));

    const form = el('form', 'ds-form');
    const secret = secretInput(credentialType);
    const secretHost = el('div', 'ds-secret-host');
    secretHost.appendChild(secret.node || secret);
    const status = statusLine();
    const submit = el('button', 'btn btn-primary', text('devices.verify'));
    submit.type = 'submit';
    form.append(secretHost, status);
    const actions = el('div', 'ds-actions');
    actions.appendChild(submit);
    const forgot = el('button', 'btn btn-secondary', text('devices.forgot'));
    forgot.type = 'button';
    forgot.addEventListener('click', () => {
      view = { name: 'challenge', purpose: 'reset' };
      render();
    });
    actions.appendChild(forgot);
    form.appendChild(actions);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = text('devices.checking');
      status.className = 'ds-status';
      try {
        await mutate('/api/security/challenge-security', 'POST', { secret: secretValue(secret), scope: 'devices' });
        if (cachedSecurity) cachedSecurity.unlocked.devices = true;
        view = { name: 'manage' };
        render();
      } catch (error) {
        status.textContent = error.message;
        status.className = 'ds-status is-error';
      } finally {
        submit.disabled = false;
      }
    });
    card.append(form);
    return card;
  }

  // Main management view: credential settings + device list (+ developer extras)
  function buildManage() {
    const data = overview;
    if (!data) return buildLoading();
    const wrap = el('div', 'ds-stack');
    const status = statusLine();
    wrap.appendChild(status);

    if (data.viewer.isDeveloper) {
      wrap.appendChild(buildDeveloperBar(data));
      wrap.appendChild(buildCredentialCard(data, status));
    } else if (data.target.isSelf) {
      wrap.appendChild(buildSelfCredentialCard(data, status));
    }

    wrap.appendChild(buildDeviceSection(data, status));
    return wrap;
  }

  function buildDeveloperBar(data) {
    const bar = el('div', 'ds-card ds-developer-bar');
    const select = el('select', 'input ds-select');
    select.setAttribute('aria-label', text('devices.dev.accountSwitch'));
    const placeholder = el('option', '', text('devices.dev.accountSwitch'));
    placeholder.value = '';
    select.appendChild(placeholder);
    loadAccounts().then(accounts => {
      if (!accounts || !select.isConnected) return;
      for (const account of accounts) {
        const option = el('option', '', `${account.displayName} (${account.account})`);
        option.value = account.id;
        if (account.id === data.target.userId) option.selected = true;
        select.appendChild(option);
      }
    });
    select.addEventListener('change', () => {
      const userId = select.value;
      if (userId) loadOverview(userId);
    });
    const badge = el('span', 'ds-badge is-developer', text('devices.devMode'));
    bar.append(badge, select);
    return bar;
  }

  function buildCredentialCard(data, status) {
    const card = el('div', 'ds-card');
    card.appendChild(el('h3', 'ds-card-title', text('devices.credentialTitle')));
    const credential = data.credential;
    if (!credential.configured) {
      card.appendChild(el('p', 'ds-card-desc', text('devices.credentialMissing')));
      return card;
    }
    const grid = el('div', 'ds-meta-grid');
    grid.appendChild(metaRow(text('devices.credentialType'), text(CREDENTIAL_TYPE_LABELS[credential.type] || credential.type)));
    if (credential.secret != null) {
      const secretValueNode = el('strong', 'ds-secret-value', '••••••');
      secretValueNode.dataset.value = credential.secret;
      const toggle = el('button', 'btn btn-secondary ds-reveal', text('devices.dev.reveal'));
      toggle.type = 'button';
      toggle.addEventListener('click', () => {
        const revealed = secretValueNode.dataset.revealed === 'true';
        secretValueNode.textContent = revealed ? '••••••' : secretValueNode.dataset.value;
        secretValueNode.dataset.revealed = revealed ? 'false' : 'true';
        toggle.textContent = revealed ? text('devices.dev.reveal') : text('devices.dev.hide');
      });
      grid.appendChild(metaRow(text('devices.dev.password'), secretValueNode, toggle));
    }
    card.appendChild(grid);
    return card;
  }

  function buildSelfCredentialCard(data, status) {
    const card = el('div', 'ds-card');
    card.appendChild(el('h3', 'ds-card-title', text('devices.credentialTitle')));
    const grid = el('div', 'ds-meta-grid');
    const windowSelect = selectControl(
      WINDOW_OPTIONS.map(option => ({ value: String(option.minutes), label: text(option.key) })),
      String(data.credential.verifyWindowMinutes ?? 0)
    );
    windowSelect.addEventListener('change', async () => {
      windowSelect.disabled = true;
      try {
        await mutate('/api/security/window', 'PUT', { minutes: Number(windowSelect.value) });
        status.textContent = text('devices.windowSaved');
        status.className = 'ds-status is-ok';
      } catch (error) {
        status.textContent = error.message;
        status.className = 'ds-status is-error';
        windowSelect.value = String(data.credential.verifyWindowMinutes ?? 0);
      } finally {
        windowSelect.disabled = false;
      }
    });
    grid.appendChild(metaRow(text('devices.windowLabel'), windowSelect));
    grid.appendChild(metaRow(text('devices.credentialType'), text(CREDENTIAL_TYPE_LABELS[data.credential.type] || '')));
    const reset = el('button', 'btn btn-secondary', text('devices.resetCredential'));
    reset.type = 'button';
    reset.addEventListener('click', () => {
      view = { name: 'challenge', purpose: 'reset' };
      render();
    });
    grid.appendChild(metaRow(text('devices.resetCredential'), reset));
    card.appendChild(grid);
    return card;
  }

  function metaRow(label, control, extra) {
    const row = el('div', 'ds-meta-row');
    row.appendChild(el('span', 'ds-meta-label', label));
    const value = el('div', 'ds-meta-value');
    value.appendChild(control);
    if (extra) value.appendChild(extra);
    row.appendChild(value);
    return row;
  }

  function buildDeviceSection(data, status) {
    const section = el('div', 'ds-card');
    section.appendChild(el('h3', 'ds-card-title', text('devices.deviceList')));
    if (!data.devices.length) {
      section.appendChild(el('p', 'ds-empty', text('devices.emptyDevices')));
      return section;
    }
    const list = el('div', 'ds-device-list');
    for (const device of data.devices) {
      list.appendChild(buildDeviceCard(data, device, status));
    }
    section.appendChild(list);
    return section;
  }

  function buildDeviceCard(data, device, status) {
    const card = el('article', 'ds-device');
    const head = el('div', 'ds-device-head');
    const nameBox = el('div', 'ds-device-name');
    nameBox.appendChild(el('strong', '', device.deviceName || device.deviceModel || device.deviceOs || text('devices.unnamedDevice')));
    const badges = el('div', 'ds-badges');
    if (device.isCurrentDevice) badges.appendChild(el('span', 'ds-badge is-self', text('devices.currentDevice')));
    if (device.autoLoginEnabled) badges.appendChild(el('span', 'ds-badge is-auto', text('devices.autoLoginBadge')));
    if (device.leaseUntil) {
      badges.appendChild(el('span', 'ds-badge is-lease',
        device.leasePermanent ? text('devices.leasePermanentBadge') : text('devices.leaseActiveBadge')));
    }
    if (badges.children.length) nameBox.appendChild(badges);
    head.appendChild(nameBox);
    card.appendChild(head);

    const meta = el('div', 'ds-meta-grid');
    meta.appendChild(metaRow(text('devices.deviceType'), el('span', '', text(`devices.type.${device.deviceType || 'desktop'}`))));
    if (device.deviceOs) meta.appendChild(metaRow(text('devices.deviceOs'), el('span', '', device.deviceOs)));
    if (device.deviceModel) meta.appendChild(metaRow(text('devices.deviceModel'), el('span', '', device.deviceModel)));
    if (device.browser) meta.appendChild(metaRow(text('devices.browser'), el('span', '', device.browser)));
    meta.appendChild(metaRow(text('devices.lastLogin'), el('span', '', formatTime(device.lastLoginAt))));
    if (data.viewer.isDeveloper) {
      if (device.lastIp) meta.appendChild(metaRow(text('devices.dev.ip'), el('span', '', device.lastIp)));
      if (device.lastRegion) meta.appendChild(metaRow(text('devices.dev.region'), el('span', '', device.lastRegion)));
      if (device.fingerprint) {
        meta.appendChild(metaRow(text('devices.dev.fingerprint'), el('span', 'ds-mono', device.fingerprint.slice(0, 16))));
      }
      if (device.networkEnv) meta.appendChild(metaRow(text('devices.dev.network'), el('span', '', device.networkEnv)));
    }
    card.appendChild(meta);

    card.appendChild(buildDeviceActions(data, device, status));
    return card;
  }

  function buildDeviceActions(data, device, status) {
    const actions = el('div', 'ds-actions ds-device-actions');
    const ownerId = data.target.isSelf ? '' : data.target.userId;
    const put = payload => mutate(deviceUrl(device.id), 'PUT', { userId: ownerId, ...payload });

    if (device.autoLoginEnabled) {
      const disable = el('button', 'btn btn-secondary', text('devices.disableAutoLogin'));
      disable.type = 'button';
      disable.addEventListener('click', async () => {
        disable.disabled = true;
        try {
          await put({ autoLogin: false });
          status.textContent = text('devices.autoLoginDisabled');
          status.className = 'ds-status is-ok';
          await loadOverview(ownerId);
        } catch (error) {
          status.textContent = error.message;
          status.className = 'ds-status is-error';
          disable.disabled = false;
        }
      });
      actions.appendChild(disable);
    } else if (device.isCurrentDevice) {
      const enable = el('button', 'btn btn-secondary', text('devices.enableAutoLogin'));
      enable.type = 'button';
      enable.addEventListener('click', async () => {
        enable.disabled = true;
        try {
          const result = await put({ autoLogin: true });
          if (result.autoLogin?.token) {
            try { localStorage.setItem(AUTO_LOGIN_KEY, result.autoLogin.token); } catch { /* storage unavailable */ }
          }
          status.textContent = text('devices.autoLoginEnabled');
          status.className = 'ds-status is-ok';
          await loadOverview(ownerId);
        } catch (error) {
          status.textContent = error.message;
          status.className = 'ds-status is-error';
          enable.disabled = false;
        }
      });
      actions.appendChild(enable);
    }

    const leaseCurrent = device.leasePermanent
      ? 'permanent'
      : device.leaseUntil ? 'custom' : 'off';
    const leaseSelect = selectControl(
      [
        ...LEASE_OPTIONS.map(option => ({ value: option.value, label: text(option.key) })),
        ...(leaseCurrent === 'custom' ? [{ value: 'custom', label: `${text('devices.leaseUntil')} ${formatTime(device.leaseUntil)}` }] : [])
      ],
      leaseCurrent
    );
    leaseSelect.setAttribute('aria-label', text('devices.leaseLabel'));
    const applyLease = el('button', 'btn btn-secondary', text('devices.leaseApply'));
    applyLease.type = 'button';
    applyLease.addEventListener('click', async () => {
      const chosen = leaseSelect.value;
      let leaseUntil = null;
      if (chosen === 'permanent') leaseUntil = 'permanent';
      else if (chosen !== 'off' && chosen !== 'custom') leaseUntil = Date.now() + Number(chosen) * 24 * 60 * 60 * 1000;
      applyLease.disabled = true;
      try {
        await put({ leaseUntil });
        status.textContent = text('devices.leaseSaved');
        status.className = 'ds-status is-ok';
        await loadOverview(ownerId);
      } catch (error) {
        status.textContent = error.message;
        status.className = 'ds-status is-error';
        applyLease.disabled = false;
      }
    });
    actions.append(leaseSelect, applyLease);

    const remove = el('button', 'btn btn-danger', text('devices.deleteDevice'));
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      const confirmed = await window.StellaDialog?.confirm({
        title: text('devices.deleteDevice'),
        message: text('devices.deleteConfirm'),
        tone: 'danger',
        confirmText: text('devices.deleteDevice'),
        cancelText: text('common.cancel')
      });
      if (!confirmed) return;
      remove.disabled = true;
      try {
        const query = ownerId ? `?userId=${encodeURIComponent(ownerId)}` : '';
        await mutate(`/api/security/devices/${encodeURIComponent(device.id)}${query}`, 'DELETE');
        status.textContent = text('devices.deleted');
        status.className = 'ds-status is-ok';
        await loadOverview(ownerId);
      } catch (error) {
        status.textContent = error.message;
        status.className = 'ds-status is-error';
        remove.disabled = false;
      }
    });
    actions.appendChild(remove);
    return actions;
  }

  function deviceUrl(deviceId) {
    return `/api/security/devices/${encodeURIComponent(deviceId)}`;
  }

  // ---- lease page gate + unlock dialog ----

  function buildPagesDialog() {
    const dialog = el('dialog', 'profile-dialog ds-pages-dialog');
    const form = el('form', 'ds-form');
    const header = el('div', 'ds-dialog-header');
    header.appendChild(el('h2', 'ds-dialog-title', text('devices.pagesTitle')));
    const close = el('button', 'icon-button profile-dialog-close');
    close.type = 'button';
    close.setAttribute('aria-label', text('common.close'));
    close.appendChild(icon('x'));
    header.appendChild(close);
    const desc = el('p', 'ds-card-desc', text('devices.pagesDesc'));
    const secretHost = el('div', 'ds-secret-host');
    const status = statusLine();
    const actions = el('div', 'ds-actions');
    const cancel = el('button', 'btn btn-secondary', text('common.cancel'));
    cancel.type = 'button';
    const verify = el('button', 'btn btn-primary', text('devices.pagesVerify'));
    verify.type = 'submit';
    actions.append(cancel, verify);
    form.append(header, desc, secretHost, status, actions);
    dialog.appendChild(form);
    document.body.appendChild(dialog);

    close.addEventListener('click', () => dialog.close());
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => event.preventDefault());
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      verify.disabled = true;
      status.textContent = text('devices.checking');
      status.className = 'ds-status';
      try {
        await mutate('/api/security/challenge-security', 'POST', { secret: secretValue(pagesSecretControl), scope: 'pages' });
        if (cachedSecurity) cachedSecurity.unlocked.pages = true;
        dialog.close();
        retryPendingPage();
      } catch (error) {
        status.textContent = error.message;
        status.className = 'ds-status is-error';
      } finally {
        verify.disabled = false;
      }
    });
    return dialog;
  }

  function openPagesDialog() {
    if (!cachedSecurity?.configured) {
      window.StellaDialog?.alert({
        title: text('devices.pagesTitle'),
        message: text('devices.pagesNotConfigured')
      });
      return;
    }
    const type = cachedSecurity.type || 'numeric';
    if (!pagesDialog) pagesDialog = buildPagesDialog();
    pagesDialog.dataset.credentialType = type;
    const host = pagesDialog.querySelector('.ds-secret-host');
    const control = secretInput(type);
    pagesSecretControl = control;
    host.replaceChildren(control.node || control);
    const status = pagesDialog.querySelector('.ds-status');
    if (status) {
      status.textContent = '';
      status.className = 'ds-status';
    }
    pagesDialog.showModal();
  }

  function retryPendingPage() {
    const page = pendingPage;
    pendingPage = null;
    if (!page) return;
    document.querySelector(`[data-page="${page}"]`)?.click();
  }

  window.addEventListener('stella:before-page-change', event => {
    const page = event.detail?.page;
    if (!page || !SENSITIVE_PAGES.includes(page)) return;
    const security = cachedSecurity;
    if (!security || !security.leaseGated || security.unlocked?.pages) return;
    event.preventDefault();
    pendingPage = page;
    openPagesDialog();
  });

  window.addEventListener('stella:page-change', event => {
    refreshSecuritySummary();
    // Standalone page: (re)load the panel whenever the devices page becomes active
    if (event.detail?.page === 'devices') open();
  });
  window.addEventListener('stella:identity-change', () => {
    accountsCache = null;
    overview = null;
    if (opened) loadOverview('');
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshSecuritySummary();
  });

  window.DeviceSecurity = Object.freeze({ open, close });
  refreshSecuritySummary();
})();
