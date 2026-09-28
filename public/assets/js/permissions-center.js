(function () {
  'use strict';

  const elements = {
    page: document.getElementById('permissionsPage'),
    tabs: document.querySelectorAll('[data-permissions-tab]'),
    panels: document.querySelectorAll('[data-permissions-panel]'),
    pageStatus: document.getElementById('permissionsPageStatus'),
    accountSearch: document.getElementById('permissionAccountSearch'),
    accountList: document.getElementById('permissionAccountList'),
    accountHeading: document.getElementById('permissionAccountHeading'),
    accountMeta: document.getElementById('permissionAccountMeta'),
    accountEffective: document.getElementById('permissionAccountEffective'),
    accountContext: document.getElementById('permissionAccountIdentityContext'),
    accountMatrix: document.getElementById('permissionAccountMatrix'),
    accountStatus: document.getElementById('permissionAccountStatus'),
    accountSave: document.getElementById('permissionAccountSave'),
    identityList: document.getElementById('permissionIdentityList'),
    identityHeading: document.getElementById('permissionIdentityHeading'),
    identityMeta: document.getElementById('permissionIdentityMeta'),
    identityCount: document.getElementById('permissionIdentityCount'),
    identityMatrix: document.getElementById('permissionIdentityMatrix'),
    identityStatus: document.getElementById('permissionIdentityStatus'),
    identitySave: document.getElementById('permissionIdentitySave'),
    catalog: document.getElementById('permissionCatalog'),
    safeguards: document.getElementById('permissionSafeguards')
  };

  let snapshot = null;
  let loaded = false;
  let selectedAccountId = '';
  let accountIdentityKey = '';
  let accountDraft = new Map();
  let accountDirty = false;
  let selectedIdentityKey = '';
  let identityDraft = new Set();
  let identityDirty = false;

  function requestJson(url, options) {
    return window.StellaDataCache.json(url, options);
  }

  function setStatus(target, message, type = '') {
    target.textContent = message;
    target.className = type ? `is-${type}` : '';
  }

  function groupFor(key) {
    return snapshot.groups.find(group => group.key === key)?.label || key;
  }

  function identityLabel(key) {
    return snapshot.identities.find(identity => identity.key === key)?.label || key;
  }

  function selectedAccount() {
    return snapshot?.accounts.find(account => account.id === selectedAccountId) || null;
  }

  function selectedIdentity() {
    return snapshot?.identities.find(identity => identity.key === selectedIdentityKey) || null;
  }

  async function canLeaveDirtyEditor() {
    if (!accountDirty && !identityDirty) return true;
    return window.StellaDialog.confirm({
      title: t('permissions.dirtyTitle'),
      message: t('permissions.dirtyMessage'),
      confirmText: t('permissions.dirtyConfirm'),
      tone: 'danger'
    });
  }

  function clearDirty() {
    accountDirty = false;
    identityDirty = false;
  }

  function activateTab(tabKey) {
    elements.tabs.forEach(button => {
      const active = button.dataset.permissionsTab === tabKey;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    elements.panels.forEach(panel => {
      const active = panel.dataset.permissionsPanel === tabKey;
      panel.hidden = !active;
      panel.tabIndex = active ? 0 : -1;
    });
  }

  function dependencyCopy(permission) {
    const dependencies = permission.dependsOn || [];
    if (!dependencies.length) return '';
    const labels = dependencies.map(key => snapshot.catalog.find(item => item.key === key)?.label || key);
    return text('permissions.prerequisiteList', ' 前置权限：{labels}。', { labels: labels.join('、') });
  }

  function selectorButton(title, subtitle, active, click) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `permissions-selector-item${active ? ' is-active' : ''}`;
    const strong = document.createElement('strong');
    strong.textContent = title;
    const span = document.createElement('span');
    span.textContent = subtitle;
    button.append(strong, span);
    button.addEventListener('click', click);
    return button;
  }

  function renderAccountList() {
    const query = elements.accountSearch.value.trim().toLocaleLowerCase('zh-CN');
    const accounts = snapshot.accounts.filter(account => {
      const text = `${account.displayName} ${account.account}`.toLocaleLowerCase('zh-CN');
      return !query || text.includes(query);
    });
    elements.accountList.replaceChildren(...accounts.map(account => selectorButton(
      account.displayName,
      `${account.account} · ${account.identityKeys.map(identityLabel).join(' / ')}`,
      account.id === selectedAccountId,
      () => selectAccount(account.id)
    )));
    if (!accounts.length) {
      const empty = document.createElement('div');
      empty.className = 'permissions-selector-item';
      empty.textContent = text('permissions.noMatchingAccounts', '没有匹配的账号');
      elements.accountList.replaceChildren(empty);
    }
  }

  function effectiveForDraft(account, identityKey) {
    if (identityKey === 'developer') return snapshot.catalog.map(item => item.key);
    const inherited = new Set(snapshot.identities.find(item => item.key === identityKey)?.permissions || []);
    return snapshot.catalog.filter(permission => {
      const mode = accountDraft.get(permission.key) || 'inherit';
      if (mode === 'deny') return false;
      if (mode === 'grant') return true;
      return inherited.has(permission.key);
    }).map(item => item.key);
  }

  function updateAccountSummary() {
    const account = selectedAccount();
    if (!account) return;
    const count = effectiveForDraft(account, accountIdentityKey).length;
    elements.accountEffective.textContent = text('permissions.accountEffectiveCount', '{count} / {total} 项有效', { count, total: snapshot.catalog.length });
  }

  function renderAccountContext(account) {
    elements.accountContext.replaceChildren(...account.identityKeys.map(key => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `permissions-context-chip${key === accountIdentityKey ? ' is-active' : ''}`;
      button.textContent = text('permissions.previewAction', '{label}预览', { label: identityLabel(key) });
      button.addEventListener('click', () => {
        accountIdentityKey = key;
        renderAccountEditor();
      });
      return button;
    }));
  }

  function permissionCopy(permission, inherited) {
    const copy = document.createElement('div');
    copy.className = 'permission-copy';
    const strong = document.createElement('strong');
    strong.textContent = permission.label;
    const code = document.createElement('code');
    code.textContent = permission.key;
    strong.append(code);
    const description = document.createElement('p');
    description.textContent = `${permission.description}${dependencyCopy(permission)}${inherited == null ? '' : inherited ? text('permissions.inheritedAllow', ' 当前身份默认允许。') : text('permissions.inheritedDeny', ' 当前身份默认不允许。')}`;
    copy.append(strong, description);
    return copy;
  }

  function renderGroups(container, rowFactory) {
    container.replaceChildren(...snapshot.groups.map(group => {
      const permissions = snapshot.catalog.filter(permission => permission.group === group.key);
      if (!permissions.length) return null;
      const section = document.createElement('section');
      section.className = 'permission-group';
      const heading = document.createElement('div');
      heading.className = 'permission-group-heading';
      const title = document.createElement('h3');
      title.textContent = group.label;
      const count = document.createElement('span');
      count.textContent = text('permissions.permissionCount', '{count} 项', { count: permissions.length });
      heading.append(title, count);
      section.append(heading, ...permissions.map(rowFactory));
      return section;
    }).filter(Boolean));
  }

  function accountModeControl(permission) {
    const control = document.createElement('div');
    control.className = 'permission-mode';
    control.setAttribute('role', 'radiogroup');
    control.setAttribute('aria-label', text('permissions.accountOverrideAria', '{label}账号例外', { label: permission.label }));
    ['inherit', 'grant', 'deny'].forEach(mode => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.mode = mode;
      button.setAttribute('role', 'radio');
      button.textContent = { inherit: text('permissions.modeInherit', '继承'), grant: text('permissions.modeGrant', '允许'), deny: text('permissions.modeDeny', '拒绝') }[mode];
      const active = (accountDraft.get(permission.key) || 'inherit') === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-checked', String(active));
      button.addEventListener('click', () => {
        accountDraft.set(permission.key, mode);
        accountDirty = true;
        elements.accountSave.disabled = false;
        setStatus(elements.accountStatus, text('permissions.accountUnsaved', '有未保存的账号权限修改'));
        control.querySelectorAll('button').forEach(item => {
          const selected = item.dataset.mode === mode;
          item.classList.toggle('is-active', selected);
          item.setAttribute('aria-checked', String(selected));
        });
        updateAccountSummary();
      });
      control.append(button);
    });
    return control;
  }

  function renderAccountEditor() {
    const account = selectedAccount();
    if (!account) return;
    if (!account.identityKeys.includes(accountIdentityKey)) accountIdentityKey = account.identityKeys[0];
    elements.accountHeading.textContent = account.displayName;
    elements.accountMeta.textContent = text('permissions.accountMeta', '{account} · {state} · 明确拒绝优先于允许与继承', {
      account: account.account,
      state: account.status === 'active' ? text('permissions.accountActive', '账号已启用') : text('permissions.accountDisabled', '账号已停用')
    });
    renderAccountContext(account);
    const inherited = new Set(snapshot.identities.find(item => item.key === accountIdentityKey)?.permissions || []);
    renderGroups(elements.accountMatrix, permission => {
      const row = document.createElement('div');
      row.className = 'permission-row';
      row.append(permissionCopy(permission, accountIdentityKey === 'developer' || inherited.has(permission.key)), accountModeControl(permission));
      return row;
    });
    elements.accountSave.disabled = !accountDirty;
    updateAccountSummary();
  }

  async function selectAccount(accountId, force = false) {
    if (!force && accountId !== selectedAccountId && accountDirty && !await canLeaveDirtyEditor()) return;
    accountDirty = false;
    selectedAccountId = accountId;
    const account = selectedAccount();
    accountIdentityKey = account?.identityKeys[0] || '';
    accountDraft = new Map(snapshot.catalog.map(permission => [
      permission.key,
      account?.denies.includes(permission.key) ? 'deny' : account?.grants.includes(permission.key) ? 'grant' : 'inherit'
    ]));
    setStatus(elements.accountStatus, '');
    renderAccountList();
    renderAccountEditor();
  }

  function renderIdentityList() {
    elements.identityList.replaceChildren(...snapshot.identities.map(identity => selectorButton(
      identity.label,
      identity.immutable ? text('permissions.builtinIdentity', '系统固有全权限') : text('permissions.identityStats', '{accounts} 个账号 · {permissions} 项权限', { accounts: identity.accountCount, permissions: identity.permissions.length }),
      identity.key === selectedIdentityKey,
      () => selectIdentity(identity.key)
    )));
  }

  function renderIdentityEditor() {
    const identity = selectedIdentity();
    if (!identity) return;
    elements.identityHeading.textContent = identity.label;
    elements.identityMeta.textContent = identity.immutable
      ? text('permissions.developerProtected', '开发者身份由系统固有保护，权限不可移除。')
      : text('permissions.identitySaveImpact', '保存后会影响所有拥有该身份的 {count} 个账号。', { count: identity.accountCount });
    elements.identityCount.textContent = text('permissions.identityEnabledCount', '{count} / {total} 项启用', { count: identityDraft.size, total: snapshot.catalog.length });
    renderGroups(elements.identityMatrix, permission => {
      const row = document.createElement('div');
      row.className = 'permission-row';
      const label = document.createElement('label');
      label.className = 'permission-check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = identity.immutable || identityDraft.has(permission.key);
      input.disabled = identity.immutable;
      const state = document.createElement('span');
      state.textContent = input.checked ? text('permissions.stateEnabled', '已启用') : text('permissions.stateDisabled', '未启用');
      input.addEventListener('change', () => {
        if (input.checked) identityDraft.add(permission.key);
        else identityDraft.delete(permission.key);
        state.textContent = input.checked ? text('permissions.stateEnabled', '已启用') : text('permissions.stateDisabled', '未启用');
        identityDirty = true;
        elements.identitySave.disabled = false;
        elements.identityCount.textContent = text('permissions.identityEnabledCount', '{count} / {total} 项启用', { count: identityDraft.size, total: snapshot.catalog.length });
        setStatus(elements.identityStatus, text('permissions.identityUnsaved', '有未保存的身份权限修改'));
      });
      label.append(input, state);
      row.append(permissionCopy(permission, null), label);
      return row;
    });
    elements.identitySave.disabled = identity.immutable || !identityDirty;
  }

  async function selectIdentity(identityKey, force = false) {
    if (!force && identityKey !== selectedIdentityKey && identityDirty && !await canLeaveDirtyEditor()) return;
    identityDirty = false;
    selectedIdentityKey = identityKey;
    identityDraft = new Set(selectedIdentity()?.permissions || []);
    setStatus(elements.identityStatus, '');
    renderIdentityList();
    renderIdentityEditor();
  }

  function renderCatalog() {
    elements.catalog.replaceChildren(...snapshot.catalog.map(permission => {
      const row = document.createElement('div');
      row.className = 'permission-catalog-row';
      const name = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = permission.label;
      const code = document.createElement('code');
      code.textContent = permission.key;
      name.append(strong, code);
      const description = document.createElement('p');
      description.textContent = `${groupFor(permission.group)} · ${permission.description}${dependencyCopy(permission)}`;
      const risk = document.createElement('span');
      risk.className = `permission-risk${permission.risk === 'high' ? ' is-high' : ''}`;
      risk.textContent = permission.risk === 'high' ? text('permissions.riskHigh', '高风险') : text('permissions.riskNormal', '常规');
      row.append(name, description, risk);
      return row;
    }));
  }

  function renderSafeguards() {
    elements.safeguards.replaceChildren(...snapshot.safeguards.map(rule => {
      const row = document.createElement('div');
      row.className = 'permission-safeguard-row';
      const title = document.createElement('strong');
      title.textContent = rule.label;
      const description = document.createElement('p');
      description.textContent = rule.description;
      const lock = document.createElement('span');
      lock.className = 'permission-lock';
      lock.innerHTML = `<svg viewBox="0 0 24 24" data-icon="lock" aria-hidden="true"></svg><span>${text('permissions.enforced', '强制执行')}</span>`;
      row.append(title, description, lock);
      return row;
    }));
  }

  function render() {
    renderCatalog();
    renderSafeguards();
    const firstAccount = snapshot.accounts.find(account => account.id === selectedAccountId) || snapshot.accounts[0];
    const firstIdentity = snapshot.identities.find(identity => identity.key === selectedIdentityKey) || snapshot.identities[0];
    if (firstAccount) selectAccount(firstAccount.id, true);
    if (firstIdentity) selectIdentity(firstIdentity.key, true);
  }

  async function load(force = false) {
    if (loaded && !force) return;
    elements.page.setAttribute('aria-busy', 'true');
    setStatus(elements.pageStatus, text('permissions.loadingPolicy', '正在读取权限策略…'));
    try {
      snapshot = await requestJson('/api/admin/permissions', { force });
      clearDirty();
      render();
      loaded = true;
      setStatus(elements.pageStatus, '');
    } catch (error) {
      setStatus(elements.pageStatus, text('permissions.loadFailed', '读取权限策略失败：{message}', { message: error.message }), 'error');
    } finally {
      elements.page.removeAttribute('aria-busy');
    }
  }

  elements.tabs.forEach(button => {
    button.addEventListener('click', async () => {
      const active = Array.from(elements.tabs).find(item => item.getAttribute('aria-selected') === 'true');
      if (active !== button && !await canLeaveDirtyEditor()) return;
      if (active !== button) {
        clearDirty();
        if (selectedAccountId) selectAccount(selectedAccountId, true);
        if (selectedIdentityKey) selectIdentity(selectedIdentityKey, true);
      }
      activateTab(button.dataset.permissionsTab);
    });
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = Array.from(elements.tabs);
      const currentIndex = tabs.indexOf(button);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    });
  });

  elements.accountSearch.addEventListener('input', renderAccountList);

  elements.accountSave.addEventListener('click', async () => {
    const account = selectedAccount();
    if (!account) return;
    const grants = [];
    const denies = [];
    accountDraft.forEach((mode, key) => {
      if (mode === 'grant') grants.push(key);
      if (mode === 'deny') denies.push(key);
    });
    elements.accountSave.disabled = true;
    setStatus(elements.accountStatus, text('permissions.savingAccount', '正在保存账号权限…'));
    try {
      snapshot = await requestJson(`/api/admin/permissions/accounts/${encodeURIComponent(account.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grants, denies })
      });
      accountDirty = false;
      render();
      setStatus(elements.accountStatus, text('permissions.accountSaved', '账号权限已保存'), 'success');
      window.dispatchEvent(new CustomEvent('stella:permissions-change'));
    } catch (error) {
      elements.accountSave.disabled = false;
      setStatus(elements.accountStatus, text('permissions.saveFailed', '保存失败：{message}', { message: error.message }), 'error');
    }
  });

  elements.identitySave.addEventListener('click', async () => {
    const identity = selectedIdentity();
    if (!identity || identity.immutable) return;
    elements.identitySave.disabled = true;
    setStatus(elements.identityStatus, text('permissions.savingIdentity', '正在保存身份权限…'));
    try {
      snapshot = await requestJson(`/api/admin/permissions/identities/${encodeURIComponent(identity.key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: [...identityDraft] })
      });
      identityDirty = false;
      render();
      setStatus(elements.identityStatus, text('permissions.identitySaved', '身份权限已保存'), 'success');
      window.dispatchEvent(new CustomEvent('stella:permissions-change'));
    } catch (error) {
      elements.identitySave.disabled = false;
      setStatus(elements.identityStatus, text('permissions.saveFailed', '保存失败：{message}', { message: error.message }), 'error');
    }
  });

  window.addEventListener('stella:page-change', event => {
    if (event.detail?.page === 'permissions') load();
  });
  window.addEventListener('stella:identity-change', () => {
    loaded = false;
    if (!elements.page.hidden) load(true);
  });

  activateTab('accounts');
  window.PermissionsCenter = { load };
})();
