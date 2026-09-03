(function () {
  const elements = {
    list: document.getElementById('friendList'),
    listEmpty: document.getElementById('friendListEmpty'),
    count: document.getElementById('friendCount'),
    requests: document.getElementById('friendRequestList'),
    requestCount: document.getElementById('friendRequestCount'),
    requestSection: document.getElementById('friendRequestSection'),
    status: document.getElementById('friendsStatus'),
    searchForm: document.getElementById('friendSearchForm'),
    searchInput: document.getElementById('friendSearchInput'),
    searchResults: document.getElementById('friendSearchResults'),
    searchEmpty: document.getElementById('friendSearchEmpty'),
    searchStatus: document.getElementById('friendSearchStatus')
  };

  async function requestJson(url, options) {
    return window.StellaDataCache.json(url, options);
  }

  function initials(name) {
    const value = String(name || '').trim();
    return value ? value.slice(0, 2).toUpperCase() : '--';
  }

  function avatar(user) {
    const root = document.createElement('div');
    root.className = 'person-avatar';
    if (user.avatarUrl) {
      const image = document.createElement('img');
      image.src = user.avatarUrl;
      image.alt = '';
      root.append(image);
    } else {
      const fallback = document.createElement('span');
      fallback.textContent = initials(user.displayName);
      fallback.setAttribute('aria-hidden', 'true');
      root.append(fallback);
    }
    return root;
  }

  function actionButton(label, action, primary = false) {
    const button = document.createElement('button');
    button.className = `btn ${primary ? 'btn-primary' : 'btn-secondary'}`;
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
  }

  function presenceLabel(status) {
    const value = String(status || 'offline');
    const key = value.slice(0, 1).toUpperCase() + value.slice(1);
    return t(`profile.presenceStatus${key}`);
  }

  function personCard(user, mode) {
    const card = document.createElement('article');
    card.className = 'person-card';
    const avatarButton = document.createElement('button');
    avatarButton.className = 'person-avatar-button';
    avatarButton.type = 'button';
    avatarButton.setAttribute('aria-label', t('friends.viewProfile', { name: user.displayName }));
    avatarButton.append(avatar(user));
    avatarButton.addEventListener('click', () => window.ProfileCenter?.openPublicProfile(user.id));
    const copy = document.createElement('div');
    copy.className = 'person-copy';
    const name = document.createElement('strong');
    name.textContent = user.displayName;
    const meta = document.createElement('span');
    meta.textContent = [user.account, user.title, user.region].filter(Boolean).join(' · ');
    const presence = document.createElement('span');
    presence.className = `presence-status presence-${user.presenceStatus || 'offline'}`;
    presence.textContent = presenceLabel(user.presenceStatus);
    copy.append(name, meta, presence);
    const actions = document.createElement('div');
    actions.className = 'person-actions';
    if (mode === 'friend') {
      actions.append(actionButton(t('friends.remove'), () => updateRelationship(user.id, 'DELETE')));
    } else if (mode === 'incoming') {
      actions.append(
        actionButton(t('friends.accept'), () => updateRelationship(user.id, 'POST', true), true),
        actionButton(t('friends.reject'), () => updateRelationship(user.id, 'DELETE'))
      );
    } else if (mode === 'search') {
      const label = user.relationship === 'none' ? t('friends.request') : t('friends.requested');
      const button = actionButton(label, () => sendRequest(user.id), user.relationship === 'none');
      button.disabled = user.relationship !== 'none';
      actions.append(button);
    } else {
      const pending = document.createElement('span');
      pending.className = 'person-pending';
      pending.textContent = t('friends.requested');
      actions.append(pending);
    }
    card.append(avatarButton, copy, actions);
    return card;
  }

  function renderFriends(payload) {
    elements.list.replaceChildren(...payload.friends.map(user => personCard(user, 'friend')));
    elements.listEmpty.hidden = payload.friends.length > 0;
    elements.count.textContent = String(payload.friends.length);
    const requests = [
      ...payload.incoming.map(user => ({ user, mode: 'incoming' })),
      ...payload.outgoing.map(user => ({ user, mode: 'outgoing' }))
    ];
    elements.requests.replaceChildren(...requests.map(item => personCard(item.user, item.mode)));
    elements.requestCount.textContent = String(requests.length);
    elements.requestSection.hidden = requests.length === 0;
  }

  async function loadFriends() {
    try {
      renderFriends(await requestJson('/api/friends'));
      elements.status.textContent = '';
    } catch (error) {
      elements.status.textContent = t('friends.loadFailed', { error: error.message });
      elements.status.className = 'people-status error';
    }
  }

  async function updateRelationship(userId, method, accept = false) {
    try {
      const url = accept ? `/api/friends/${encodeURIComponent(userId)}/accept` : `/api/friends/${encodeURIComponent(userId)}`;
      renderFriends(await requestJson(url, { method }));
      elements.status.textContent = '';
    } catch (error) {
      elements.status.textContent = t('friends.actionFailed', { error: error.message });
      elements.status.className = 'people-status error';
    }
  }

  async function sendRequest(userId) {
    try {
      await requestJson('/api/friends/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      elements.searchStatus.textContent = t('friends.requestSent');
      elements.searchStatus.className = 'people-status success';
      elements.searchForm.requestSubmit();
      loadFriends();
    } catch (error) {
      elements.searchStatus.textContent = t('friends.actionFailed', { error: error.message });
      elements.searchStatus.className = 'people-status error';
    }
  }

  elements.searchForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!elements.searchForm.reportValidity()) return;
    elements.searchForm.setAttribute('aria-busy', 'true');
    try {
      const payload = await requestJson(`/api/users/search?q=${encodeURIComponent(elements.searchInput.value.trim())}`);
      elements.searchResults.replaceChildren(...payload.users.map(user => personCard(user, 'search')));
      elements.searchEmpty.hidden = payload.users.length > 0;
      if (!payload.users.length) elements.searchEmpty.textContent = t('friends.searchEmpty');
      elements.searchStatus.textContent = '';
    } catch (error) {
      elements.searchStatus.textContent = t('friends.actionFailed', { error: error.message });
      elements.searchStatus.className = 'people-status error';
    } finally {
      elements.searchForm.removeAttribute('aria-busy');
    }
  });

  document.querySelectorAll('[data-open-page]').forEach(button => {
    button.addEventListener('click', () => window.ProfileCenter?.navigate(button.dataset.openPage));
  });

  window.addEventListener('stella:page-change', event => {
    if (event.detail?.page === 'friends') loadFriends();
  });
  if (!document.getElementById('friendsPage').hidden) loadFriends();
})();
