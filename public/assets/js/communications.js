(function () {
  'use strict';

  const elements = {
    page: document.getElementById('communicationsPage'),
    channelList: document.getElementById('communicationsChannelList'),
    listState: document.getElementById('communicationsListState'),
    currentAvatar: document.getElementById('communicationsCurrentAvatar'),
    title: document.getElementById('communicationsConversationTitle'),
    description: document.getElementById('communicationsChannelDescription'),
    kind: document.getElementById('communicationsChannelKind'),
    liveState: document.getElementById('communicationsLiveState'),
    messageScroll: document.getElementById('communicationsMessageScroll'),
    messageList: document.getElementById('communicationsMessageList'),
    messageState: document.getElementById('communicationsMessageState'),
    contextMenu: document.getElementById('communicationsContextMenu'),
    announcement: document.getElementById('communicationsAnnouncement'),
    historyState: document.getElementById('communicationsHistoryState'),
    composer: document.getElementById('communicationsComposer'),
    input: document.getElementById('communicationsInput'),
    count: document.getElementById('communicationsCharacterCount'),
    send: document.getElementById('communicationsSend'),
    paste: document.getElementById('communicationsPaste'),
    composerMode: document.getElementById('communicationsComposerMode'),
    composerModeLabel: document.getElementById('communicationsComposerModeLabel'),
    editCancel: document.getElementById('communicationsEditCancel'),
    composerStatus: document.getElementById('communicationsComposerStatus'),
    friendsNotification: document.getElementById('friendsNavNotification'),
    channelsNotification: document.getElementById('channelsNavNotification'),
    createOpen: document.getElementById('communicationsCreateOpen'),
    dialog: document.getElementById('communicationsCreateDialog'),
    createForm: document.getElementById('communicationsCreateForm'),
    createClose: document.getElementById('communicationsCreateClose'),
    createCancel: document.getElementById('communicationsCreateCancel'),
    createSubmit: document.getElementById('communicationsCreateSubmit'),
    dialogStatus: document.getElementById('communicationsDialogStatus'),
    contactsEmpty: document.getElementById('communicationsContactsEmpty'),
    privateContacts: document.getElementById('communicationsPrivateContacts'),
    customContacts: document.getElementById('communicationsCustomContacts'),
    channelName: document.getElementById('communicationsChannelName'),
    channelDescription: document.getElementById('communicationsChannelDescriptionInput')
  };

  if (!elements.page) return;

  const state = {
    active: false,
    initialized: false,
    loading: false,
    sending: false,
    historyLoading: false,
    newerLoading: false,
    messageLimit: 500,
    currentUser: null,
    activeIdentityLabel: '',
    channels: [],
    contacts: [],
    notifications: { friend: 0, channels: 0 },
    friendRequestCount: 0,
    selectedChannelId: null,
    messages: [],
    hasMore: false,
    hasNewer: false,
    firstUnreadMessageId: null,
    editingMessageId: null,
    eventSource: null,
    refreshTimer: 0,
    pendingEvents: new Map(),
    bootstrapVersion: 0,
    createMode: 'private',
    contextMenuMessageId: null,
    contextMenuTrigger: null,
    contextMenuKeyboardOpened: false
  };

  function text(key, fallback, params) {
    const translated = t(key, params);
    return translated === key ? fallback : translated;
  }

  function api(url, options = {}) {
    if (window.StellaDataCache) return window.StellaDataCache.json(url, options);
    return fetch(url, options).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || text('channels.requestFailed', '请求失败'));
      return payload;
    });
  }

  function codePoints(value) {
    return Array.from(String(value || ''));
  }

  function initials(value) {
    const source = String(value || '').trim();
    if (!source) return '--';
    const parts = source.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts.slice(0, 2).map(part => part[0]).join('') : codePoints(source).slice(0, 2).join('')).toUpperCase();
  }

  function createSvg(pathData) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const data of pathData) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', data);
      svg.appendChild(path);
    }
    return svg;
  }

  function avatarElement(className, item, kind) {
    const avatar = document.createElement('span');
    avatar.className = className;
    if (item?.avatarUrl) {
      const image = document.createElement('img');
      image.src = item.avatarUrl;
      image.alt = '';
      avatar.appendChild(image);
      return avatar;
    }
    if (kind === 'global') {
      avatar.appendChild(createSvg(['M5.5 2.3L4 13.7M11.8 2.3l-1.5 11.4M2.2 6h12M1.7 10h12']));
    } else if (kind === 'identity') {
      avatar.appendChild(createSvg(['M8 2.2l4.8 1.9v3.6c0 3-2.2 4.9-4.8 6.2-2.6-1.3-4.8-3.2-4.8-6.2V4.1L8 2.2z', 'M5.8 8l1.4 1.4L10.5 6']));
    } else if (kind === 'custom') {
      avatar.appendChild(createSvg(['M5.2 7.2a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2z', 'M11.2 7.7a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z', 'M1.8 13c.3-2.5 1.6-3.8 3.6-3.8s3.3 1.3 3.6 3.8', 'M9 10c.6-.4 1.3-.6 2.2-.6 1.8 0 2.8 1.2 3 3.3']));
    } else {
      avatar.textContent = initials(item?.displayName || item?.name);
    }
    return avatar;
  }

  function kindLabel(kind) {
    return {
      global: text('channels.kindGlobal', '全局公聊'),
      identity: text('channels.kindIdentity', '身份公聊'),
      private: text('channels.kindPrivate', '私聊'),
      custom: text('channels.kindCustom', '自定义频道')
    }[kind] || text('channels.kindChannel', '频道');
  }

  function formatMessageTime(timestamp) {
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime())) return '';
    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    return new Intl.DateTimeFormat('zh-CN', sameDay
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }

  function formatFullTime(timestamp) {
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(date);
  }

  function updateNavigationNotifications(notifications = {}) {
    const friendCount = Math.max(0, Number(notifications.friend) || 0);
    const channelCount = Math.max(0, Number(notifications.channels) || 0);
    const hasCommunicationNotification = friendCount > 0 || channelCount > 0;
    document.querySelectorAll('[data-nav-group="communication"] > .nav-group-toggle .nav-notification-dot').forEach(dot => {
      dot.hidden = !hasCommunicationNotification;
      dot.closest('.nav-group-toggle')?.classList.toggle('has-notification', hasCommunicationNotification);
    });
    document.querySelectorAll('[data-page="friends"] .nav-notification-dot').forEach(dot => {
      dot.hidden = friendCount === 0;
      dot.closest('.nav-btn')?.classList.toggle('has-notification', friendCount > 0);
    });
    document.querySelectorAll('[data-page="channels"] .nav-notification-count').forEach(badge => {
      badge.hidden = channelCount === 0;
      badge.textContent = channelCount > 99 ? '99+' : String(channelCount);
      badge.setAttribute('aria-label', text(
        'channels.totalUnreadCount', '{count} 条未读消息', { count: channelCount }
      ));
      badge.closest('.nav-btn')?.classList.toggle('has-notification', channelCount > 0);
    });
  }

  function channelSummary(channel) {
    if (channel.lastMessage?.content) return channel.lastMessage.content.replace(/\s+/g, ' ');
    if (channel.description) return channel.description;
    if (channel.kind === 'identity') return text('channels.identitySummary', '{identity}身份成员可见', { identity: channel.identityLabel || state.activeIdentityLabel });
    if (channel.kind === 'global') return text('channels.globalSummary', '所有在线成员可见');
    if (channel.kind === 'private') return text('channels.privateSummary', '好友私密会话');
    return text('channels.emptySummary', '尚无消息');
  }

  function groupLabel(key) {
    return {
      public: text('channels.groupPublic', '公共频道'),
      private: text('channels.groupPrivate', '私聊'),
      custom: text('channels.groupCustom', '自建频道')
    }[key];
  }

  function updateChannel(channel) {
    const index = state.channels.findIndex(item => item.id === channel.id);
    if (index >= 0) state.channels[index] = channel;
    else state.channels.push(channel);
  }

  function renderChannels() {
    elements.channelList.replaceChildren();
    const groups = [
      ['public', state.channels.filter(channel => channel.kind === 'global' || channel.kind === 'identity')],
      ['private', state.channels.filter(channel => channel.kind === 'private')],
      ['custom', state.channels.filter(channel => channel.kind === 'custom')]
    ];
    for (const [key, channels] of groups) {
      if (!channels.length) continue;
      const section = document.createElement('section');
      section.className = 'communications-channel-group';
      const heading = document.createElement('div');
      heading.className = 'communications-channel-group-title';
      const label = document.createElement('span');
      label.textContent = groupLabel(key);
      const count = document.createElement('span');
      count.textContent = String(channels.length);
      heading.append(label, count);
      section.appendChild(heading);
      for (const channel of channels) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'communications-channel-row';
        button.classList.toggle('is-active', channel.id === state.selectedChannelId);
        button.setAttribute('aria-current', channel.id === state.selectedChannelId ? 'page' : 'false');
        button.appendChild(avatarElement('communications-channel-avatar', channel, channel.kind));
        const copy = document.createElement('span');
        copy.className = 'communications-channel-row-copy';
        const name = document.createElement('strong');
        name.textContent = channel.name;
        const summary = document.createElement('span');
        summary.textContent = channelSummary(channel);
        copy.append(name, summary);
        button.appendChild(copy);
        if (channel.unreadCount > 0) {
          const unread = document.createElement('span');
          unread.className = 'communications-unread';
          unread.textContent = channel.unreadCount > 99 ? '99+' : String(channel.unreadCount);
          unread.setAttribute('aria-label', text('channels.unreadCount', '{count} 条未读消息', { count: channel.unreadCount }));
          button.appendChild(unread);
        }
        button.addEventListener('click', () => selectChannel(channel.id));
        section.appendChild(button);
      }
      elements.channelList.appendChild(section);
    }
    elements.listState.textContent = state.channels.length ? '' : text('channels.noChannels', '暂无可用频道');
  }

  function renderConversationHeader() {
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    elements.currentAvatar.replaceChildren();
    if (!channel) {
      elements.currentAvatar.textContent = '';
      elements.currentAvatar.appendChild(createSvg(['M5.5 2.3L4 13.7M11.8 2.3l-1.5 11.4M2.2 6h12M1.7 10h12']));
      elements.title.textContent = text('channels.selectChannel', '选择频道');
      elements.description.textContent = text('channels.selectHint', '从左侧选择一个频道开始交流。');
      elements.kind.hidden = true;
      return;
    }
    const avatar = avatarElement('communications-current-avatar-inner', channel, channel.kind);
    while (avatar.firstChild) elements.currentAvatar.appendChild(avatar.firstChild);
    elements.title.textContent = channel.name;
    elements.description.textContent = channel.description || channelSummary(channel);
    elements.kind.textContent = kindLabel(channel.kind);
    elements.kind.hidden = false;
  }

  function actionButton(action, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `communications-message-action ${action.className || ''}`.trim();
    button.append(createSvg(action.paths));
    const caption = document.createElement('span');
    caption.textContent = options.contextMenu ? (action.contextLabel || action.label) : action.label;
    button.appendChild(caption);
    if (action.title) button.title = action.title;
    if (action.ariaLabel) button.setAttribute('aria-label', action.ariaLabel);
    if (action.pressed !== undefined) button.setAttribute('aria-pressed', String(action.pressed));
    if (options.contextMenu) {
      button.tabIndex = -1;
      button.setAttribute('role', action.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
      if (action.checked !== undefined) button.setAttribute('aria-checked', String(action.checked));
    }
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (options.contextMenu) closeContextMenu();
      action.handler();
    });
    return button;
  }

  function replaceMessage(message, options = {}) {
    const index = state.messages.findIndex(item => item.id === message.id);
    if (index < 0) {
      if (options.append) state.messages.push(message);
      else return;
    } else {
      state.messages[index] = message;
    }
    renderMessages({ preservePosition: true, scrollBottom: false });
  }

  function insertComposerText(value) {
    const start = elements.input.selectionStart ?? elements.input.value.length;
    const end = elements.input.selectionEnd ?? start;
    elements.input.setRangeText(value, start, end, 'end');
    elements.input.focus();
    updateComposer();
  }

  async function copyMessage(message) {
    try {
      await navigator.clipboard.writeText(message.content);
      elements.composerStatus.textContent = text('channels.copied', '消息已复制');
    } catch {
      const helper = document.createElement('textarea');
      helper.value = message.content;
      helper.className = 'visually-hidden';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
      elements.composerStatus.textContent = text('channels.copied', '消息已复制');
    }
  }

  function startEditing(message) {
    state.editingMessageId = message.id;
    elements.input.value = message.content;
    elements.composerMode.hidden = false;
    elements.composerModeLabel.textContent = text('channels.editingMessageWithTime', '正在修改 {time} 的消息', {
      time: formatMessageTime(message.createdAt)
    });
    elements.input.focus();
    elements.input.setSelectionRange(elements.input.value.length, elements.input.value.length);
    updateComposer();
  }

  function cancelEditing(options = {}) {
    state.editingMessageId = null;
    elements.composerMode.hidden = true;
    if (options.keepContent !== true) elements.input.value = '';
    updateComposer();
  }

  async function mutateMessage(message, action, options = {}) {
    try {
      const payload = await api(`/api/communications/messages/${message.id}${action ? `/${action}` : ''}`, options);
      if (payload.message) replaceMessage(payload.message);
      return payload;
    } catch (error) {
      elements.composerStatus.textContent = error.message;
      return null;
    }
  }

  async function recallMessageFromUi(message) {
    const confirmed = await window.StellaDialog.confirm({
      title: '撤回消息',
      message: text('channels.recallConfirm', '撤回后其他成员将无法查看这条消息，确认撤回？'),
      confirmText: '确认撤回',
      tone: 'danger'
    });
    if (!confirmed) return;
    await mutateMessage(message, 'recall', { method: 'POST' });
  }

  async function deleteMessageFromUi(message) {
    const confirmed = await window.StellaDialog.confirm({
      title: '删除消息',
      message: text('channels.deleteConfirm', '删除后这条消息将只在你的账号中隐藏，确认删除？'),
      confirmText: '确认删除',
      tone: 'danger'
    });
    if (!confirmed) return;
    const payload = await mutateMessage(message, '', { method: 'DELETE' });
    if (!payload?.deleted) return;
    state.messages = state.messages.filter(item => item.id !== message.id);
    if (state.editingMessageId === message.id) cancelEditing();
    renderMessages({ preservePosition: true, scrollBottom: false });
  }

  function messageActionGroups(message) {
    const regular = [];
    const management = [];
    const destructive = [];
    if (!message.recalled || message.developerRecallVisible) {
      regular.push({
        key: 'copy',
        label: text('channels.copy', '复制'),
        paths: ['M5.2 5.2h7.3v7.3H5.2z', 'M3.5 10.8h-1V2.5h8.3v1'],
        handler: () => copyMessage(message)
      });
    }
    if (message.sender?.displayName && !message.mine && !message.recalled) {
      regular.push({
        key: 'mention',
        label: text('channels.mention', '艾特'),
        paths: ['M10.9 11.6c-.8.8-1.8 1.2-3 1.2a4.8 4.8 0 1 1 4.8-4.8v1.1c0 1.3-.7 2.1-1.6 2.1s-1.5-.7-1.5-1.7V5.7'],
        handler: () => insertComposerText(`@${message.sender.displayName} `)
      });
    }
    if (!message.recalled) {
      const plusOneLabel = text('channels.plusOne', '+1');
      regular.push({
        key: 'plusOne',
        label: message.plusOneCount ? String(message.plusOneCount) : '1',
        contextLabel: message.plusOneCount
          ? text('channels.plusOneCount', '+1，当前 {count} 人响应', { count: message.plusOneCount })
          : plusOneLabel,
        title: plusOneLabel,
        ariaLabel: message.plusOneCount
          ? text('channels.plusOneCount', '+1，当前 {count} 人响应', { count: message.plusOneCount })
          : plusOneLabel,
        paths: ['M3.5 8h9M8 3.5v9'],
        className: message.plusOneByMe ? 'is-active' : '',
        checked: Boolean(message.plusOneByMe),
        pressed: Boolean(message.plusOneByMe),
        handler: () => mutateMessage(message, 'plus-one', { method: 'POST' })
      });
    }
    if (message.canEdit) {
      management.push({
        key: 'edit',
        label: text('channels.edit', '修改'),
        paths: ['M3 11.6l-.5 2 2-.5 7.7-7.7-1.5-1.5z', 'M9.8 4.8l1.5 1.5'],
        handler: () => startEditing(message)
      });
    }
    if (message.canSetUrgent) {
      management.push({
        key: 'urgent',
        label: message.urgent ? text('channels.cancelUrgent', '取消加急') : text('channels.setUrgent', '设为加急'),
        paths: ['M8 2.1v7.1M8 12.5v.1'],
        checked: Boolean(message.urgent),
        handler: () => mutateMessage(message, 'urgent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urgent: !message.urgent })
        })
      });
    }
    if (message.canRecall) {
      destructive.push({
        key: 'recall',
        label: text('channels.recall', '撤回'),
        paths: ['M4.2 5.2H1.8V2.8', 'M2 5a6 6 0 1 1-.1 6.2'],
        className: 'is-danger',
        handler: () => recallMessageFromUi(message)
      });
    }
    if (message.canDelete) {
      destructive.push({
        key: 'delete',
        label: text('channels.deleteForMe', '仅为我删除'),
        paths: ['M3.2 4.5h9.6M6 4.5V2.8h4v1.7M4.5 4.5l.6 8.6h5.8l.6-8.6'],
        className: 'is-danger',
        handler: () => deleteMessageFromUi(message)
      });
    }
    return { regular, management, destructive };
  }

  function createMessageRow(message) {
    const row = document.createElement('li');
    row.className = 'communications-message-row';
    row.classList.toggle('is-mine', Boolean(message.mine));
    const showUrgent = Boolean(message.urgent && (!message.recalled || message.developerRecallVisible));
    row.classList.toggle('is-urgent', showUrgent);
    row.classList.toggle('is-recalled', Boolean(message.recalled));
    row.classList.toggle('is-developer-recall', Boolean(message.developerRecallVisible));
    row.dataset.messageId = String(message.id);
    row.tabIndex = -1;
    row.appendChild(avatarElement('communications-message-avatar', message.sender, 'private'));
    const body = document.createElement('div');
    body.className = 'communications-message-body';
    const meta = document.createElement('div');
    meta.className = 'communications-message-meta';
    const sender = document.createElement('strong');
    sender.textContent = message.mine ? text('channels.me', '我') : (message.sender?.displayName || text('channels.unknownUser', '未知用户'));
    const identity = document.createElement('span');
    identity.textContent = message.senderIdentityLabel || '';
    const time = document.createElement('time');
    time.dateTime = new Date(Number(message.createdAt)).toISOString();
    time.textContent = formatMessageTime(message.createdAt);
    meta.append(sender, identity, time);
    if (message.edited) {
      const edited = document.createElement('span');
      edited.className = 'communications-edited-label';
      edited.textContent = text('channels.edited', '已修改');
      edited.title = formatFullTime(message.editedAt);
      meta.appendChild(edited);
    }
    const bubble = document.createElement('div');
    bubble.className = 'communications-message-bubble';
    if (showUrgent) {
      const urgent = document.createElement('span');
      urgent.className = 'communications-urgent-label';
      urgent.append(createSvg(['M8 2.1v7.1M8 12.5v.1']));
      const urgentText = document.createElement('span');
      urgentText.textContent = text('channels.urgent', '加急');
      urgent.appendChild(urgentText);
      bubble.appendChild(urgent);
    }
    if (message.recalled) {
      const recall = document.createElement('span');
      recall.className = 'communications-recall-label';
      recall.textContent = message.developerRecallVisible
        ? text('channels.recalledDeveloper', '已撤回 · 开发者审计可见')
        : text('channels.recalled', '消息已撤回');
      bubble.appendChild(recall);
    }
    if (!message.recalled || message.developerRecallVisible) {
      const content = document.createElement('span');
      content.className = 'communications-message-content';
      content.textContent = message.content;
      bubble.appendChild(content);
    }
    body.append(meta, bubble);

    if (message.editHistory?.length) {
      const history = document.createElement('details');
      history.className = 'communications-edit-history';
      const summary = document.createElement('summary');
      summary.textContent = text('channels.editHistory', '查看修改历史（{count}）', { count: message.editHistory.length });
      history.appendChild(summary);
      const list = document.createElement('ol');
      for (const item of message.editHistory) {
        const entry = document.createElement('li');
        const historicalContent = document.createElement('p');
        historicalContent.textContent = item.content;
        const historicalTime = document.createElement('time');
        historicalTime.dateTime = new Date(Number(item.createdAt)).toISOString();
        historicalTime.textContent = formatFullTime(item.createdAt);
        entry.append(historicalContent, historicalTime);
        list.appendChild(entry);
      }
      history.appendChild(list);
      body.appendChild(history);
    }

    const actions = document.createElement('div');
    actions.className = 'communications-message-actions';
    const actionGroups = messageActionGroups(message);
    const plusOneAction = actionGroups.regular.find(action => action.key === 'plusOne');
    if (plusOneAction) actions.appendChild(actionButton(plusOneAction));
    const overflowActions = [
      ...actionGroups.regular.filter(action => action.key !== 'plusOne'),
      ...actionGroups.management,
      ...actionGroups.destructive
    ];
    if (overflowActions.length) {
      const menu = document.createElement('details');
      menu.className = 'communications-message-menu';
      menu.addEventListener('toggle', () => {
        if (!menu.open) return;
        closeContextMenu();
        document.querySelectorAll('.communications-message-menu[open]').forEach(otherMenu => {
          if (otherMenu !== menu) otherMenu.removeAttribute('open');
        });
      });
      const menuTrigger = document.createElement('summary');
      menuTrigger.title = text('channels.messageActions', '消息操作');
      menuTrigger.setAttribute('aria-label', menuTrigger.title);
      menuTrigger.appendChild(createSvg(['M3.2 8h.1M7.9 8H8M12.7 8h.1']));
      menu.appendChild(menuTrigger);
      const menuItems = document.createElement('div');
      menuItems.className = 'communications-message-menu-items';
      menuItems.append(...overflowActions.map(action => actionButton(action)));
      menu.appendChild(menuItems);
      actions.appendChild(menu);
    }
    body.appendChild(actions);
    row.appendChild(body);
    return row;
  }

  function contextMenuItems() {
    return [...elements.contextMenu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')];
  }

  function closeContextMenu(options = {}) {
    if (!elements.contextMenu || elements.contextMenu.hidden) return;
    const trigger = state.contextMenuTrigger;
    const restoreFocus = Boolean(options.restoreFocus && state.contextMenuKeyboardOpened);
    elements.contextMenu.hidden = true;
    elements.contextMenu.replaceChildren();
    elements.contextMenu.style.removeProperty('left');
    elements.contextMenu.style.removeProperty('top');
    document.querySelector('.communications-message-row.is-context-target')?.classList.remove('is-context-target');
    state.contextMenuMessageId = null;
    state.contextMenuTrigger = null;
    state.contextMenuKeyboardOpened = false;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function positionContextMenu(clientX, clientY) {
    const margin = 8;
    const offset = 4;
    const width = elements.contextMenu.offsetWidth;
    const height = elements.contextMenu.offsetHeight;
    const fitsBelow = clientY + offset + height <= window.innerHeight - margin;
    const left = Math.min(Math.max(margin, clientX), Math.max(margin, window.innerWidth - width - margin));
    const top = fitsBelow
      ? Math.min(clientY + offset, window.innerHeight - height - margin)
      : Math.max(margin, clientY - height - offset);
    elements.contextMenu.style.left = `${left}px`;
    elements.contextMenu.style.top = `${top}px`;
    elements.contextMenu.dataset.placement = fitsBelow ? 'below' : 'above';
  }

  function openContextMenu(message, row, point, options = {}) {
    closeContextMenu();
    document.querySelectorAll('.communications-message-menu[open]').forEach(menu => menu.removeAttribute('open'));
    const groups = messageActionGroups(message);
    const populatedGroups = [groups.regular, groups.management, groups.destructive].filter(group => group.length);
    if (!populatedGroups.length) return;
    populatedGroups.forEach((group, index) => {
      if (index) {
        const separator = document.createElement('div');
        separator.className = 'communications-context-menu-separator';
        separator.setAttribute('role', 'separator');
        elements.contextMenu.appendChild(separator);
      }
      elements.contextMenu.append(...group.map(action => actionButton(action, { contextMenu: true })));
    });
    state.contextMenuMessageId = message.id;
    state.contextMenuTrigger = options.trigger || row;
    state.contextMenuKeyboardOpened = Boolean(options.keyboard);
    row.classList.add('is-context-target');
    elements.contextMenu.hidden = false;
    positionContextMenu(point.x, point.y);
    requestAnimationFrame(() => contextMenuItems()[0]?.focus({ preventScroll: true }));
  }

  function handleContextMenuKeydown(event) {
    const items = contextMenuItems();
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      closeContextMenu({ restoreFocus: true });
      return;
    } else if ((event.key === 'Enter' || event.key === ' ') && currentIndex >= 0) {
      event.preventDefault();
      items[currentIndex].click();
      return;
    } else if (event.key === 'Tab') {
      closeContextMenu();
      return;
    } else return;
    event.preventDefault();
    items[nextIndex].focus({ preventScroll: true });
  }

  function setMessageState(title, hint, retry) {
    elements.messageState.replaceChildren();
    elements.messageState.appendChild(createSvg(['M2.5 3.5h11v8H6l-3.5 2.3V3.5z', 'M5 6.5h6M5 9h3.5']));
    const strong = document.createElement('strong');
    strong.textContent = title;
    const detail = document.createElement('span');
    detail.textContent = hint;
    elements.messageState.append(strong, detail);
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary';
      button.textContent = text('channels.retry', '重新加载');
      button.addEventListener('click', retry);
      elements.messageState.appendChild(button);
    }
    elements.messageState.hidden = false;
  }

  function renderMessages(options = {}) {
    closeContextMenu();
    const previousHeight = elements.messageScroll.scrollHeight;
    const previousTop = elements.messageScroll.scrollTop;
    const rows = [];
    for (const message of state.messages) {
      if (state.firstUnreadMessageId === message.id) {
        const divider = document.createElement('li');
        divider.className = 'communications-unread-divider';
        divider.dataset.unreadAnchor = 'true';
        const label = document.createElement('span');
        label.textContent = text('channels.firstUnread', '以下为未读消息');
        divider.appendChild(label);
        rows.push(divider);
      }
      rows.push(createMessageRow(message));
    }
    elements.messageList.replaceChildren(...rows);
    if (!state.selectedChannelId) {
      setMessageState(text('channels.selectChannel', '选择频道'), text('channels.selectHint', '从左侧选择一个频道开始交流。'));
    } else if (!state.messages.length) {
      setMessageState(text('channels.emptyTitle', '这里还没有消息'), text('channels.emptyHint', '发送第一条文字消息，建立这条协作链路。'));
    } else {
      elements.messageState.hidden = true;
    }
    requestAnimationFrame(() => {
      if (options.preserveHistory) {
        elements.messageScroll.scrollTop = elements.messageScroll.scrollHeight - previousHeight + previousTop;
      } else if (options.preservePosition) {
        elements.messageScroll.scrollTop = previousTop;
      } else if (options.anchorUnread && state.firstUnreadMessageId) {
        const anchor = elements.messageList.querySelector('[data-unread-anchor="true"]');
        if (anchor) elements.messageScroll.scrollTop = Math.max(0, anchor.offsetTop - 16);
      } else if (options.scrollBottom !== false) {
        elements.messageScroll.scrollTop = elements.messageScroll.scrollHeight;
      }
    });
  }

  function setComposerEnabled(enabled) {
    elements.input.disabled = !enabled;
    elements.send.disabled = !enabled || !codePoints(elements.input.value.trim()).length || state.sending;
  }

  function applyConversation(conversation, options = {}) {
    if (conversation.channel) updateChannel(conversation.channel);
    state.selectedChannelId = conversation.channel?.id || state.selectedChannelId;
    state.messages = conversation.messages || [];
    state.hasMore = Boolean(conversation.hasOlder ?? conversation.hasMore);
    state.hasNewer = Boolean(conversation.hasNewer);
    state.firstUnreadMessageId = conversation.firstUnreadMessageId || null;
    renderChannels();
    renderConversationHeader();
    renderMessages(options);
    setComposerEnabled(Boolean(state.selectedChannelId));
  }

  async function selectChannel(channelId) {
    if (!channelId || (state.loading && channelId === state.selectedChannelId)) return;
    closeContextMenu();
    state.selectedChannelId = channelId;
    state.messages = [];
    state.hasMore = false;
    state.hasNewer = false;
    state.firstUnreadMessageId = null;
    cancelEditing();
    state.loading = true;
    elements.messageList.replaceChildren();
    renderChannels();
    renderConversationHeader();
    setComposerEnabled(false);
    setMessageState(text('channels.loadingMessages', '正在同步消息'), text('channels.loadingMessagesHint', '正在读取这个频道的最新内容。'));
    try {
      const channel = state.channels.find(item => item.id === channelId);
      const openAtUnread = Boolean(channel?.unreadCount);
      const payload = await api(`/api/communications/channels/${encodeURIComponent(channelId)}/messages?limit=50${openAtUnread ? '&unread=1' : ''}`, { force: true });
      if (state.selectedChannelId !== channelId) return;
      applyConversation(payload, { anchorUnread: openAtUnread, scrollBottom: !openAtUnread });
      await markCurrentRead();
      elements.composerStatus.textContent = '';
    } catch (error) {
      if (state.selectedChannelId !== channelId) return;
      setMessageState(text('channels.loadFailedTitle', '消息读取失败'), error.message, () => selectChannel(channelId));
      elements.composerStatus.textContent = error.message;
    } finally {
      state.loading = false;
    }
  }

  function applyBootstrap(payload, options = {}) {
    state.currentUser = payload.currentUser;
    state.activeIdentityLabel = payload.activeIdentityLabel;
    state.messageLimit = Number(payload.messageLimit) || 500;
    state.channels = payload.channels || [];
    state.contacts = payload.contacts || [];
    state.notifications = payload.notifications || { friend: 0, channels: 0 };
    const privateUnread = state.channels.filter(channel => channel.kind === 'private')
      .reduce((total, channel) => total + channel.unreadCount, 0);
    state.friendRequestCount = Math.max(0, state.notifications.friend - privateUnread);
    updateNavigationNotifications(state.notifications);
    if (options.preserveConversation && state.initialized) {
      if (!state.channels.some(channel => channel.id === state.selectedChannelId)) {
        state.selectedChannelId = payload.selectedChannelId;
        applyConversation(payload.conversation || { channel: null, messages: [], hasMore: false }, options);
      } else {
        renderChannels();
        renderConversationHeader();
      }
    } else {
      state.selectedChannelId = payload.selectedChannelId;
      applyConversation(payload.conversation || { channel: null, messages: [], hasMore: false }, options);
    }
    renderCreateContacts();
    elements.page.setAttribute('aria-busy', 'false');
    state.initialized = true;
  }

  async function markCurrentRead() {
    const message = state.messages.at(-1);
    const channelId = state.selectedChannelId;
    if (!state.active || document.visibilityState === 'hidden' || !message || !channelId) return;
    try {
      const payload = await api(`/api/communications/channels/${encodeURIComponent(channelId)}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: message.id })
      });
      if (channelId !== state.selectedChannelId) return;
      if (payload.channel) updateChannel(payload.channel);
      const channelUnread = state.channels.reduce((total, channel) => total + channel.unreadCount, 0);
      const privateUnread = state.channels.filter(channel => channel.kind === 'private')
        .reduce((total, channel) => total + channel.unreadCount, 0);
      state.notifications = { channels: channelUnread, friend: state.friendRequestCount + privateUnread };
      updateNavigationNotifications(state.notifications);
      renderChannels();
    } catch {}
  }

  async function loadBootstrap(options = {}) {
    if (state.loading && !options.force) return;
    const version = ++state.bootstrapVersion;
    state.loading = true;
    elements.page.setAttribute('aria-busy', 'true');
    if (!state.initialized) {
      elements.listState.textContent = text('channels.loading', '正在同步频道…');
      setMessageState(text('channels.loadingMessages', '正在同步消息'), text('channels.loadingMessagesHint', '通讯链路建立后将自动显示最新内容。'));
    }
    const selected = options.channelId || state.selectedChannelId;
    const query = selected ? `?channelId=${encodeURIComponent(selected)}` : '';
    try {
      const payload = await api(`/api/communications/bootstrap${query}`, { force: Boolean(options.force) });
      if (version !== state.bootstrapVersion) return;
      applyBootstrap(payload, {
        scrollBottom: options.scrollBottom !== false,
        anchorUnread: Boolean(options.anchorUnread),
        preserveConversation: Boolean(options.preserveConversation),
        preservePosition: Boolean(options.preservePosition)
      });
      elements.listState.textContent = '';
      await markCurrentRead();
    } catch (error) {
      if (version !== state.bootstrapVersion) return;
      elements.listState.replaceChildren();
      const message = document.createElement('span');
      message.textContent = text('channels.loadFailed', '频道读取失败：{error}', { error: error.message });
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-secondary';
      retry.textContent = text('channels.retry', '重新加载');
      retry.addEventListener('click', () => loadBootstrap({ force: true }));
      elements.listState.append(message, retry);
      setMessageState(text('channels.loadFailedTitle', '通讯频道读取失败'), error.message, () => loadBootstrap({ force: true }));
      elements.page.setAttribute('aria-busy', 'false');
    } finally {
      if (version === state.bootstrapVersion) state.loading = false;
    }
  }

  async function loadOlderMessages() {
    if (state.historyLoading || !state.hasMore || !state.messages.length || !state.selectedChannelId) return;
    state.historyLoading = true;
    elements.historyState.hidden = false;
    const channelId = state.selectedChannelId;
    const earliestId = state.messages[0].id;
    try {
      const payload = await api(`/api/communications/channels/${encodeURIComponent(channelId)}/messages?before=${earliestId}&limit=50`, { force: true });
      if (channelId !== state.selectedChannelId) return;
      const known = new Set(state.messages.map(message => message.id));
      state.messages = [...payload.messages.filter(message => !known.has(message.id)), ...state.messages];
      state.hasMore = Boolean(payload.hasOlder ?? payload.hasMore);
      renderMessages({ preserveHistory: true, scrollBottom: false });
    } catch (error) {
      elements.composerStatus.textContent = text('channels.historyFailed', '更早消息读取失败：{error}', { error: error.message });
    } finally {
      state.historyLoading = false;
      elements.historyState.hidden = true;
    }
  }

  async function loadNewerMessages() {
    if (state.newerLoading || !state.hasNewer || !state.messages.length || !state.selectedChannelId) return;
    state.newerLoading = true;
    const channelId = state.selectedChannelId;
    const latestId = state.messages.at(-1).id;
    try {
      const payload = await api(`/api/communications/channels/${encodeURIComponent(channelId)}/messages?after=${latestId}&limit=50`, { force: true });
      if (channelId !== state.selectedChannelId) return;
      const known = new Set(state.messages.map(message => message.id));
      state.messages.push(...payload.messages.filter(message => !known.has(message.id)));
      state.hasNewer = Boolean(payload.hasNewer);
      if (payload.channel) updateChannel(payload.channel);
      renderMessages({ scrollBottom: true });
      await markCurrentRead();
    } catch (error) {
      elements.composerStatus.textContent = text('channels.newerFailed', '后续消息读取失败：{error}', { error: error.message });
    } finally {
      state.newerLoading = false;
    }
  }

  function updateComposer() {
    const points = codePoints(elements.input.value);
    if (points.length > state.messageLimit) {
      elements.input.value = points.slice(0, state.messageLimit).join('');
    }
    const length = codePoints(elements.input.value).length;
    elements.count.textContent = `${length} / ${state.messageLimit}`;
    elements.count.classList.toggle('is-limit', length >= state.messageLimit);
    elements.send.disabled = !state.selectedChannelId || !elements.input.value.trim() || state.sending;
    const sendLabel = state.editingMessageId ? text('channels.saveEdit', '保存修改') : text('channels.send', '发送消息');
    elements.send.title = sendLabel;
    elements.send.setAttribute('aria-label', sendLabel);
    if (!state.sending) elements.composerStatus.textContent = '';
  }

  async function pasteFromClipboard() {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText) insertComposerText(clipboardText);
    } catch {
      elements.composerStatus.textContent = text('channels.pasteDenied', '浏览器未授权读取剪贴板，请使用 Ctrl + V 粘贴');
      elements.input.focus();
    }
  }

  async function sendCurrentMessage() {
    const content = elements.input.value.trim();
    if (!content || !state.selectedChannelId || state.sending) return;
    state.sending = true;
    updateComposer();
    const channelId = state.selectedChannelId;
    try {
      const editingMessage = state.editingMessageId
        ? state.messages.find(message => message.id === state.editingMessageId) : null;
      const payload = await api(editingMessage
        ? `/api/communications/messages/${editingMessage.id}`
        : `/api/communications/channels/${encodeURIComponent(channelId)}/messages`, {
        method: editingMessage ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      if (editingMessage) {
        replaceMessage(payload.message);
      } else if (channelId === state.selectedChannelId && !state.messages.some(message => message.id === payload.message.id)) {
        state.messages.push(payload.message);
        const channel = state.channels.find(item => item.id === channelId);
        if (channel) {
          channel.lastMessage = payload.message;
          channel.unreadCount = 0;
          channel.updatedAt = payload.message.createdAt;
        }
        renderChannels();
        renderMessages();
      }
      cancelEditing();
      elements.input.focus();
    } catch (error) {
      elements.composerStatus.textContent = text(
        state.editingMessageId ? 'channels.editFailed' : 'channels.sendFailed',
        state.editingMessageId ? '修改失败：{error}' : '发送失败：{error}', { error: error.message }
      );
    } finally {
      state.sending = false;
      updateComposer();
    }
  }

  function setLiveState(mode) {
    elements.liveState.classList.toggle('is-live', mode === 'live');
    elements.liveState.classList.toggle('is-error', mode === 'error');
    const label = elements.liveState.lastElementChild;
    label.textContent = mode === 'live'
      ? text('channels.live', '实时')
      : mode === 'error'
        ? text('channels.reconnecting', '正在重连')
        : text('channels.connecting', '连接中');
  }

  function announceMessage(message) {
    if (!message || message.mine) return;
    const preview = codePoints(message.content.replace(/\s+/g, ' ')).slice(0, 80).join('');
    elements.announcement.textContent = text('channels.newMessageAnnouncement', '{name}发来消息：{content}', {
      name: message.sender?.displayName || text('channels.unknownUser', '未知用户'),
      content: preview
    });
  }

  function scheduleRealtimeRefresh(event) {
    state.pendingEvents.set(`${event.type}:${event.channelId || ''}:${event.messageId || ''}`, event);
    clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(async () => {
      const events = [...state.pendingEvents.values()];
      state.pendingEvents.clear();
      const nearBottom = elements.messageScroll.scrollHeight - elements.messageScroll.scrollTop - elements.messageScroll.clientHeight < 120;
      await loadBootstrap({ force: true, preserveConversation: true, preservePosition: true, scrollBottom: false });
      if (!state.active) return;
      const currentEvents = events.filter(item => item.channelId === state.selectedChannelId && item.messageId);
      let changed = false;
      let announcedMessage = null;
      for (const currentEvent of currentEvents) {
        if (currentEvent.type === 'message-deleted') {
          const next = state.messages.filter(message => message.id !== currentEvent.messageId);
          changed ||= next.length !== state.messages.length;
          state.messages = next;
          continue;
        }
        try {
          const payload = await api(`/api/communications/channels/${encodeURIComponent(currentEvent.channelId)}/messages?before=${Number(currentEvent.messageId) + 1}&limit=1&markRead=0`, { force: true });
          if (currentEvent.channelId !== state.selectedChannelId) continue;
          const message = payload.messages.find(item => item.id === currentEvent.messageId);
          if (!message) continue;
          const index = state.messages.findIndex(item => item.id === message.id);
          if (index >= 0) state.messages[index] = message;
          else state.messages.push(message);
          state.messages.sort((left, right) => left.id - right.id);
          changed = true;
          if (currentEvent.type === 'message') announcedMessage = message;
        } catch {}
      }
      if (changed) {
        renderMessages({ preservePosition: !nearBottom, scrollBottom: nearBottom });
        if (nearBottom) await markCurrentRead();
      }
      if (announcedMessage) announceMessage(announcedMessage);
    }, 80);
  }

  function stopEvents() {
    if (state.eventSource) state.eventSource.close();
    state.eventSource = null;
    clearTimeout(state.refreshTimer);
    state.pendingEvents.clear();
    setLiveState('idle');
  }

  function startEvents() {
    stopEvents();
    if (!window.EventSource) return;
    setLiveState('idle');
    const source = new EventSource('/api/communications/events');
    state.eventSource = source;
    source.addEventListener('ready', () => setLiveState('live'));
    source.addEventListener('communication', event => {
      setLiveState('live');
      try {
        scheduleRealtimeRefresh(JSON.parse(event.data));
      } catch {}
    });
    source.onopen = () => setLiveState('live');
    source.onerror = () => setLiveState('error');
  }

  function contactOption(contact, mode) {
    const label = document.createElement('label');
    label.className = 'communications-contact-option';
    label.appendChild(avatarElement('communications-contact-avatar', contact, 'private'));
    const copy = document.createElement('span');
    copy.className = 'communications-contact-copy';
    const name = document.createElement('strong');
    name.textContent = contact.displayName;
    const detail = document.createElement('span');
    detail.textContent = contact.title || `@${contact.account}`;
    copy.append(name, detail);
    const input = document.createElement('input');
    input.type = mode === 'private' ? 'radio' : 'checkbox';
    input.name = mode === 'private' ? 'communicationPrivateContact' : 'communicationCustomContact';
    input.value = contact.id;
    input.addEventListener('change', updateCreateValidity);
    label.append(copy, input);
    return label;
  }

  function renderCreateContacts() {
    elements.privateContacts.replaceChildren(...state.contacts.map(contact => contactOption(contact, 'private')));
    elements.customContacts.replaceChildren(...state.contacts.map(contact => contactOption(contact, 'custom')));
    elements.contactsEmpty.hidden = state.contacts.length > 0;
    updateCreateValidity();
  }

  function setCreateMode(mode) {
    state.createMode = mode;
    document.querySelectorAll('[data-communication-mode]').forEach(button => {
      const selected = button.dataset.communicationMode === mode;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('[data-communication-panel]').forEach(panel => {
      panel.hidden = panel.dataset.communicationPanel !== mode;
    });
    elements.createSubmit.textContent = mode === 'private'
      ? text('channels.startChat', '开始聊天') : text('channels.createChannel', '创建频道');
    elements.dialogStatus.textContent = '';
    updateCreateValidity();
  }

  function updateCreateValidity() {
    const privateSelected = elements.privateContacts.querySelector('input:checked');
    const customCount = elements.customContacts.querySelectorAll('input:checked').length;
    const validCustom = codePoints(elements.channelName.value.trim()).length >= 2
      && codePoints(elements.channelName.value.trim()).length <= 30 && customCount >= 1 && customCount <= 20;
    elements.createSubmit.disabled = state.createMode === 'private' ? !privateSelected : !validCustom;
  }

  function openCreateDialog() {
    elements.createForm.reset();
    setCreateMode('private');
    renderCreateContacts();
    if (!elements.dialog.open) elements.dialog.showModal();
  }

  async function submitCreate() {
    if (elements.createSubmit.disabled) return;
    elements.createSubmit.disabled = true;
    elements.dialogStatus.textContent = text('channels.creating', '正在创建聊天…');
    try {
      const isPrivate = state.createMode === 'private';
      const url = isPrivate ? '/api/communications/private' : '/api/communications/channels';
      const body = isPrivate
        ? { userId: elements.privateContacts.querySelector('input:checked')?.value }
        : {
            name: elements.channelName.value.trim(),
            description: elements.channelDescription.value.trim(),
            memberIds: [...elements.customContacts.querySelectorAll('input:checked')].map(input => input.value)
          };
      const payload = await api(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      elements.dialog.close();
      await loadBootstrap({ force: true, channelId: payload.channel.id });
    } catch (error) {
      elements.dialogStatus.textContent = text('channels.createFailed', '创建失败：{error}', { error: error.message });
    } finally {
      updateCreateValidity();
    }
  }

  elements.channelName.addEventListener('input', updateCreateValidity);
  elements.channelDescription.addEventListener('input', updateCreateValidity);
  elements.input.addEventListener('input', updateComposer);
  elements.input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.editingMessageId) {
      event.preventDefault();
      cancelEditing();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendCurrentMessage();
    }
  });
  elements.composer.addEventListener('submit', event => {
    event.preventDefault();
    sendCurrentMessage();
  });
  elements.messageScroll.addEventListener('contextmenu', event => {
    event.preventDefault();
    const target = event.target instanceof Element ? event.target : null;
    const row = target?.closest('.communications-message-row[data-message-id]');
    if (!row || !elements.messageScroll.contains(row)) {
      closeContextMenu();
      return;
    }
    const message = state.messages.find(item => String(item.id) === row.dataset.messageId);
    if (!message) {
      closeContextMenu();
      return;
    }
    openContextMenu(message, row, { x: event.clientX, y: event.clientY }, {
      trigger: row,
      keyboard: false
    });
  });
  elements.messageScroll.addEventListener('keydown', event => {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
    const target = event.target instanceof Element ? event.target : null;
    const row = target?.closest('.communications-message-row[data-message-id]');
    if (!row) return;
    const message = state.messages.find(item => String(item.id) === row.dataset.messageId);
    if (!message) return;
    event.preventDefault();
    const anchor = target.closest('.communications-message-bubble') || row;
    const rect = anchor.getBoundingClientRect();
    openContextMenu(message, row, {
      x: Math.min(window.innerWidth - 8, rect.left + Math.min(32, rect.width / 2)),
      y: Math.min(window.innerHeight - 8, rect.top + Math.min(24, rect.height / 2))
    }, {
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : row,
      keyboard: true
    });
  });
  elements.messageScroll.addEventListener('scroll', () => {
    closeContextMenu();
    if (elements.messageScroll.scrollTop < 120) loadOlderMessages();
    const distanceToBottom = elements.messageScroll.scrollHeight - elements.messageScroll.scrollTop - elements.messageScroll.clientHeight;
    if (distanceToBottom < 160) loadNewerMessages();
  }, { passive: true });
  elements.contextMenu.addEventListener('keydown', handleContextMenuKeydown);
  elements.contextMenu.addEventListener('contextmenu', event => event.preventDefault());
  elements.paste.addEventListener('click', pasteFromClipboard);
  elements.editCancel.addEventListener('click', () => cancelEditing());
  elements.createOpen.addEventListener('click', openCreateDialog);
  elements.createClose.addEventListener('click', () => elements.dialog.close());
  elements.createCancel.addEventListener('click', () => elements.dialog.close());
  elements.createForm.addEventListener('submit', event => {
    event.preventDefault();
    submitCreate();
  });
  elements.dialog.addEventListener('click', event => {
    if (event.target === elements.dialog) elements.dialog.close();
  });
  document.addEventListener('click', event => {
    document.querySelectorAll('.communications-message-menu[open]').forEach(menu => {
      if (!menu.contains(event.target)) menu.removeAttribute('open');
    });
  });
  document.addEventListener('pointerdown', event => {
    if (!elements.contextMenu.hidden && !elements.contextMenu.contains(event.target)) closeContextMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || elements.contextMenu.hidden) return;
    event.preventDefault();
    closeContextMenu({ restoreFocus: true });
  });
  window.addEventListener('resize', () => closeContextMenu());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.active) {
      loadBootstrap({ force: true, preserveConversation: true, preservePosition: true, scrollBottom: false })
        .then(markCurrentRead);
    }
  });
  document.querySelectorAll('[data-communication-mode]').forEach(button => {
    button.addEventListener('click', () => setCreateMode(button.dataset.communicationMode));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll('[data-communication-mode]')];
      const current = tabs.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      setCreateMode(tabs[next].dataset.communicationMode);
      tabs[next].focus();
    });
  });

  window.addEventListener('stella:page-change', event => {
    state.active = event.detail?.page === 'channels';
    if (!state.active) closeContextMenu();
    if (!state.active) return;
    if (!state.initialized) loadBootstrap({ anchorUnread: true });
    else loadBootstrap({ force: true, anchorUnread: true, scrollBottom: false });
  });

  window.addEventListener('stella:identity-change', () => {
    closeContextMenu();
    state.initialized = false;
    state.selectedChannelId = null;
    state.messages = [];
    stopEvents();
    loadBootstrap({ force: true }).then(() => {
      startEvents();
    });
  });

  window.addEventListener('stella:open-channel', event => {
    const channelId = event.detail?.channelId;
    if (!channelId) return;
    state.active = true;
    loadBootstrap({ force: true, channelId, anchorUnread: true, scrollBottom: false });
  });

  const initialButton = document.querySelector('[data-page="channels"].active');
  state.active = Boolean(initialButton);
  loadBootstrap({ anchorUnread: state.active, scrollBottom: !state.active }).then(() => {
    startEvents();
  });
})();
