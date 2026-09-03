(function () {
  const elements = {
    page: document.getElementById('accountsPage'),
    create: document.getElementById('accountCreate'),
    summary: document.getElementById('accountsSummary'),
    body: document.getElementById('accountsTableBody'),
    status: document.getElementById('accountsStatus'),
    dialog: document.getElementById('accountEditorDialog'),
    form: document.getElementById('accountEditorForm'),
    heading: document.getElementById('accountEditorTitle'),
    close: document.getElementById('accountEditorClose'),
    cancel: document.getElementById('accountEditorCancel'),
    save: document.getElementById('accountEditorSave'),
    editorStatus: document.getElementById('accountEditorFeedback'),
    id: document.getElementById('accountEditorId'),
    account: document.getElementById('accountEditorAccount'),
    name: document.getElementById('accountEditorName'),
    identities: document.querySelectorAll('input[name="accountIdentity"]'),
    accountStatuses: document.querySelectorAll('input[name="accountStatus"]'),
    expiry: document.getElementById('accountEditorExpiry'),
    password: document.getElementById('accountEditorPassword'),
    title: document.getElementById('accountEditorTitleInput'),
    titleReview: document.getElementById('accountEditorTitleReview'),
    region: document.getElementById('accountEditorRegion'),
    genders: document.querySelectorAll('input[name="accountGender"]'),
    birthDate: document.getElementById('accountEditorBirthDate'),
    bio: document.getElementById('accountEditorBio'),
    avatar: document.getElementById('accountEditorAvatar'),
    avatarInput: document.getElementById('accountEditorAvatarInput'),
    avatarRemove: document.getElementById('accountEditorAvatarRemove'),
    cover: document.getElementById('accountEditorCover'),
    coverInput: document.getElementById('accountEditorCoverInput'),
    coverRemove: document.getElementById('accountEditorCoverRemove'),
    remove: document.getElementById('accountDelete'),
    deleteConfirm: document.getElementById('accountDeleteConfirm'),
    confirmDelete: document.getElementById('accountDeleteConfirmButton'),
    importInput: document.getElementById('accountImportInput'),
    selectAll: document.getElementById('accountsSelectAll'),
    selectionCount: document.getElementById('accountsSelectionCount'),
    bulkEnable: document.getElementById('accountsBulkEnable'),
    bulkDisable: document.getElementById('accountsBulkDisable'),
    bulkDelete: document.getElementById('accountsBulkDelete'),
    sortHeadings: document.querySelectorAll('[data-accounts-sort-heading]'),
    sortButtons: document.querySelectorAll('[data-accounts-sort]')
  };

  const PRESENCE_REFRESH_INTERVAL_MS = 20 * 1000;
  const identityPriority = ['developer', 'administrator', 'director', 'commentator', 'referee', 'scorer', 'guest'];
  const presencePriority = ['working', 'online', 'busy', 'away', 'offline'];
  let accounts = [];
  let sortState = { key: '', direction: 'descending' };
  let loadPromise = null;
  let avatarDraft = '';
  let coverDraft = '';
  let avatarChanged = false;
  let coverChanged = false;

  function selectedIds() {
    return Array.from(elements.body.querySelectorAll('input[name="managedAccount"]:checked')).map(input => input.value);
  }

  function updateSelection() {
    const ids = selectedIds();
    elements.selectionCount.textContent = t('accounts.selectionCount', { count: ids.length });
    elements.selectAll.checked = accounts.length > 0 && ids.length === accounts.length;
    elements.selectAll.indeterminate = ids.length > 0 && ids.length < accounts.length;
  }

  async function requestJson(url, options) {
    return window.StellaDataCache.json(url, options);
  }

  function initials(name) {
    const value = String(name || '').trim();
    return value ? value.slice(0, 2).toUpperCase() : '--';
  }

  function setAvatar(value, name) {
    const image = elements.avatar.querySelector('img');
    const fallback = elements.avatar.querySelector('span');
    image.hidden = !value;
    image.src = value || '';
    fallback.hidden = Boolean(value);
    fallback.textContent = initials(name);
  }

  function setCover(value) {
    const image = elements.cover.querySelector('img');
    const fallback = elements.cover.querySelector('span');
    image.hidden = !value;
    image.src = value || '';
    fallback.hidden = Boolean(value);
  }

  function formatDate(value, fallback = t('profile.statForever')) {
    if (!value) return fallback;
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  }

  function toLocalInput(value) {
    if (!value) return '';
    const date = new Date(value);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function roleLabel(account) {
    return (account.identityKeys || [account.identityKey || (account.role === 'developer' ? 'developer' : account.role === 'admin' ? 'administrator' : 'guest')])
      .map(key => t(`profile.identity${key.slice(0, 1).toUpperCase()}${key.slice(1)}`)).join('、');
  }

  function presenceLabel(status) {
    const key = String(status || 'offline').replace(/^./, value => value.toUpperCase());
    return t(`profile.presenceStatus${key}`);
  }

  function priorityScore(values, value) {
    const index = values.indexOf(value);
    return index < 0 ? 0 : values.length - index;
  }

  function identityScore(account) {
    const keys = account.identityKeys || [account.identityKey || (account.role === 'developer' ? 'developer' : account.role === 'admin' ? 'administrator' : 'guest')];
    return Math.max(0, ...keys.map(key => priorityScore(identityPriority, key)));
  }

  function sortedAccounts() {
    if (!sortState.key) return accounts;
    const direction = sortState.direction === 'ascending' ? 1 : -1;
    return [...accounts].sort((left, right) => {
      const leftScore = sortState.key === 'identity'
        ? identityScore(left) : priorityScore(presencePriority, left.presenceStatus || 'offline');
      const rightScore = sortState.key === 'identity'
        ? identityScore(right) : priorityScore(presencePriority, right.presenceStatus || 'offline');
      return (leftScore - rightScore) * direction
        || left.displayName.localeCompare(right.displayName, 'zh-CN');
    });
  }

  function updateSortControls() {
    elements.sortHeadings.forEach(heading => {
      const active = heading.dataset.accountsSortHeading === sortState.key;
      heading.setAttribute('aria-sort', active ? sortState.direction : 'none');
    });
    elements.sortButtons.forEach(button => {
      const key = button.dataset.accountsSort;
      const active = key === sortState.key;
      const column = t(key === 'identity' ? 'accounts.identity' : 'accounts.presence');
      const labelKey = !active ? 'accounts.sortNone'
        : (sortState.direction === 'ascending'
          ? 'accounts.sortCurrentAscending' : 'accounts.sortCurrentDescending');
      button.setAttribute('aria-label', t(labelKey, { column }));
    });
  }

  function setStatus(target, message, type = '') {
    target.textContent = message;
    target.className = type;
  }

  function actionButton(label, action, primary = false) {
    const button = document.createElement('button');
    button.className = `btn ${primary ? 'btn-primary' : 'btn-secondary'}`;
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
  }

  function iconAction(label, markup, action, danger = false) {
    const button = document.createElement('button');
    button.className = `account-row-action${danger ? ' is-danger' : ''}`;
    button.type = 'button';
    button.innerHTML = markup;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', action);
    return button;
  }

  function accountAvatar(account) {
    const root = document.createElement('div');
    root.className = 'person-avatar';
    if (account.avatarUrl) {
      const image = document.createElement('img');
      image.src = account.avatarUrl;
      image.alt = '';
      root.append(image);
    } else {
      const fallback = document.createElement('span');
      fallback.textContent = initials(account.displayName);
      fallback.setAttribute('aria-hidden', 'true');
      root.append(fallback);
    }
    return root;
  }

  function render(selected = new Set()) {
    const active = accounts.filter(account => account.status === 'active').length;
    const administrators = accounts.filter(account => ['developer', 'admin'].includes(account.role)).length;
    elements.summary.textContent = t('accounts.summary', { total: accounts.length, active, administrators });
    elements.body.replaceChildren(...sortedAccounts().map(account => {
      const row = document.createElement('tr');
      row.dataset.accountId = account.id;
      const selectCell = document.createElement('td');
      const select = document.createElement('input');
      select.type = 'checkbox';
      select.name = 'managedAccount';
      select.value = account.id;
      select.checked = selected.has(account.id);
      select.setAttribute('aria-label', account.displayName);
      select.addEventListener('change', updateSelection);
      selectCell.append(select);
      const userCell = document.createElement('td');
      const user = document.createElement('div');
      user.className = 'account-user-cell';
      const copy = document.createElement('div');
      copy.className = 'person-copy';
      const name = document.createElement('strong');
      name.textContent = account.displayName;
      const username = document.createElement('span');
      username.textContent = account.account;
      copy.append(name, username);
      user.append(accountAvatar(account), copy);
      userCell.append(user);
      const role = document.createElement('td');
      role.textContent = roleLabel(account);
      const presence = document.createElement('td');
      const presenceText = document.createElement('span');
      const presenceStatus = account.presenceStatus || 'offline';
      presenceText.className = `presence-status account-presence-status presence-${presenceStatus}`;
      presenceText.textContent = presenceLabel(presenceStatus);
      presence.append(presenceText);
      const region = document.createElement('td');
      region.textContent = account.region;
      const expiry = document.createElement('td');
      expiry.textContent = formatDate(account.accountExpiresAt);
      const status = document.createElement('td');
      const statusText = document.createElement('span');
      statusText.className = `account-status-label ${account.status}`;
      statusText.textContent = account.status === 'active' ? t('accounts.active') : t('accounts.disabled');
      status.append(statusText);
      const actions = document.createElement('td');
      const edit = document.createElement('button');
      edit.className = 'account-row-action';
      edit.type = 'button';
      edit.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.2 2.7l2.1 2.1-7.8 7.8-2.8.7.7-2.8z"/><path d="M9.7 4.2l2.1 2.1"/></svg>';
      edit.title = t('accounts.edit');
      edit.setAttribute('aria-label', t('accounts.edit'));
      edit.addEventListener('click', () => openEditor(account));
      actions.append(edit);
      const statusAction = iconAction(
        account.status === 'active' ? t('accounts.disable') : t('accounts.enable'),
        account.status === 'active'
          ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="M5.2 5.2l5.6 5.6"/></svg>'
          : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="M5.2 8h5.6"/></svg>',
        () => changeAccountStatus(account),
        account.status === 'active'
      );
      const deleteAction = iconAction(
        t('accounts.delete'),
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.2 4.3h9.6"/><path d="M6.1 2.4h3.8"/><path d="M4.7 4.3l.5 8a1.1 1.1 0 0 0 1.1 1h3.4a1.1 1.1 0 0 0 1.1-1l.5-8"/><path d="M6.7 6.9v3.8M9.3 6.9v3.8"/></svg>',
        () => deleteAccountQuick(account),
        true
      );
      actions.append(statusAction, deleteAction);
      if (account.pendingTitle) {
        const review = document.createElement('div');
        review.className = 'account-review-actions';
        const reviewText = document.createElement('span');
        reviewText.textContent = t('accounts.pendingTitle', { title: account.pendingTitle });
        const approve = actionButton(t('accounts.approveTitle'), () => reviewTitle(account.id, 'approved'), true);
        const reject = actionButton(t('accounts.rejectTitle'), () => reviewTitle(account.id, 'rejected'));
        review.append(reviewText, approve, reject);
        actions.append(review);
      }
      row.append(selectCell, userCell, role, presence, region, expiry, status, actions);
      return row;
    }));
    updateSortControls();
    updateSelection();
  }

  function resetMedia(account) {
    avatarDraft = account?.avatarUrl || '';
    coverDraft = account?.coverUrl || '';
    avatarChanged = false;
    coverChanged = false;
    setAvatar(avatarDraft, account?.displayName || '');
    setCover(coverDraft);
    elements.avatarRemove.disabled = !avatarDraft;
    elements.coverRemove.disabled = !coverDraft;
  }

  function openEditor(account = null) {
    elements.form.reset();
    elements.id.value = account?.id || '';
    elements.heading.textContent = account ? t('accounts.editorTitle') : t('accounts.createTitle');
    elements.account.value = account?.account || '';
    elements.name.value = account?.displayName || '';
    const identityKeys = account?.identityKeys || [account?.identityKey || (account?.role === 'developer' ? 'developer' : account?.role === 'admin' ? 'administrator' : 'guest')];
    elements.identities.forEach(input => { input.checked = identityKeys.includes(input.value); });
    elements.accountStatuses.forEach(input => { input.checked = input.value === (account?.status || 'active'); });
    elements.expiry.value = toLocalInput(account?.accountExpiresAt);
    elements.password.value = '';
    elements.password.required = !account;
    elements.title.value = account?.title || '';
    elements.titleReview.hidden = !account?.pendingTitle;
    elements.titleReview.textContent = account?.pendingTitle
      ? t('accounts.pendingTitle', { title: account.pendingTitle }) : '';
    elements.region.value = account?.region || '未知地区';
    elements.genders.forEach(input => { input.checked = input.value === (account?.gender || 'unspecified'); });
    elements.birthDate.value = account?.birthDate || '';
    elements.bio.value = account?.bio || '';
    elements.form.querySelectorAll('input[name="accountStat"]').forEach(input => {
      input.checked = (account?.visibleStats || ['duty_time', 'account_expiry', 'event_count', 'game_count']).includes(input.value);
    });
    elements.remove.hidden = !account;
    elements.deleteConfirm.hidden = true;
    resetMedia(account);
    setStatus(elements.editorStatus, '');
    elements.dialog.showModal();
    requestAnimationFrame(() => elements.close.focus());
  }

  function closeEditor() {
    elements.dialog.close();
    elements.create.focus();
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(t('profile.avatarReadFailed')));
      };
      image.src = url;
    });
  }

  async function processImage(file, type) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(t('profile.imageTypeError'));
    const image = await loadImage(file);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (type === 'avatar') {
      const size = Math.min(image.naturalWidth, image.naturalHeight);
      canvas.width = 320;
      canvas.height = 320;
      context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 320, 320);
    } else {
      canvas.width = 1600;
      canvas.height = 480;
      const ratio = canvas.width / canvas.height;
      const width = image.naturalWidth / image.naturalHeight > ratio ? image.naturalHeight * ratio : image.naturalWidth;
      const height = image.naturalWidth / image.naturalHeight > ratio ? image.naturalHeight : image.naturalWidth / ratio;
      context.drawImage(image, (image.naturalWidth - width) / 2, (image.naturalHeight - height) / 2, width, height, 0, 0, 1600, 480);
    }
    return canvas.toDataURL('image/webp', type === 'avatar' ? 0.86 : 0.82);
  }

  async function loadAccounts({ silent = false, force = false, preserveSelection = false } = {}) {
    if (loadPromise) return loadPromise;
    const selected = preserveSelection ? new Set(selectedIds()) : new Set();
    if (!silent) setStatus(elements.status, t('accounts.loading'), 'pending');
    loadPromise = (async () => {
      try {
        const payload = await requestJson('/api/admin/accounts', { force });
        accounts = payload.accounts;
        render(selected);
        if (!silent) setStatus(elements.status, '');
      } catch (error) {
        if (!silent) setStatus(elements.status, t('accounts.loadFailed', { error: error.message }), 'error');
      }
    })();
    try {
      await loadPromise;
    } finally {
      loadPromise = null;
    }
  }

  elements.create.addEventListener('click', () => openEditor());
  elements.close.addEventListener('click', closeEditor);
  elements.cancel.addEventListener('click', closeEditor);
  elements.dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeEditor();
  });
  elements.remove.addEventListener('click', () => {
    elements.deleteConfirm.hidden = false;
    elements.confirmDelete.focus();
  });
  elements.confirmDelete.addEventListener('click', async () => {
    const id = elements.id.value;
    const current = accounts.find(account => account.id === id);
    elements.confirmDelete.disabled = true;
    try {
      await requestJson(`/api/admin/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      elements.dialog.close();
      if (current?.isCurrent) {
        window.location.href = '/';
        return;
      }
      await loadAccounts();
      setStatus(elements.status, t('accounts.deleted'), 'success');
    } catch (error) {
      setStatus(elements.editorStatus, t('accounts.saveFailed', { error: error.message }), 'error');
    } finally {
      elements.confirmDelete.disabled = false;
    }
  });

  async function changeSelectedStatus(status) {
    const ids = selectedIds();
    if (!ids.length) return;
    try {
      const payload = await requestJson('/api/admin/accounts/bulk-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status })
      });
      accounts = payload.accounts;
      render();
      setStatus(elements.status, t('accounts.bulkSaved'), 'success');
    } catch (error) {
      setStatus(elements.status, t('accounts.saveFailed', { error: error.message }), 'error');
    }
  }

  async function changeAccountStatus(account) {
    try {
      const payload = await requestJson('/api/admin/accounts/bulk-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [account.id], status: account.status === 'active' ? 'disabled' : 'active' })
      });
      accounts = payload.accounts;
      render();
      setStatus(elements.status, t('accounts.bulkSaved'), 'success');
    } catch (error) {
      setStatus(elements.status, t('accounts.saveFailed', { error: error.message }), 'error');
    }
  }

  async function deleteAccountQuick(account) {
    const confirmed = await window.StellaDialog.confirm({
      title: '删除账号',
      message: t('accounts.singleDeleteConfirm', { name: account.displayName }),
      confirmText: '确认删除',
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      await requestJson(`/api/admin/accounts/${encodeURIComponent(account.id)}`, { method: 'DELETE' });
      await loadAccounts();
      setStatus(elements.status, t('accounts.deleted'), 'success');
    } catch (error) {
      setStatus(elements.status, t('accounts.saveFailed', { error: error.message }), 'error');
    }
  }

  async function deleteSelected() {
    const ids = selectedIds();
    if (!ids.length) return;
    const confirmed = await window.StellaDialog.confirm({
      title: '批量删除账号',
      message: t('accounts.bulkDeleteConfirm', { count: ids.length }),
      confirmText: '确认删除',
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      const payload = await requestJson('/api/admin/accounts/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      accounts = payload.accounts;
      render();
      setStatus(elements.status, t('accounts.deleted'), 'success');
    } catch (error) {
      setStatus(elements.status, t('accounts.saveFailed', { error: error.message }), 'error');
    }
  }

  function parseImportText(text, fileName) {
    if (fileName.toLowerCase().endsWith('.json')) {
      const value = JSON.parse(text);
      return Array.isArray(value) ? value : value.accounts;
    }
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines[0].split(',').map(value => value.trim().toLowerCase());
    const hasHeader = headers.includes('account') || headers.includes('username') || headers.includes('账号');
    const keys = hasHeader ? headers : ['account', 'displayName', 'password', 'title', 'identityKey'];
    return (hasHeader ? lines.slice(1) : lines).map(line => {
      const values = line.split(',').map(value => value.trim());
      const item = {};
      keys.forEach((key, index) => {
        const normalized = ({ username: 'account', 账号: 'account', displayname: 'displayName', 昵称: 'displayName', password: 'password', 密码: 'password', title: 'title', 岗位: 'title', identitykey: 'identityKey', 身份: 'identityKey' }[key] || key);
        if (values[index]) item[normalized] = values[index];
      });
      return item;
    });
  }

  elements.importInput.addEventListener('change', async () => {
    const file = elements.importInput.files?.[0];
    if (!file) return;
    try {
      const rows = parseImportText(await file.text(), file.name);
      const payload = await requestJson('/api/admin/accounts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: rows })
      });
      accounts = payload.accounts;
      render();
      setStatus(elements.status, t('accounts.importResult', { imported: payload.imported.length, rejected: payload.rejected.length }), payload.rejected.length ? 'error' : 'success');
    } catch (error) {
      setStatus(elements.status, t('accounts.saveFailed', { error: error.message }), 'error');
    } finally {
      elements.importInput.value = '';
    }
  });

  elements.selectAll.addEventListener('change', () => {
    elements.body.querySelectorAll('input[name="managedAccount"]').forEach(input => { input.checked = elements.selectAll.checked; });
    updateSelection();
  });
  elements.sortButtons.forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.accountsSort;
      sortState = {
        key,
        direction: sortState.key === key && sortState.direction === 'descending' ? 'ascending' : 'descending'
      };
      render(new Set(selectedIds()));
    });
  });
  elements.bulkEnable.addEventListener('click', () => changeSelectedStatus('active'));
  elements.bulkDisable.addEventListener('click', () => changeSelectedStatus('disabled'));
  elements.bulkDelete.addEventListener('click', deleteSelected);

  async function reviewTitle(userId, decision) {
    try {
      await requestJson(`/api/admin/accounts/${encodeURIComponent(userId)}/title-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision })
      });
      await loadAccounts();
      setStatus(elements.status, t(decision === 'approved' ? 'accounts.titleApproved' : 'accounts.titleRejected'), 'success');
    } catch (error) {
      setStatus(elements.status, t('accounts.saveFailed', { error: error.message }), 'error');
    }
  }
  elements.avatarInput.addEventListener('change', async () => {
    const file = elements.avatarInput.files?.[0];
    if (!file) return;
    try {
      avatarDraft = await processImage(file, 'avatar');
      avatarChanged = true;
      setAvatar(avatarDraft, elements.name.value);
      elements.avatarRemove.disabled = false;
    } catch (error) {
      setStatus(elements.editorStatus, error.message, 'error');
    } finally {
      elements.avatarInput.value = '';
    }
  });
  elements.coverInput.addEventListener('change', async () => {
    const file = elements.coverInput.files?.[0];
    if (!file) return;
    try {
      coverDraft = await processImage(file, 'cover');
      coverChanged = true;
      setCover(coverDraft);
      elements.coverRemove.disabled = false;
    } catch (error) {
      setStatus(elements.editorStatus, error.message, 'error');
    } finally {
      elements.coverInput.value = '';
    }
  });
  elements.avatarRemove.addEventListener('click', () => {
    avatarDraft = '';
    avatarChanged = true;
    setAvatar('', elements.name.value);
    elements.avatarRemove.disabled = true;
  });
  elements.coverRemove.addEventListener('click', () => {
    coverDraft = '';
    coverChanged = true;
    setCover('');
    elements.coverRemove.disabled = true;
  });
  elements.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!elements.form.reportValidity()) return;
    const id = elements.id.value;
    const payload = {
      account: elements.account.value.trim(),
      displayName: elements.name.value.trim(),
      identityKeys: Array.from(elements.identities).filter(input => input.checked).map(input => input.value),
      status: Array.from(elements.accountStatuses).find(input => input.checked)?.value || 'active',
      expiresAt: elements.expiry.value ? new Date(elements.expiry.value).toISOString() : null,
      password: elements.password.value,
      title: elements.title.value.trim(),
      gender: Array.from(elements.genders).find(input => input.checked)?.value || 'unspecified',
      birthDate: elements.birthDate.value || null,
      bio: elements.bio.value.trim(),
      visibleStats: Array.from(elements.form.querySelectorAll('input[name="accountStat"]:checked')).map(input => input.value)
    };
    if (avatarChanged) payload.avatar = avatarDraft;
    if (coverChanged) payload.cover = coverDraft;
    elements.save.disabled = true;
    elements.form.setAttribute('aria-busy', 'true');
    try {
      await requestJson(id ? `/api/admin/accounts/${encodeURIComponent(id)}` : '/api/admin/accounts', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      elements.dialog.close();
      await loadAccounts();
      setStatus(elements.status, t('accounts.saved'), 'success');
    } catch (error) {
      setStatus(elements.editorStatus, t('accounts.saveFailed', { error: error.message }), 'error');
    } finally {
      elements.save.disabled = false;
      elements.form.removeAttribute('aria-busy');
    }
  });

  function loadForCurrentIdentity({ silent = false, preserveSelection = false } = {}) {
    const currentProfile = window.ProfileCenter?.getProfile?.();
    if (currentProfile) {
      if (currentProfile.identity?.systemManagement) loadAccounts({ silent, force: true, preserveSelection });
      return;
    }
    window.ProfileCenter?.ready.then(profile => {
      if (profile.identity?.systemManagement) loadAccounts({ silent, force: true, preserveSelection });
    }).catch(() => {});
  }

  function refreshVisibleAccounts() {
    if (document.visibilityState !== 'visible' || elements.page.hidden) return;
    loadForCurrentIdentity({ silent: true, preserveSelection: true });
  }

  window.addEventListener('stella:page-change', event => {
    if (event.detail?.page === 'accounts') loadForCurrentIdentity();
  });
  window.addEventListener('stella:identity-change', event => {
    if (!elements.page.hidden && event.detail?.identity?.systemManagement) loadAccounts({ force: true });
  });
  document.addEventListener('visibilitychange', refreshVisibleAccounts);
  window.setInterval(refreshVisibleAccounts, PRESENCE_REFRESH_INTERVAL_MS);
  updateSortControls();
  if (!document.getElementById('accountsPage').hidden) {
    loadForCurrentIdentity();
  }
})();
