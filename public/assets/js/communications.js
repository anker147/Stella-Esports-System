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
    channelSearch: document.getElementById('communicationsChannelSearch'),
    announcementBar: document.getElementById('communicationsAnnouncement'),
    liveAnnouncer: document.getElementById('communicationsLiveAnnouncer'),
    back: document.getElementById('communicationsBack'),
    settingsOpen: document.getElementById('communicationsSettingsOpen'),
    settingsDialog: document.getElementById('communicationsSettingsDialog'),
    settingsClose: document.getElementById('communicationsSettingsClose'),
    settingsCancel: document.getElementById('communicationsSettingsCancel'),
    settingsForm: document.getElementById('communicationsSettingsForm'),
    settingsName: document.getElementById('communicationsSettingsName'),
    settingsDescription: document.getElementById('communicationsSettingsDescription'),
    settingsAnnouncement: document.getElementById('communicationsSettingsAnnouncement'),
    settingsPinned: document.getElementById('communicationsSettingsPinned'),
    settingsMuted: document.getElementById('communicationsSettingsMuted'),
    settingsFeedback: document.getElementById('communicationsSettingsFeedback'),
    settingsAvatarActions: document.getElementById('communicationsSettingsAvatarActions'),
    settingsInfoName: document.getElementById('communicationsSettingsInfoName'),
    settingsInfoMeta: document.getElementById('communicationsSettingsInfoMeta'),
    settingsEdit: document.getElementById('communicationsSettingsEdit'),
    settingsMembers: document.getElementById('communicationsSettingsMembers'),
    settingsMemberList: document.getElementById('communicationsSettingsMemberList'),
    settingsClear: document.getElementById('communicationsSettingsClear'),
    settingsSave: document.getElementById('communicationsSettingsSave'),
    settingsAvatarBtn: document.getElementById('communicationsSettingsAvatarBtn'),
    settingsNameRow: document.getElementById('communicationsSettingsNameRow'),
    settingsIdRow: document.getElementById('communicationsSettingsIdRow'),
    settingsInfoId: document.getElementById('communicationsSettingsInfoId'),
    settingsMembersCount: document.getElementById('communicationsSettingsMembersCount'),
    settingsAnnouncementSection: document.getElementById('communicationsSettingsAnnouncementSection'),
    settingsAnnouncementSave: document.getElementById('communicationsSettingsAnnouncementSave'),
    settingsSearchInput: document.getElementById('communicationsSettingsSearchInput'),
    settingsSearchBtn: document.getElementById('communicationsSettingsSearchBtn'),
    settingsSearchResults: document.getElementById('communicationsSettingsSearchResults'),
    settingsFavorite: document.getElementById('communicationsSettingsFavorite'),
    settingsFavoriteItem: document.getElementById('communicationsSettingsFavoriteItem'),
    settingsNickname: document.getElementById('communicationsSettingsNickname'),
    settingsNicknameInput: document.getElementById('communicationsSettingsNicknameInput'),
    settingsBackgroundSwatches: document.getElementById('communicationsBackgroundSwatches'),
    settingsBackgroundInput: document.getElementById('communicationsBackgroundInput'),
    settingsBackgroundReset: document.getElementById('communicationsBackgroundReset'),
    settingsLeave: document.getElementById('communicationsSettingsLeave'),
    emojiButton: document.getElementById('communicationsEmoji'),
    emojiPanel: document.getElementById('communicationsEmojiPanel'),
    emojiTabs: document.getElementById('communicationsEmojiTabs'),
    emojiGrid: document.getElementById('communicationsEmojiGrid'),
    urgentOverlay: document.getElementById('communicationsUrgentOverlay'),
    urgentModal: document.querySelector('#communicationsUrgentOverlay .communications-urgent-modal'),
    urgentMeta: document.getElementById('communicationsUrgentMeta'),
    urgentPreview: document.getElementById('communicationsUrgentPreview'),
    urgentTime: document.getElementById('communicationsUrgentTime'),
    urgentClose: document.getElementById('communicationsUrgentClose'),
    urgentView: document.getElementById('communicationsUrgentView'),
    avatarInput: document.getElementById('communicationsAvatarInput'),
    avatarRemove: document.getElementById('communicationsAvatarRemove'),
    contextMenu: document.getElementById('communicationsContextMenu'),
    announcement: document.getElementById('communicationsLiveAnnouncer'),
    historyState: document.getElementById('communicationsHistoryState'),
    composer: document.getElementById('communicationsComposer'),
    input: document.getElementById('communicationsInput'),
    count: document.getElementById('communicationsCharacterCount'),
    send: document.getElementById('communicationsSend'),
    paste: document.getElementById('communicationsPaste'),
    media: document.getElementById('communicationsMedia'),
    voice: document.getElementById('communicationsVoice'),
    mediaInput: document.getElementById('communicationsMediaInput'),
    quoteMode: document.getElementById('communicationsQuoteMode'),
    quoteLabel: document.getElementById('communicationsQuoteLabel'),
    quoteCancel: document.getElementById('communicationsQuoteCancel'),
    composerPreview: document.getElementById('communicationsComposerPreview'),
    previewList: document.getElementById('communicationsPreviewList'),
    previewOriginal: document.getElementById('communicationsPreviewOriginal'),
    previewCancel: document.getElementById('communicationsPreviewCancel'),
    previewSend: document.getElementById('communicationsPreviewSend'),
    recorder: document.getElementById('communicationsRecorder'),
    recorderTime: document.getElementById('communicationsRecorderTime'),
    recorderHint: document.getElementById('communicationsRecorderHint'),
    lightbox: document.getElementById('communicationsLightbox'),
    lightboxImage: document.getElementById('communicationsLightboxImage'),
    lightboxCaption: document.getElementById('communicationsLightboxCaption'),
    lightboxClose: document.getElementById('communicationsLightboxClose'),
    lightboxDownload: document.getElementById('communicationsLightboxDownload'),
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
    quotedMessageId: null,
    pendingFiles: [],
    sendingMedia: false,
    activeIdentityKey: '',
    lightboxMessageId: null,
    lastLongPressAt: 0,
    eventSource: null,
    refreshTimer: 0,
    pendingEvents: new Map(),
    bootstrapVersion: 0,
    createMode: 'private',
    contextMenuMessageId: null,
    contextMenuTrigger: null,
    contextMenuKeyboardOpened: false,
    urgentMessage: null,
    urgentGraceTimer: 0,
    channelMenuTargetId: null,
    channelQuery: ''
  };

  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = String(content);
    return element;
  }

  function api(url, options = {}) {
    if (window.StellaDataCache) return window.StellaDataCache.json(url, options);
    return fetch(url, options).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || text('channels.requestFailed', '请求失败'));
      return payload;
    });
  }

  const voicePlayback = { audio: null, messageId: null };
  const voiceRecording = {
    active: false, stream: null, recorder: null, chunks: [],
    startedAt: 0, timer: 0, cancelZone: false, pointerId: null, desktop: false
  };
  const coarsePointer = window.matchMedia('(pointer: coarse)');

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(Number(ms) / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function setMobileView(view) {
    elements.page.dataset.mobileView = view;
  }

  function isMobileLayout() {
    return window.matchMedia('(max-width: 760px)').matches;
  }

  // 触屏长按（iOS 无原生 contextmenu）：480ms 触发，位移 >10px 视为滚动取消；
  // 触发后短窗内吞掉原生 contextmenu（Android 会两者都发）与行点击。
  function attachLongPress(target, handler) {
    const control = { timer: 0, x: 0, y: 0 };
    target.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0) return;
      control.x = event.clientX;
      control.y = event.clientY;
      clearTimeout(control.timer);
      control.timer = window.setTimeout(() => {
        control.timer = 0;
        state.lastLongPressAt = Date.now();
        handler({ x: control.x, y: control.y });
      }, 480);
    });
    const cancel = () => {
      clearTimeout(control.timer);
      control.timer = 0;
    };
    target.addEventListener('pointermove', event => {
      if (control.timer && (Math.abs(event.clientX - control.x) > 10 || Math.abs(event.clientY - control.y) > 10)) cancel();
    }, { passive: true });
    target.addEventListener('pointerup', cancel, { passive: true });
    target.addEventListener('pointercancel', cancel, { passive: true });
  }

  function longPressJustFired(withinMs = 500) {
    return Date.now() - state.lastLongPressAt < withinMs;
  }

  function messageQuotedPreview(message) {
    if (message.recalled) return text('channels.quotedMessageRecalled', '原消息已撤回');
    if (message.unavailable) return text('channels.quotedUnavailable', '原消息不可见');
    if (message.kind && message.kind !== 'text') return message.content;
    return codePoints(String(message.content || '').replace(/\s+/g, ' ')).slice(0, 60).join('');
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

  const CHANNEL_KIND_ICONS = {
    global: ['M1.8 3.2h12.4v7.6H7.6l-3.6 3.2v-3.2H1.8z', 'M4.8 6h6.4M4.8 8.4h4'],
    identity: ['M8 1.6l5.2 2v3.6c0 3.3-2.3 5.5-5.2 6.8-2.9-1.3-5.2-3.5-5.2-6.8V3.6l5.2-2z', 'M5.4 7.8l1.7 1.7 3.4-3.6'],
    private: ['M5.6 7.4a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.6 13.6c0-2.3 1.8-4.1 4-4.1s4 1.8 4 4.1', 'M11 7.2a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6M10.3 13.4c.3-1.7 1.6-3 3.3-3.4'],
    custom: ['M8 4.2a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM2.6 13.2v-2.4a3.2 3.2 0 0 1 3.2-3.2h4.4a3.2 3.2 0 0 1 3.2 3.2v2.4', 'M5.8 13.2v-2M10.2 13.2v-2']
  };

  function channelKindIcon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.3');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const data of CHANNEL_KIND_ICONS[kind] || CHANNEL_KIND_ICONS.custom) {
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
    avatar.classList.add('communications-avatar-generated', 'communications-avatar-' + kind);
    avatar.appendChild(channelKindIcon(kind));
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
    const last = channel.lastMessage;
    if (last) {
      const who = last.sender?.displayName ? `${last.sender.displayName}：` : '';
      // 非文本消息的 content 由服务端写权威标记（[语音]/[图片]/[视频]），直接复用
      return `${who}${last.content}`.replace(/\s+/g, ' ');
    }
    if (channel.description) return channel.description;
    if (channel.kind === 'identity') return text('channels.identitySummary', '{identity}身份成员可见', { identity: channel.identityLabel || state.activeIdentityLabel });
    if (channel.kind === 'global') return text('channels.globalSummary', '所有在线成员可见');
    if (channel.kind === 'private') return text('channels.privateSummary', '好友私密会话');
    return text('channels.emptySummary', '尚无消息');
  }

  function groupLabel(key) {
    return {
      pinned: text('channels.groupPinned', '置顶'),
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
    const query = state.channelQuery.trim().toLowerCase();
    const matches = channel => !query || channel.name.toLowerCase().includes(query);
    // 置顶对话跨分组浮顶（QQ/微信式）：排在所有分组之前，各分组只收未置顶频道
    const pinned = state.channels.filter(channel => channel.pinned)
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const groups = [
      ['pinned', pinned],
      ['public', state.channels.filter(channel => (channel.kind === 'global' || channel.kind === 'identity') && !channel.pinned)],
      ['private', state.channels.filter(channel => channel.kind === 'private' && !channel.pinned)],
      ['custom', state.channels.filter(channel => channel.kind === 'custom' && !channel.pinned)]
    ];
    for (const [key, channels] of groups) {
      const ordered = channels
        .filter(matches)
        .slice()
        .sort((left, right) => right.updatedAt - left.updatedAt);
      // 置顶组无内容时整组隐藏；搜索时空分组隐藏
      if (!ordered.length && (query || key === 'pinned')) continue;
      const section = document.createElement('section');
      section.className = 'communications-channel-group';
      const heading = document.createElement('div');
      heading.className = 'communications-channel-group-title';
      const label = document.createElement('span');
      label.textContent = groupLabel(key);
      const count = document.createElement('span');
      count.textContent = String(ordered.length);
      heading.append(label, count);
      section.appendChild(heading);
      for (const channel of ordered) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'communications-channel-row';
        button.dataset.channelId = channel.id;
        button.classList.toggle('is-active', channel.id === state.selectedChannelId);
        button.setAttribute('aria-current', channel.id === state.selectedChannelId ? 'page' : 'false');
        const avatar = avatarElement('communications-channel-avatar', channel, channel.kind);
        if (channel.pinned) {
          const pin = document.createElement('span');
          pin.className = 'communications-pin-badge';
          pin.title = text('channels.pinLabel', '置顶');
          pin.innerHTML = '<svg viewBox="0 0 24 24" data-icon="pin" data-icon-fill="true" aria-hidden="true"></svg>';
          avatar.appendChild(pin);
        }
        button.appendChild(avatar);
        const copy = document.createElement('span');
        copy.className = 'communications-channel-row-copy';
        const name = document.createElement('strong');
        name.textContent = channel.name;
        const summary = document.createElement('span');
        summary.textContent = channelSummary(channel);
        copy.append(name, summary);
        if (channel.muted) {
          const flag = document.createElement('span');
          flag.className = 'communications-muted-flag';
          flag.title = text('channels.muteLabel', '免打扰');
          flag.innerHTML = '<svg viewBox="0 0 24 24" data-icon="bell-off" aria-hidden="true"></svg>';
          copy.append(flag);
        }
        button.appendChild(copy);
        if (channel.unreadCount > 0) {
          const unread = document.createElement('span');
          unread.className = channel.muted ? 'communications-unread is-muted' : 'communications-unread';
          unread.textContent = channel.muted ? '•' : channel.unreadCount > 99 ? '99+' : String(channel.unreadCount);
          unread.setAttribute('aria-label', text('channels.unreadCount', '{count} 条未读消息', { count: channel.unreadCount }));
          button.appendChild(unread);
        }
        button.addEventListener('click', () => {
          if (longPressJustFired()) return;
          selectChannel(channel.id);
        });
        attachLongPress(button, point => {
          openChannelMenu(channel, button, point);
        });
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
    if (channel.avatarUrl) {
      const image = document.createElement('img');
      image.src = channel.avatarUrl;
      image.alt = '';
      elements.currentAvatar.replaceChildren(image);
      elements.currentAvatar.classList.remove('communications-avatar-generated');
      elements.currentAvatar.classList.remove('communications-avatar-global', 'communications-avatar-identity', 'communications-avatar-private', 'communications-avatar-custom');
    } else {
      elements.currentAvatar.replaceChildren(channelKindIcon(channel.kind));
      elements.currentAvatar.classList.add('communications-avatar-generated');
      elements.currentAvatar.classList.add('communications-avatar-' + channel.kind);
    }
    elements.title.textContent = channel.name;
    elements.description.textContent = channel.description || channelSummary(channel);
    elements.kind.textContent = kindLabel(channel.kind);
    elements.kind.hidden = false;
    renderAnnouncementBar(channel);
  }

  function renderAnnouncementBar(channel) {
    const bar = elements.announcementBar;
    if (!bar) return;
    const announcement = String(channel?.announcement || '').trim();
    bar.hidden = !announcement;
    bar.replaceChildren(...(announcement
      ? [node('span', 'communications-announcement-tag', text('channels.announcementTag', '公告')),
         node('span', 'communications-announcement-text', announcement)]
      : []));
  }

  function canManageSelectedChannel() {
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    return Boolean(channel && (channel.mine || channel.developerObserver));
  }

  function openChannelSettings() {
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    if (!channel) return;
    const canManage = canManageSelectedChannel();
    // QQ 手机版式分区：信息卡（头像/名称/ID）→ 编辑表单 → 成员网格 → 公告 → 查找记录
    // → 开关（置顶/特别关心/免打扰）→ 群昵称 → 聊天背景 → 危险区（清空/退出）
    const isCustom = channel.kind === 'custom';
    const canEditFields = isCustom && canManage;
    elements.settingsEdit.hidden = !canEditFields;
    elements.settingsSave.hidden = !canEditFields;
    if (canEditFields) {
      elements.settingsName.value = channel.name;
      elements.settingsDescription.value = channel.description;
    }
    // 名称行点击才展开编辑（QQ 式「点击相应区域可以进行编辑」）
    elements.settingsNameRow.disabled = !canEditFields;
    const canAvatar = canEditFields;
    elements.settingsAvatarActions.hidden = true;
    elements.settingsAvatarBtn.disabled = !canAvatar;
    elements.settingsAvatarBtn.title = canAvatar
      ? text('channels.avatarEditHint', '点击更换头像') : '';
    elements.avatarRemove.disabled = !canAvatar || !channel.avatarUrl;
    elements.avatarInput.disabled = !canAvatar;
    // 公告：所有频道可读，仅自建管理身份可编辑
    const announcementEditable = canEditFields;
    elements.settingsAnnouncementSection.hidden = false;
    elements.settingsAnnouncement.value = channel.announcement || '';
    elements.settingsAnnouncement.disabled = !announcementEditable;
    elements.settingsAnnouncementSave.hidden = !announcementEditable;
    // 开关：置顶/免打扰恒显，特别关心仅私聊
    elements.settingsPinned.checked = Boolean(channel.pinned);
    elements.settingsMuted.checked = Boolean(channel.muted);
    elements.settingsFavorite.checked = Boolean(channel.favorite);
    elements.settingsFavoriteItem.hidden = channel.kind !== 'private';
    // 群昵称仅自建频道普通成员可设（开发者视角无成员行）
    const showNickname = isCustom && !channel.developerObserver;
    elements.settingsNickname.hidden = !showNickname;
    if (showNickname) {
      elements.settingsNicknameInput.value = channel.myNickname || '';
    }
    // 退出频道：自建频道的普通成员
    elements.settingsLeave.hidden = !(isCustom && !channel.mine && !channel.developerObserver);
    renderSettingsInfo(channel);
    renderSettingsMembers(channel);
    setSettingsAvatarPreview(channel);
    renderBackgroundSwatches(channel);
    resetSettingsSearch();
    setFeedback('');
    elements.settingsFeedback.textContent = '';
    elements.settingsDialog.showModal();
  }

  function renderSettingsInfo(channel) {
    elements.settingsInfoName.textContent = channel.name;
    elements.settingsInfoId.textContent = channel.id;
    const meta = [];
    if (channel.kind === 'custom') {
      meta.push(text('channels.membersCount', '{count} 名成员', {
        count: channel.memberCount ?? (channel.members?.length || 0)
      }));
    } else {
      meta.push(kindLabel(channel.kind));
    }
    if (channel.developerObserver) meta.push(text('channels.developerView', '开发者视角'));
    elements.settingsInfoMeta.textContent = meta.join(' · ');
    // 非自建频道没有「编辑」入口，铅笔行退化为纯展示
    elements.settingsNameRow.classList.toggle('is-static', !(channel.kind === 'custom' && canManageSelectedChannel()));
  }

  // QQ 式成员网格：头像在上、昵称在下，群主戴徽标
  function renderSettingsMembers(channel) {
    const members = channel.members || [];
    const showMembers = (channel.kind === 'private' || channel.kind === 'custom') && members.length > 0;
    elements.settingsMembers.hidden = !showMembers;
    elements.settingsMemberList.replaceChildren();
    if (!showMembers) return;
    elements.settingsMembersCount.textContent = text('channels.membersCount', '{count} 名成员', {
      count: channel.memberCount ?? members.length
    });
    for (const member of members) {
      const item = document.createElement('li');
      item.className = 'communications-settings-member';
      const cell = document.createElement('div');
      cell.className = 'communications-settings-member-cell';
      cell.appendChild(avatarElement('communications-settings-member-avatar', member, 'private'));
      const name = document.createElement('span');
      name.className = 'communications-settings-member-name';
      name.textContent = member.displayName || member.account || text('channels.unknownUser', '未知用户');
      cell.appendChild(name);
      item.appendChild(cell);
      if (channel.kind === 'custom' && channel.ownerUserId === member.id) {
        item.appendChild(node('span', 'communications-settings-owner-badge', text('channels.ownerBadge', '群主')));
      }
      elements.settingsMemberList.appendChild(item);
    }
  }

  async function saveChannelPrefsInstant() {
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    if (!channel) return;
    try {
      const prefs = await api('/api/communications/channels/' + encodeURIComponent(channel.id) + '/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pinned: elements.settingsPinned.checked,
          muted: elements.settingsMuted.checked,
          favorite: elements.settingsFavorite.checked
        })
      });
      const current = state.channels.find(item => item.id === channel.id);
      if (current) {
        current.pinned = prefs.pinned;
        current.muted = prefs.muted;
        current.favorite = prefs.favorite;
      }
      renderChannels();
      setFeedback('');
    } catch (error) {
      elements.settingsPinned.checked = Boolean(channel.pinned);
      elements.settingsMuted.checked = Boolean(channel.muted);
      elements.settingsFavorite.checked = Boolean(channel.favorite);
      setFeedback(error.message);
    }
  }

  async function clearChannelHistoryFromSettings() {
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    if (!channel) return;
    const confirmed = await window.StellaDialog.confirm({
      title: text('channels.clearHistory', '清空聊天记录'),
      message: text('channels.clearHistoryConfirm', '清空后你将不再看到这个频道的现有消息，其他成员不受影响，确认清空？'),
      confirmText: text('channels.clearHistory', '清空聊天记录'),
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      await api('/api/communications/channels/' + encodeURIComponent(channel.id) + '/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      elements.settingsDialog.close('cleared');
      elements.composerStatus.textContent = text('channels.clearHistoryDone', '聊天记录已清空');
      // 清空后整包刷新：频道摘要、未读与会话区（服务端已过滤）一并归零
      await loadBootstrap({ force: true, preserveConversation: true, anchorUnread: false, scrollBottom: true });
    } catch (error) {
      setFeedback(error.message);
    }
  }

  function setSettingsFeedback(message) {
    const line = document.getElementById('communicationsSettingsFeedback');
    if (line) line.textContent = message || '';
  }

  function setSettingsAvatarPreview(channel) {
    const preview = document.getElementById('communicationsSettingsAvatar');
    if (!preview) return;
    if (channel?.avatarUrl) {
      const image = document.createElement('img');
      image.src = channel.avatarUrl;
      image.alt = '';
      preview.replaceChildren(image);
      return;
    }
    preview.className = 'communications-settings-avatar communications-avatar-generated communications-avatar-' + (channel?.kind || 'custom');
    preview.replaceChildren(channelKindIcon(channel?.kind || 'custom'));
  }

  function setFeedback(message) {
    const line = document.getElementById('communicationsSettingsFeedback');
    if (line) line.textContent = message || '';
  }

  async function saveChannelSettings(event) {
    event.preventDefault();
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    if (!channel) return;
    // 开关已即时保存；此处只处理自建频道的名称/说明编辑（公告独立保存）
    if (!(channel.kind === 'custom' && canManageSelectedChannel())) {
      elements.settingsDialog.close('saved');
      return;
    }
    try {
      const updated = await api('/api/communications/channels/' + encodeURIComponent(channel.id) + '/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: elements.settingsName.value,
          description: elements.settingsDescription.value
        })
      });
      updateChannel(updated.channel);
      elements.settingsDialog.close('saved');
      renderChannels();
      renderConversationHeader();
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function saveChannelAnnouncement() {
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    if (!channel || !(channel.kind === 'custom' && canManageSelectedChannel())) return;
    try {
      const updated = await api('/api/communications/channels/' + encodeURIComponent(channel.id) + '/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: channel.name,
          description: channel.description,
          announcement: elements.settingsAnnouncement.value
        })
      });
      updateChannel(updated.channel);
      renderChannels();
      renderConversationHeader();
      setFeedback(text('channels.announcementSaved', '公告已保存'));
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function saveMyNickname() {
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    if (!channel || channel.kind !== 'custom') return;
    const value = elements.settingsNicknameInput.value.trim();
    if ((channel.myNickname || '') === value) return;
    try {
      const updated = await api('/api/communications/channels/' + encodeURIComponent(channel.id) + '/nickname', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: value })
      });
      updateChannel(updated.channel);
      renderChannels();
      renderSettingsInfo(updated.channel);
      renderSettingsMembers(updated.channel);
      setFeedback(text('channels.nicknameSaved', '群昵称已更新'));
    } catch (error) {
      elements.settingsNicknameInput.value = channel.myNickname || '';
      setFeedback(error.message);
    }
  }

  async function leaveChannelFromSettings() {
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    if (!channel) return;
    const confirmed = await window.StellaDialog.confirm({
      title: text('channels.leaveChannel', '退出频道'),
      message: text('channels.leaveChannelConfirm', '退出后将不再接收该频道的消息，如需再次加入请联系频道内成员，确认退出？'),
      confirmText: text('channels.leaveChannel', '退出频道'),
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      await api('/api/communications/channels/' + encodeURIComponent(channel.id) + '/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      elements.settingsDialog.close('left');
      elements.composerStatus.textContent = text('channels.leftChannel', '已退出频道');
      await loadBootstrap({ force: true, preserveConversation: false, anchorUnread: false, scrollBottom: true });
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function searchChannelHistory() {
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    if (!channel) return;
    const query = elements.settingsSearchInput.value.trim();
    if (!query) return;
    elements.settingsSearchBtn.disabled = true;
    try {
      const payload = await api(`/api/communications/channels/${encodeURIComponent(channel.id)}/search?q=${encodeURIComponent(query)}`, { force: true });
      renderSearchResults(payload.messages || [], query);
    } catch (error) {
      elements.settingsSearchResults.hidden = false;
      elements.settingsSearchResults.replaceChildren(node('li', 'communications-search-empty', error.message));
    } finally {
      elements.settingsSearchBtn.disabled = false;
    }
  }

  function renderSearchResults(messages, query) {
    elements.settingsSearchResults.hidden = false;
    const rows = [];
    if (!messages.length) {
      rows.push(node('li', 'communications-search-empty', text('channels.searchEmpty', '没有找到包含「{query}」的消息', { query })));
    }
    for (const message of messages) {
      const item = document.createElement('li');
      item.className = 'communications-search-result';
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => jumpToSearchedMessage(message));
      const head = document.createElement('span');
      head.className = 'communications-search-result-head';
      head.textContent = `${message.senderName || text('channels.unknownUser', '未知用户')} · ${formatMessageTime(message.createdAt)}`;
      const preview = document.createElement('span');
      preview.className = 'communications-search-result-preview';
      preview.textContent = messagePreviewForSearch(message, query);
      button.append(head, preview);
      if (message.recalled) item.classList.add('is-recalled');
      item.appendChild(button);
      rows.push(item);
    }
    elements.settingsSearchResults.replaceChildren(...rows);
  }

  function messagePreviewForSearch(message, query) {
    let body = message.content || '';
    if (message.kind === 'voice') body = message.media?.durationMs
      ? text('channels.voiceWithLength', '[语音 {duration}]', { duration: formatDuration(message.media.durationMs) })
      : text('channels.voiceTag', '[语音]');
    if (message.kind === 'image') body = text('channels.imageTag', '[图片]');
    if (message.kind === 'video') body = text('channels.videoTag', '[视频]');
    const clipped = body.length > 80 ? `${body.slice(0, 80)}…` : body;
    return query ? clipped.replaceAll(query, `「${query}」`) : clipped;
  }

  // 搜索结果点击：目标不在当前时间线时用 around 窗口整体换页（不推进已读），再滚动高亮
  async function jumpToSearchedMessage(message) {
    elements.settingsDialog.close('jump');
    if (state.selectedChannelId !== message.channelId) {
      await selectChannel(message.channelId);
    }
    if (state.selectedChannelId !== message.channelId) return;
    const existing = elements.messageList.querySelector(`[data-message-id="${message.id}"]`);
    if (!existing) {
      try {
        const payload = await api(`/api/communications/channels/${encodeURIComponent(message.channelId)}/messages?around=${message.id}&limit=30&markRead=0`, { force: true });
        applyConversation(payload, { scrollBottom: false });
      } catch (error) {
        elements.composerStatus.textContent = error.message;
        return;
      }
    }
    jumpToQuoted(message.id);
  }

  function resetSettingsSearch() {
    if (elements.settingsSearchInput) elements.settingsSearchInput.value = '';
    if (elements.settingsSearchResults) {
      elements.settingsSearchResults.hidden = true;
      elements.settingsSearchResults.replaceChildren();
    }
  }

  // ===== 表情栏（QQ 式分类面板，点击插入输入框光标处） =====
  const EMOJI_GROUPS = [
    { id: 'smileys', labelKey: 'channels.emojiGroupSmileys', label: '笑脸', emojis: ('😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷').split(' ') },
    { id: 'hands', labelKey: 'channels.emojiGroupHands', label: '手势', emojis: ('👍 👎 👌 ✌️ 🤞 🤟 🤘 👏 🙌 👐 🤝 🙏 💪 ✍️ 👋 🤙 👊 ✊ 🤛 🤜 ☝️ 👆 👇 👉 👈 ✋ 🖐️ 🖖 🫡 🫰').split(' ') },
    { id: 'hearts', labelKey: 'channels.emojiGroupHearts', label: '爱心', emojis: ('❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 💌 💋 👩‍❤️‍👨 🌹').split(' ') },
    { id: 'animals', labelKey: 'channels.emojiGroupAnimals', label: '动物', emojis: ('🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦅 🦉 🐺 🐴 🦄 🐝 🦋 🐢').split(' ') },
    { id: 'food', labelKey: 'channels.emojiGroupFood', label: '食物', emojis: ('🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥔 🥕 🌽 🌶️ 🍞 🧀 🍗 🍔 🍟 🍕 🌭').split(' ') },
    { id: 'activity', labelKey: 'channels.emojiGroupActivity', label: '活动', emojis: ('⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥅 🎯 🎮 🎲 🎯 🎤 🎧 🎬 🎮 🏆 🥇 🥈 🥉 🎖️ 🏅 🎫 🎪').split(' ') },
    { id: 'objects', labelKey: 'channels.emojiGroupObjects', label: '物品', emojis: ('⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 💾 💿 📷 📹 🎥 📞 ☎️ 📺 📻 ⏰ ⏳ 🔋 💡 🔦 📔 📚 📖 🔖 🧧 💰 💳 ✏️ 📌 📎').split(' ') },
    { id: 'symbols', labelKey: 'channels.emojiGroupSymbols', label: '符号', emojis: ('✅ ❌ ❓ ❗ ⭐ 🌟 ✨ ⚡ 🔥 💥 💯 ✳️ ❇️ ⚠️ 🚫 ⛔ 💤 🌀 🎵 🎶 ➕ ➖ ➗ ❕ ‼️ ⁉️ 🔔 🔕').split(' ') }
  ];
  let emojiActiveGroup = 0;
  let emojiPanelBuilt = false;

  function buildEmojiPanel() {
    if (emojiPanelBuilt) return;
    emojiPanelBuilt = true;
    const tabs = EMOJI_GROUPS.map((group, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'communications-emoji-tab';
      tab.textContent = group.emojis[0];
      tab.setAttribute('role', 'tab');
      tab.title = text(group.labelKey, group.label);
      tab.setAttribute('aria-label', text(group.labelKey, group.label));
      tab.addEventListener('click', () => showEmojiGroup(index));
      return tab;
    });
    elements.emojiTabs.replaceChildren(...tabs);
    showEmojiGroup(emojiActiveGroup);
  }

  function showEmojiGroup(index) {
    emojiActiveGroup = index;
    [...elements.emojiTabs.children].forEach((tab, tabIndex) => {
      tab.classList.toggle('is-active', tabIndex === index);
      tab.setAttribute('aria-selected', tabIndex === index ? 'true' : 'false');
    });
    const group = EMOJI_GROUPS[index];
    const buttons = group.emojis.map(emoji => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'communications-emoji-item';
      button.textContent = emoji;
      button.title = emoji;
      button.addEventListener('click', () => {
        insertComposerText(emoji);
        if (window.matchMedia('(pointer: coarse)').matches) return;
        elements.input.focus();
      });
      return button;
    });
    elements.emojiGrid.replaceChildren(...buttons);
  }

  function toggleEmojiPanel(force) {
    const show = typeof force === 'boolean' ? force : elements.emojiPanel.hidden;
    if (show) buildEmojiPanel();
    elements.emojiPanel.hidden = !show;
    elements.emojiButton.classList.toggle('is-active', show);
    elements.emojiButton.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) elements.input.focus();
  }

  function closeEmojiPanel() {
    if (elements.emojiPanel.hidden) return;
    elements.emojiPanel.hidden = true;
    elements.emojiButton.classList.remove('is-active');
    elements.emojiButton.setAttribute('aria-expanded', 'false');
  }

  // ===== 聊天背景（设备本地：预设渐变 + 自定义压缩图，存 localStorage） =====
  const BACKGROUND_STORAGE_PREFIX = 'stella.comm.bg.';
  const BACKGROUND_PRESETS = [
    { id: 'default', labelKey: 'channels.backgroundDefault', label: '默认', css: '' },
    { id: 'dawn', labelKey: 'channels.backgroundDawn', label: '晨曦', css: 'linear-gradient(160deg, #2b2440 0%, #4a3157 48%, #7d4a5b 100%)' },
    { id: 'ocean', labelKey: 'channels.backgroundOcean', label: '深海', css: 'linear-gradient(160deg, #0f2033 0%, #14324a 52%, #1d4f63 100%)' },
    { id: 'forest', labelKey: 'channels.backgroundForest', label: '松林', css: 'linear-gradient(160deg, #14231c 0%, #1d3a2a 52%, #2c5540 100%)' },
    { id: 'dusk', labelKey: 'channels.backgroundDusk', label: '暮色', css: 'linear-gradient(160deg, #241d2e 0%, #3a2d47 50%, #584a6b 100%)' },
    { id: 'ember', labelKey: 'channels.backgroundEmber', label: '余烬', css: 'linear-gradient(160deg, #2e1d1a 0%, #46261d 50%, #5e3a24 100%)' }
  ];

  function backgroundStorageKey(channelId) {
    return BACKGROUND_STORAGE_PREFIX + channelId;
  }

  function readStoredBackground(channelId) {
    try {
      const raw = window.localStorage.getItem(backgroundStorageKey(channelId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.type === 'preset' && BACKGROUND_PRESETS.some(preset => preset.id === parsed.id)) return parsed;
      if (parsed?.type === 'image' && typeof parsed.dataUrl === 'string') return parsed;
    } catch (error) {
      return null;
    }
    return null;
  }

  function storeBackground(channelId, value) {
    try {
      if (value) window.localStorage.setItem(backgroundStorageKey(channelId), JSON.stringify(value));
      else window.localStorage.removeItem(backgroundStorageKey(channelId));
      return true;
    } catch (error) {
      return false;
    }
  }

  // 应用当前频道背景到消息滚动区（selectChannel 与打开设置时都会调用）
  function applyChannelBackground(channelId) {
    const scroll = elements.messageScroll;
    if (!scroll) return;
    scroll.classList.remove('has-custom-background');
    scroll.style.backgroundImage = '';
    if (!channelId) return;
    const stored = readStoredBackground(channelId);
    if (!stored) return;
    if (stored.type === 'preset') {
      const preset = BACKGROUND_PRESETS.find(item => item.id === stored.id);
      if (preset?.css) scroll.style.backgroundImage = preset.css;
      return;
    }
    scroll.classList.add('has-custom-background');
    scroll.style.backgroundImage = `url("${stored.dataUrl.replace(/"/g, '%22')}")`;
  }

  function renderBackgroundSwatches(channel) {
    if (!elements.settingsBackgroundSwatches) return;
    const stored = readStoredBackground(channel.id);
    const swatches = BACKGROUND_PRESETS.map(preset => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'communications-background-swatch';
      button.dataset.presetId = preset.id;
      button.title = text(preset.labelKey, preset.label);
      button.setAttribute('aria-label', text(preset.labelKey, preset.label));
      const isActive = preset.id === 'default' ? !stored : stored?.type === 'preset' && stored.id === preset.id;
      button.classList.toggle('is-active', isActive);
      if (preset.css) button.style.backgroundImage = preset.css;
      button.addEventListener('click', () => {
        const saved = storeBackground(channel.id, preset.id === 'default' ? null : { type: 'preset', id: preset.id });
        if (!saved) {
          setFeedback(text('channels.backgroundStoreFailed', '背景保存失败，浏览器存储不可用'));
          return;
        }
        applyChannelBackground(channel.id);
        renderBackgroundSwatches(channel);
      });
      return button;
    });
    elements.settingsBackgroundSwatches.replaceChildren(...swatches);
  }

  async function uploadChannelBackground(file) {
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    if (!channel || !file) return;
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(text('channels.backgroundReadFailed', '读取图片失败')));
      reader.readAsDataURL(file);
    });
    let dataUrl = source;
    if (window.ImageCompress?.compress) {
      try {
        const compressed = await window.ImageCompress.compress(source, { maxEdge: 1280, quality: 0.75 });
        if (compressed?.dataUrl) dataUrl = compressed.dataUrl;
      } catch (error) {
        // 压缩失败时退回原图，交给存储上限兜底
      }
    }
    const saved = storeBackground(channel.id, { type: 'image', dataUrl });
    if (!saved) {
      setFeedback(text('channels.backgroundTooLarge', '图片过大，无法保存为聊天背景'));
      return;
    }
    applyChannelBackground(channel.id);
    renderBackgroundSwatches(channel);
    setFeedback(text('channels.backgroundSaved', '聊天背景已更新'));
  }

  async function uploadChannelAvatar(file) {
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    if (!channel || !file) return;
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
    try {
      let dataUrl = source;
      if (window.ImageCompress?.compress && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        let compressed = null;
        try {
          compressed = await window.ImageCompress.compress(source, { maxEdge: 256, quality: 0.85 });
        } catch (error) {
          compressed = null;
        }
        // The server caps channel avatars at 512KB; oversized uploads used to
        // fail only after the full transfer.
        if (compressed && compressed.bytes > 512 * 1024) {
          throw new Error(text('channels.avatarTooLarge', '频道头像过大，请更换图片'));
        }
        if (compressed) dataUrl = compressed.dataUrl;
      }
      const result = await api('/api/communications/channels/' + encodeURIComponent(channel.id) + '/avatar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl })
      });
      channel.avatarUrl = result.avatarUrl;
      setSettingsAvatarPreview(channel);
      renderChannels();
      renderConversationHeader();
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function removeChannelAvatar() {
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    if (!channel) return;
    try {
      const result = await api('/api/communications/channels/' + encodeURIComponent(channel.id) + '/avatar', { method: 'DELETE' });
      channel.avatarUrl = result.avatarUrl;
      setSettingsAvatarPreview(channel);
      renderChannels();
      renderConversationHeader();
    } catch (error) {
      setFeedback(error.message);
    }
  }

  function actionButton(action, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `communications-message-action ${action.className || ''}`.trim();
    if (Array.isArray(action.paths)) button.append(createSvg(action.paths));
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

  // 通用剪贴板：优先 Clipboard API，非安全上下文回退隐藏 textarea + execCommand
  async function copyTextToClipboard(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      try {
        const helper = document.createElement('textarea');
        helper.value = value;
        helper.className = 'visually-hidden';
        document.body.appendChild(helper);
        helper.select();
        const copied = document.execCommand('copy');
        helper.remove();
        return copied;
      } catch {
        return false;
      }
    }
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
    cancelQuoting();
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

  function startQuoting(message) {
    if (message.recalled) return;
    cancelEditing({ keepContent: true });
    state.quotedMessageId = message.id;
    elements.quoteLabel.textContent = `${text('channels.quoting', '正在引用')}：${message.sender?.displayName || text('channels.unknownUser', '未知用户')} · ${messageQuotedPreview(message)}`;
    elements.quoteMode.hidden = false;
    elements.input.focus();
  }

  function cancelQuoting() {
    state.quotedMessageId = null;
    elements.quoteMode.hidden = true;
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
      regular.push({
        key: 'quote',
        label: text('channels.quote', '引用'),
        paths: ['M13.5 12.8v-2.6a3.2 3.2 0 0 0-3.2-3.2H3.4', 'M6.6 3.9 3.3 6.9l3.3 3'],
        handler: () => startQuoting(message)
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
    if (message.media && !message.recalled) {
      management.push({
        key: 'download',
        label: text('channels.download', '下载'),
        paths: ['M8 2.4v7.4', 'M4.9 6.6 8 9.7l3.1-3.1', 'M2.6 10.9v1.6a1.1 1.1 0 0 0 1.1 1.1h8.6a1.1 1.1 0 0 0 1.1-1.1v-1.6'],
        handler: () => downloadMessageMedia(message)
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

  function setVoiceButtonGlyph(button, playing) {
    button.replaceChildren(createSvg(playing
      ? ['M5.2 3.6v8.8', 'M10.8 3.6v8.8']
      : ['M5.6 3.4l7 4.6-7 4.6z']));
  }

  function stopVoicePlayback() {
    if (!voicePlayback.audio) return;
    voicePlayback.audio.pause();
    voicePlayback.audio = null;
    const root = elements.messageList.querySelector(
      `[data-message-id="${voicePlayback.messageId}"] .communications-voice`);
    if (root) {
      root.classList.remove('is-playing');
      const button = root.querySelector('.communications-voice-button');
      if (button) setVoiceButtonGlyph(button, false);
      const fill = root.querySelector('.communications-voice-track span');
      if (fill) fill.style.width = '0%';
    }
    voicePlayback.messageId = null;
  }

  function createVoiceControl(message) {
    const root = node('div', 'communications-voice');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'communications-voice-button';
    button.setAttribute('aria-label', text('channels.playVoice', '播放语音'));
    setVoiceButtonGlyph(button, false);
    const track = node('div', 'communications-voice-track');
    const fill = document.createElement('span');
    track.appendChild(fill);
    const time = node('span', 'communications-voice-time', formatDuration(message.media.durationMs || 0));
    root.append(button, track, time);
    button.addEventListener('click', () => toggleVoicePlayback(message, root, button, fill));
    return root;
  }

  function toggleVoicePlayback(message, root, button, fill) {
    if (voicePlayback.messageId === message.id && voicePlayback.audio) {
      if (voicePlayback.audio.paused) voicePlayback.audio.play().catch(() => {});
      else voicePlayback.audio.pause();
      return;
    }
    stopVoicePlayback();
    const audio = new Audio(message.media.url);
    voicePlayback.audio = audio;
    voicePlayback.messageId = message.id;
    audio.addEventListener('timeupdate', () => {
      const totalMs = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration * 1000 : (message.media.durationMs || 1);
      fill.style.width = `${Math.min(100, (audio.currentTime * 1000 / totalMs) * 100).toFixed(1)}%`;
    });
    audio.addEventListener('play', () => {
      root.classList.add('is-playing');
      setVoiceButtonGlyph(button, true);
    });
    audio.addEventListener('pause', () => {
      root.classList.remove('is-playing');
      setVoiceButtonGlyph(button, false);
    });
    audio.addEventListener('ended', () => {
      fill.style.width = '0%';
      stopVoicePlayback();
    });
    audio.play().catch(() => {});
  }

  function mediaFileExtension(mime) {
    return ({
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
      'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
      'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg'
    })[mime] || 'bin';
  }

  async function downloadMessageMedia(message) {
    if (!message.media) return;
    try {
      const response = await fetch(message.media.url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `communication-${message.id}.${mediaFileExtension(message.media.mime)}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (error) {
      elements.composerStatus.textContent = text('channels.downloadFailed', '下载失败：{error}', { error: error.message });
    }
  }

  function jumpToQuoted(messageId) {
    const row = elements.messageList.querySelector(`[data-message-id="${messageId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('is-context-target');
    window.setTimeout(() => row.classList.remove('is-context-target'), 1200);
  }

  function renderQuotedBlock(bubble, message) {
    if (!message.quoted) return;
    if (message.recalled && !message.developerRecallVisible) return;
    const block = document.createElement('div');
    block.className = `communications-quoted${message.quoted.recalled ? ' is-recalled' : ''}`;
    block.title = text('channels.jumpToQuoted', '定位到原消息');
    const sender = document.createElement('strong');
    sender.textContent = message.quoted.unavailable
      ? text('channels.quotedUnavailable', '原消息不可见')
      : (message.quoted.senderName || text('channels.unknownUser', '未知用户'));
    const preview = document.createElement('span');
    preview.textContent = message.quoted.unavailable
      ? text('channels.quotedUnavailable', '原消息不可见')
      : messageQuotedPreview(message.quoted);
    block.append(sender, preview);
    block.addEventListener('click', () => jumpToQuoted(message.quoted.id));
    bubble.appendChild(block);
  }

  function renderMediaContent(bubble, message) {
    const media = message.media;
    if (!media) return false;
    if (message.kind === 'voice') {
      bubble.appendChild(createVoiceControl(message));
      return true;
    }
    const frame = document.createElement(message.kind === 'image' ? 'button' : 'div');
    frame.className = 'communications-media-frame';
    if (message.kind === 'image') {
      frame.type = 'button';
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = media.thumbUrl || media.url;
      image.alt = text('channels.imageLabel', '图片消息');
      frame.appendChild(image);
      frame.addEventListener('click', () => openLightbox(message));
    } else {
      const video = document.createElement('video');
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.src = media.url;
      if (media.thumbUrl) video.poster = media.thumbUrl;
      frame.appendChild(video);
      if (media.durationMs) {
        const badge = node('span', 'communications-media-badge is-duration', formatDuration(media.durationMs));
        frame.appendChild(badge);
      }
    }
    if (media.original) {
      frame.appendChild(node('span', 'communications-media-badge is-original', text('channels.originalBadge', '原图')));
    }
    bubble.appendChild(frame);
    return true;
  }

  function openLightbox(message) {
    if (!message.media?.url) return;
    state.lightboxMessageId = message.id;
    elements.lightboxImage.src = message.media.url;
    elements.lightboxImage.alt = text('channels.imageLabel', '图片消息');
    elements.lightboxCaption.textContent = `${message.sender?.displayName || ''} · ${formatFullTime(message.createdAt)}`;
    if (!elements.lightbox.open) elements.lightbox.showModal();
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
      renderQuotedBlock(bubble, message);
      if (!renderMediaContent(bubble, message)) {
        const content = document.createElement('span');
        content.className = 'communications-message-content';
        const mentionPattern = /(^|\s)(@[^\s@，。！？；：、]+)/g;
        String(message.content || '').split(mentionPattern).forEach(part => {
          if (!part) return;
          if (part.startsWith('@') && part.length > 1) {
            const mention = document.createElement('span');
            mention.className = 'communications-mention';
            mention.textContent = part;
            content.appendChild(mention);
          } else {
            content.appendChild(document.createTextNode(part));
          }
        });
        bubble.appendChild(content);
      }
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
    attachLongPress(row, point => {
      openContextMenu(message, row, point, { trigger: row, keyboard: false });
    });
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
    document.querySelector('.communications-channel-row.is-context-target')?.classList.remove('is-context-target');
    state.contextMenuMessageId = null;
    state.contextMenuTrigger = null;
    state.contextMenuKeyboardOpened = false;
    state.channelMenuTargetId = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }

  function canExportChannelHistory() {
    return state.activeIdentityKey === 'developer' || state.activeIdentityKey === 'administrator';
  }

  async function exportChannelHistory(channel, mode = 'raw') {
    closeContextMenu();
    elements.composerStatus.textContent = text('channels.exportStarted', '正在生成导出文件…');
    const endpoint = mode === 'digest' ? 'export-text' : 'export';
    try {
      const response = await fetch(
        `/api/communications/channels/${encodeURIComponent(channel.id)}/${endpoint}`, { credentials: 'same-origin' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || String(response.status));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      anchor.download = mode === 'digest'
        ? `聊天记录-${channel.name.replace(/[\\/:*?"<>|\s]+/g, '-')}-${stamp}.txt`
        : `原始记录-${channel.name.replace(/[\\/:*?"<>|\s]+/g, '-')}-${stamp}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      elements.composerStatus.textContent = '';
    } catch (error) {
      elements.composerStatus.textContent = text('channels.exportFailed', '导出失败：{error}', { error: error.message });
    }
  }

  function openChannelMenu(channel, row, point) {
    closeContextMenu();
    row.classList.add('is-context-target');
    state.channelMenuTargetId = channel.id;
    const togglePin = {
      key: 'pin',
      label: text('channels.pinLabel', '置顶'),
      handler: () => toggleChannelPref(channel, 'pinned')
    };
    const toggleMute = {
      key: 'mute',
      label: text('channels.muteLabel', '免打扰'),
      handler: () => toggleChannelPref(channel, 'muted')
    };
    const markRead = {
      key: 'read',
      label: text('channels.markRead', '标记为已读'),
      handler: () => markChannelReadFromMenu(channel)
    };
    const settings = {
      key: 'settings',
      label: text('channels.settingsTitle', '频道设置'),
      handler: () => openChannelSettings()
    };
    const items = [
      actionButton(togglePin, { contextMenu: true }),
      actionButton(toggleMute, { contextMenu: true }),
      actionButton(markRead, { contextMenu: true }),
      actionButton(settings, { contextMenu: true })
    ];
    if (canExportChannelHistory()) {
      items.push(actionButton({
        key: 'export-digest',
        label: text('channels.exportHistory', '导出聊天记录'),
        handler: () => exportChannelHistory(channel, 'digest')
      }, { contextMenu: true }));
      items.push(actionButton({
        key: 'export-raw',
        label: text('channels.exportRaw', '导出原始记录'),
        handler: () => exportChannelHistory(channel, 'raw')
      }, { contextMenu: true }));
    }
    elements.contextMenu.append(...items);
    elements.contextMenu.hidden = false;
    positionContextMenu(point.x, point.y);
    requestAnimationFrame(() => contextMenuItems()[0]?.focus({ preventScroll: true }));
  }

  async function toggleChannelPref(channel, field) {
    closeContextMenu();
    try {
      const next = {};
      next[field] = !channel[field];
      const result = await api('/api/communications/channels/' + encodeURIComponent(channel.id) + '/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next)
      });
      const current = state.channels.find(item => item.id === channel.id);
      if (current) {
        current.pinned = result.pinned;
        current.muted = result.muted;
      }
      renderChannels();
    } catch (error) {
      await window.StellaDialog?.alert?.({ title: text('channels.prefFailed', '设置失败'), message: error.message, tone: 'danger' });
    }
  }

  async function markChannelReadFromMenu(channel) {
    closeContextMenu();
    try {
      await api('/api/communications/channels/' + encodeURIComponent(channel.id) + '/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const current = state.channels.find(item => item.id === channel.id);
      if (current) {
        current.unreadCount = 0;
        renderChannels();
      }
    } catch (error) {
      await window.StellaDialog?.alert?.({ title: text('channels.prefFailed', '设置失败'), message: error.message, tone: 'danger' });
    }
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
    setMobileView('conversation');
    state.selectedChannelId = channelId;
    state.messages = [];
    state.hasMore = false;
    state.hasNewer = false;
    state.firstUnreadMessageId = null;
    cancelEditing();
    cancelQuoting();
    clearPendingFiles();
    stopVoicePlayback();
    closeEmojiPanel();
    applyChannelBackground(channelId);
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
    state.activeIdentityKey = payload.activeIdentityKey || '';
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

  function appendSentMessage(message, channelId) {
    if (channelId !== state.selectedChannelId || state.messages.some(item => item.id === message.id)) return;
    state.messages.push(message);
    const channel = state.channels.find(item => item.id === channelId);
    if (channel) {
      channel.lastMessage = message;
      channel.unreadCount = 0;
      channel.updatedAt = message.createdAt;
    }
    renderChannels();
    renderMessages();
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
        body: JSON.stringify(editingMessage
          ? { content }
          : { content, quotedMessageId: state.quotedMessageId || undefined })
      });
      if (editingMessage) {
        replaceMessage(payload.message);
      } else {
        appendSentMessage(payload.message, channelId);
        cancelQuoting();
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

  // ===== 媒体消息：待发预览条、图片压缩、视频封面帧、二进制上传 =====
  const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
  const MEDIA_SIZE_LIMITS = { image: 20 * 1024 * 1024, video: 20 * 1024 * 1024 };

  function formatBytesLimit(bytes) {
    return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))}MB` : `${Math.round(bytes / 1024)}KB`;
  }

  function loadImageElement(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image decode failed'));
      image.src = dataUrl;
    });
  }

  function dataUrlBytes(dataUrl) {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(base64.length * 0.75) - padding);
  }

  async function compressImage(dataUrl, maxEdge, quality) {
    const image = await loadImageElement(dataUrl);
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight, 1));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    context.drawImage(image, 0, 0, width, height);
    const encoded = canvas.toDataURL('image/webp', quality);
    return {
      dataUrl: encoded,
      width,
      height,
      bytes: dataUrlBytes(encoded),
      mime: encoded.startsWith('data:image/webp') ? 'image/webp' : 'image/png'
    };
  }

  function captureVideoPoster(file) {
    return new Promise(resolve => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      let settled = false;
      const done = result => {
        if (settled) return;
        settled = true;
        video.removeAttribute('src');
        try { video.load(); } catch {}
        resolve(result);
      };
      const failTimer = window.setTimeout(() => done(null), 5000);
      video.addEventListener('loadeddata', () => {
        try {
          video.currentTime = Math.min(0.2, (video.duration || 1) / 10);
        } catch {
          window.clearTimeout(failTimer);
          done(null);
        }
      });
      video.addEventListener('seeked', () => {
        window.clearTimeout(failTimer);
        try {
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 640 / Math.max(video.videoWidth || 640, 1));
          canvas.width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
          canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/webp', 0.7);
          done(dataUrl.startsWith('data:image/webp')
            ? { dataUrl, width: canvas.width, height: canvas.height }
            : null);
        } catch {
          done(null);
        }
      });
      video.addEventListener('error', () => {
        window.clearTimeout(failTimer);
        done(null);
      });
      video.src = URL.createObjectURL(file);
    });
  }

  function renderPreviewBar() {
    elements.previewList.replaceChildren();
    for (const file of state.pendingFiles) {
      const item = document.createElement('span');
      item.className = 'communications-preview-item';
      if (file.kind === 'image' && file.previewUrl) {
        const image = document.createElement('img');
        image.src = file.previewUrl;
        image.alt = '';
        item.appendChild(image);
      } else {
        item.innerHTML = file.kind === 'video'
          ? '<svg viewBox="0 0 24 24" data-icon="video" aria-hidden="true"></svg>'
          : '<svg viewBox="0 0 24 24" data-icon="mic" aria-hidden="true"></svg>';
      }
      item.appendChild(node('span', '', file.label));
      elements.previewList.appendChild(item);
    }
    elements.previewOriginal.parentElement.hidden = !state.pendingFiles.some(file => file.kind === 'image');
    elements.composerPreview.hidden = !state.pendingFiles.length;
    elements.previewSend.disabled = state.sendingMedia;
  }

  function clearPendingFiles() {
    state.pendingFiles = [];
    renderPreviewBar();
  }

  function setPendingFiles(files) {
    const accepted = [];
    for (const file of files) {
      const mime = String(file.type || '').toLowerCase();
      const kind = IMAGE_MIMES.has(mime) ? 'image' : VIDEO_MIMES.has(mime) ? 'video' : null;
      if (!kind) {
        elements.composerStatus.textContent = text('channels.fileUnsupported', '{name} 不是支持的图片或视频格式', { name: file.name });
        continue;
      }
      if (file.size > MEDIA_SIZE_LIMITS[kind]) {
        elements.composerStatus.textContent = text('channels.fileTooLarge', '{name} 超过 {limit}，已跳过', {
          name: file.name, limit: formatBytesLimit(MEDIA_SIZE_LIMITS[kind])
        });
        continue;
      }
      accepted.push({ file, kind, label: file.name, previewUrl: null, sourceDataUrl: null });
    }
    if (accepted.length) {
      state.pendingFiles = state.pendingFiles.concat(accepted);
      renderPreviewBar();
      elements.composerStatus.textContent = '';
      for (const entry of state.pendingFiles) {
        if (entry.kind !== 'image' || entry.previewUrl) continue;
        const reader = new FileReader();
        reader.onload = () => {
          entry.previewUrl = String(reader.result);
          renderPreviewBar();
        };
        reader.readAsDataURL(entry.file);
      }
    }
  }

  function buildMediaQuery(params) {
    const query = new URLSearchParams({ kind: params.kind });
    if (params.thumb) {
      query.set('thumbBytes', String(params.thumb.bytes));
      query.set('thumbMime', params.thumb.mime);
      if (params.thumb.width) {
        query.set('thumbWidth', String(params.thumb.width));
        query.set('thumbHeight', String(params.thumb.height));
      }
    }
    if (params.durationMs) query.set('durationMs', String(params.durationMs));
    if (params.width) {
      query.set('width', String(params.width));
      query.set('height', String(params.height));
    }
    if (params.original) query.set('original', '1');
    if (state.quotedMessageId) query.set('quotedMessageId', String(state.quotedMessageId));
    return query.toString();
  }

  function concatBuffers(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      merged.set(new Uint8Array(part), offset);
      offset += part.length;
    }
    return merged;
  }

  async function postMediaMessage(entry, options = {}) {
    const channelId = state.selectedChannelId;
    if (!channelId) throw new Error(text('channels.selectChannel', '选择频道'));
    const mainBuffer = new Uint8Array(await entry.file.arrayBuffer());
    const parts = [];
    let params = { kind: entry.kind };
    if (options.thumb) {
      parts.push(new Uint8Array(await (await fetch(options.thumb.dataUrl)).arrayBuffer()));
      params = {
        ...params,
        thumb: { bytes: options.thumb.bytes, mime: options.thumb.mime, width: options.thumb.width, height: options.thumb.height }
      };
    }
    parts.push(mainBuffer);
    params = {
      ...params,
      width: options.width,
      height: options.height,
      durationMs: options.durationMs,
      original: options.original
    };
    const response = await fetch(
      `/api/communications/channels/${encodeURIComponent(channelId)}/media?${buildMediaQuery(params)}`, {
        method: 'POST',
        headers: { 'Content-Type': entry.file.type },
        body: concatBuffers(parts),
        credentials: 'same-origin'
      });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || text('channels.sendFailed', '发送失败：{error}', { error: response.status }));
    appendSentMessage(payload.message, channelId);
    cancelQuoting();
  }

  async function sendPendingFiles() {
    if (state.sendingMedia || !state.pendingFiles.length || !state.selectedChannelId) return;
    state.sendingMedia = true;
    elements.previewSend.disabled = true;
    const isOriginal = elements.previewOriginal.checked;
    try {
      for (const entry of state.pendingFiles) {
        if (entry.kind === 'image') {
          // previewUrl 即同一文件的 dataURL（预览时已读取），直接复用
          entry.sourceDataUrl = entry.previewUrl;
          const thumb = await compressImage(entry.sourceDataUrl, 640, 0.8);
          if (thumb.bytes > 2 * 1024 * 1024) throw new Error(text('channels.fileTooLarge', '{name} 超过 {limit}，已跳过', { name: entry.file.name, limit: '2MB' }));
          let options;
          if (isOriginal) {
            options = { thumb };
          } else {
            const main = await compressImage(entry.sourceDataUrl, 1600, 0.85);
            if (main.bytes > 4 * 1024 * 1024) throw new Error(text('channels.fileTooLarge', '{name} 超过 {limit}，已跳过', { name: entry.file.name, limit: '4MB' }));
            options = { thumb, width: main.width, height: main.height };
            // 压缩档：主图字节来自压缩后的 WebP，替换待发文件
            const compressedBlob = await (await fetch(main.dataUrl)).blob();
            entry.file = new File([compressedBlob], `image-${Date.now()}.webp`, { type: main.mime });
          }
          await postMediaMessage(entry, options);
        } else {
          const poster = await captureVideoPoster(entry.file);
          const duration = await new Promise(resolve => {
            const probe = document.createElement('video');
            probe.preload = 'metadata';
            probe.addEventListener('loadedmetadata', () => {
              resolve(Number.isFinite(probe.duration) ? Math.round(probe.duration * 1000) : null);
              probe.removeAttribute('src');
            });
            probe.addEventListener('error', () => resolve(null));
            probe.src = URL.createObjectURL(entry.file);
            window.setTimeout(() => resolve(null), 4000);
          });
          const options = {};
          if (poster) {
            options.thumb = {
              dataUrl: poster.dataUrl,
              bytes: dataUrlBytes(poster.dataUrl),
              mime: 'image/webp',
              width: poster.width,
              height: poster.height
            };
          }
          if (duration && duration > 0) options.durationMs = Math.min(duration, 600000);
          await postMediaMessage(entry, options);
        }
      }
      clearPendingFiles();
      elements.composerStatus.textContent = '';
    } catch (error) {
      elements.composerStatus.textContent = text('channels.sendFailedMedia', '媒体发送失败：{error}', { error: error.message });
    } finally {
      state.sendingMedia = false;
      renderPreviewBar();
    }
  }

  // ===== 语音：按住说话（触屏）/ 点击开始-结束（桌面），上滑取消 =====
  function updateRecorderUi() {
    if (!voiceRecording.active) return;
    const elapsed = Date.now() - voiceRecording.startedAt;
    elements.recorderTime.textContent = formatDuration(elapsed);
    elements.recorderHint.textContent = voiceRecording.cancelZone
      ? text('channels.releaseToCancel', '松开取消发送')
      : (voiceRecording.desktop
        ? text('channels.recordTapToStop', '点击结束并发送')
        : text('channels.slideToCancel', '松开前上滑取消'));
    elements.recorder.classList.toggle('is-cancel', voiceRecording.cancelZone);
  }

  async function startRecording(event) {
    if (voiceRecording.active || !state.selectedChannelId) return;
    if (!window.isSecureContext) {
      elements.composerStatus.textContent = text('channels.recordInsecure', '当前环境不支持录音（需要 HTTPS 或本机访问）');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      elements.composerStatus.textContent = text('channels.recordFailed', '无法访问麦克风，请检查系统权限');
      return;
    }
    cancelEditing();
    cancelQuoting();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      elements.composerStatus.textContent = text('channels.recordFailed', '无法访问麦克风，请检查系统权限');
      return;
    }
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = candidates.find(type => MediaRecorder.isTypeSupported?.(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    voiceRecording.active = true;
    voiceRecording.stream = stream;
    voiceRecording.recorder = recorder;
    voiceRecording.chunks = [];
    voiceRecording.startedAt = Date.now();
    voiceRecording.cancelZone = false;
    voiceRecording.desktop = event?.pointerType === 'mouse';
    voiceRecording.pointerId = event?.pointerId ?? null;
    recorder.ondataavailable = progressEvent => {
      if (progressEvent.data?.size) voiceRecording.chunks.push(progressEvent.data);
    };
    recorder.start(250);
    elements.recorder.hidden = false;
    elements.recorder.classList.remove('is-cancel');
    updateRecorderUi();
    voiceRecording.timer = window.setInterval(updateRecorderUi, 200);
    // 60 秒自动结束并发送
    voiceRecording.autoStop = window.setTimeout(() => stopRecording(true), 60_000);
  }

  async function stopRecording(send) {
    if (!voiceRecording.active) return;
    const elapsed = Date.now() - voiceRecording.startedAt;
    const { recorder, stream, chunks, cancelZone } = voiceRecording;
    window.clearInterval(voiceRecording.timer);
    window.clearTimeout(voiceRecording.autoStop);
    voiceRecording.active = false;
    elements.recorder.hidden = true;
    const cleanup = () => {
      stream.getTracks().forEach(track => track.stop());
      voiceRecording.stream = null;
      voiceRecording.recorder = null;
      voiceRecording.chunks = [];
    };
    if (!send || cancelZone || elapsed < 1000 || !chunks.length) {
      try { recorder.stop(); } catch {}
      cleanup();
      if (send && !cancelZone && elapsed < 1000) {
        elements.composerStatus.textContent = text('channels.recordTooShort', '录音时间太短，已取消');
      }
      return;
    }
    const finished = new Promise(resolve => {
      recorder.onstop = resolve;
      try { recorder.stop(); } catch { resolve(); }
    });
    await finished;
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    cleanup();
    const mime = String(blob.type || 'audio/webm').split(';')[0].toLowerCase();
    const file = new File([blob], `voice-${Date.now()}.${mime === 'audio/mp4' ? 'm4a' : 'webm'}`, { type: mime });
    elements.composerStatus.textContent = '';
    try {
      await postMediaMessage(
        { file, kind: 'voice', label: file.name },
        { durationMs: Math.min(Math.max(Math.round(elapsed), 1), 60000) }
      );
    } catch (error) {
      elements.composerStatus.textContent = text('channels.sendFailedMedia', '媒体发送失败：{error}', { error: error.message });
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

  // ===== 加急非阻塞弹窗：页内直达提醒（点背景关闭，弹出后 0.5s 内吸收背景操作防误触） =====
  function urgentModalPreview(message) {
    if (message.recalled) return text('channels.quotedMessageRecalled', '原消息已撤回');
    if (message.kind && message.kind !== 'text') {
      const duration = message.kind === 'voice' && message.media?.durationMs
        ? ` ${formatDuration(message.media.durationMs)}` : '';
      return `${message.content}${duration}`;
    }
    return codePoints(String(message.content || '').replace(/\s+/g, ' ')).slice(0, 120).join('');
  }

  function showUrgentModal(message) {
    const channel = state.channels.find(item => item.id === message.channelId);
    elements.urgentMeta.textContent = text('channels.urgentModalMeta', '{name} 在 {channel} 发出加急', {
      name: message.sender?.displayName || text('channels.unknownUser', '未知用户'),
      channel: channel?.name || message.channelId
    });
    elements.urgentPreview.textContent = urgentModalPreview(message);
    elements.urgentTime.dateTime = new Date(Number(message.createdAt)).toISOString();
    elements.urgentTime.textContent = formatMessageTime(message.createdAt);
    state.urgentMessage = message;
    elements.urgentOverlay.hidden = false;
    elements.urgentOverlay.classList.add('is-blocking');
    clearTimeout(state.urgentGraceTimer);
    state.urgentGraceTimer = window.setTimeout(
      () => elements.urgentOverlay.classList.remove('is-blocking'), 500);
  }

  function closeUrgentModal() {
    if (elements.urgentOverlay.hidden) return;
    elements.urgentOverlay.hidden = true;
    elements.urgentOverlay.classList.remove('is-blocking');
    clearTimeout(state.urgentGraceTimer);
    state.urgentMessage = null;
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
      // 加急事件无论来自哪个频道都要取回消息内容用于页内弹窗
      const currentEvents = events.filter(item => item.messageId
        && (item.channelId === state.selectedChannelId || item.type === 'message-urgent'));
      let changed = false;
      let announcedMessage = null;
      let urgentModalCandidate = null;
      for (const currentEvent of currentEvents) {
        if (currentEvent.type === 'message-deleted') {
          const next = state.messages.filter(message => message.id !== currentEvent.messageId);
          changed ||= next.length !== state.messages.length;
          state.messages = next;
          continue;
        }
        try {
          const payload = await api(`/api/communications/channels/${encodeURIComponent(currentEvent.channelId)}/messages?before=${Number(currentEvent.messageId) + 1}&limit=1&markRead=0`, { force: true });
          const affectsSelected = currentEvent.channelId === state.selectedChannelId;
          if (!affectsSelected && currentEvent.type !== 'message-urgent') continue;
          const message = payload.messages.find(item => item.id === currentEvent.messageId);
          if (!message) continue;
          if (affectsSelected) {
            const index = state.messages.findIndex(item => item.id === message.id);
            if (index >= 0) state.messages[index] = message;
            else state.messages.push(message);
            state.messages.sort((left, right) => left.id - right.id);
            changed = true;
          }
          if (currentEvent.type === 'message') announcedMessage = message;
          if (currentEvent.type === 'message-urgent' && message.urgent && !message.mine) {
            urgentModalCandidate = message;
          }
        } catch {}
      }
      if (changed) {
        renderMessages({ preservePosition: !nearBottom, scrollBottom: nearBottom });
        if (nearBottom) await markCurrentRead();
      }
      if (announcedMessage) announceMessage(announcedMessage);
      if (urgentModalCandidate) showUrgentModal(urgentModalCandidate);
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
    let everErrored = false;
    source.onopen = () => {
      setLiveState('live');
      if (!everErrored) return;
      everErrored = false;
      // 断线重连后全量补拉，弥合窗口期错过的消息
      loadBootstrap({ force: true, preserveConversation: true, preservePosition: true, scrollBottom: false }).catch(() => {});
    };
    source.onerror = () => {
      everErrored = true;
      setLiveState('error');
    };
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
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !coarsePointer.matches) {
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
    // 触屏长按已由自定义计时器打开菜单，短窗内吞掉原生 contextmenu（Android 双触发）
    if (longPressJustFired(700)) return;
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
  elements.quoteCancel.addEventListener('click', () => cancelQuoting());
  // 移动端返回：会话视图 → 频道列表视图
  elements.back.addEventListener('click', () => {
    setMobileView('list');
  });
  // 媒体选择与待发预览条
  elements.media.addEventListener('click', () => elements.mediaInput.click());
  elements.mediaInput.addEventListener('change', () => {
    const files = [...(elements.mediaInput.files || [])];
    elements.mediaInput.value = '';
    if (files.length) setPendingFiles(files);
  });
  elements.previewCancel.addEventListener('click', clearPendingFiles);
  elements.previewSend.addEventListener('click', sendPendingFiles);
  elements.previewOriginal.addEventListener('change', renderPreviewBar);
  // 麦克风：触屏按住说话（松手发送、上滑取消），桌面点击开始/再点结束
  elements.voice.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    elements.voice.setPointerCapture?.(event.pointerId);
    startRecording(event);
  });
  elements.voice.addEventListener('pointermove', event => {
    if (!voiceRecording.active || voiceRecording.desktop) return;
    const rect = elements.voice.getBoundingClientRect();
    voiceRecording.cancelZone = event.clientY < rect.top - 60;
    updateRecorderUi();
  });
  elements.voice.addEventListener('pointerup', event => {
    if (voiceRecording.desktop || voiceRecording.pointerId !== event.pointerId) return;
    const discard = voiceRecording.cancelZone;
    voiceRecording.cancelZone = false;
    stopRecording(!discard);
  });
  elements.voice.addEventListener('pointercancel', () => {
    if (voiceRecording.desktop) return;
    voiceRecording.cancelZone = false;
    stopRecording(false);
  });
  elements.voice.addEventListener('click', event => {
    event.preventDefault();
    if (!voiceRecording.active) startRecording(event);
    else stopRecording(true);
  });
  // Lightbox：关闭与下载原图
  elements.lightboxClose.addEventListener('click', () => elements.lightbox.close());
  elements.lightbox.addEventListener('click', event => {
    if (event.target === elements.lightbox) elements.lightbox.close();
  });
  elements.lightbox.addEventListener('close', () => {
    elements.lightboxImage.removeAttribute('src');
    state.lightboxMessageId = null;
  });
  elements.lightboxDownload.addEventListener('click', () => {
    const message = state.messages.find(item => item.id === state.lightboxMessageId);
    if (message) downloadMessageMedia(message);
  });
  // 加急弹窗：背景点击关闭（弹出后 0.5s 内吸收点击防误触），"查看消息"跳转对应频道
  elements.urgentClose.addEventListener('click', closeUrgentModal);
  elements.urgentView.addEventListener('click', () => {
    const message = state.urgentMessage;
    closeUrgentModal();
    if (message?.channelId) {
      setMobileView('conversation');
      selectChannel(message.channelId);
    }
  });
  elements.urgentOverlay.addEventListener('pointerdown', event => {
    if (event.target !== elements.urgentOverlay) return;
    if (elements.urgentOverlay.classList.contains('is-blocking')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    closeUrgentModal();
  });
  // 移动端视口适配：顶栏实际高度（可能换行、含安全区）无法用固定魔法数表达，
  // 移动端激活时始终按「视觉视口底部 − 页面顶部实测位置」精确钳制页面高度，
  // 输入栏因此永远留在屏内；键盘弹出时 visualViewport 收缩，同一逻辑自动跟随
  // （Android Chrome 有 interactive-widget=resizes-content，此处同时兜 iOS Safari）。
  if (window.visualViewport) {
    let lastClampedHeight = 0;
    const syncViewport = () => {
      const viewport = window.visualViewport;
      if (!isMobileLayout() || !state.active || document.hidden) {
        if (lastClampedHeight) {
          lastClampedHeight = 0;
          elements.page.style.height = '';
        }
        return;
      }
      const pageTop = elements.page.getBoundingClientRect().top;
      const viewportBottom = viewport.offsetTop + viewport.height;
      const available = Math.floor(viewportBottom - pageTop - 4);
      if (available >= 320 && Math.abs(available - lastClampedHeight) > 1) {
        const shrinking = available < lastClampedHeight;
        lastClampedHeight = available;
        elements.page.style.height = `${available}px`;
        // 高度收缩（键盘弹出、转屏）时保持贴底；放宽时不动，避免打断回看历史
        if (shrinking) {
          const distanceToBottom = elements.messageScroll.scrollHeight
            - elements.messageScroll.scrollTop - elements.messageScroll.clientHeight;
          if (distanceToBottom < 240) elements.messageScroll.scrollTop = elements.messageScroll.scrollHeight;
        }
      }
    };
    window.visualViewport.addEventListener('resize', syncViewport);
    window.visualViewport.addEventListener('scroll', syncViewport);
    window.addEventListener('orientationchange', syncViewport);
    window.addEventListener('resize', syncViewport);
    // 从后台切回前台（后台页面 rAF 与视口事件被冻结，回前台必须重钳一次）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncViewport();
    });
    elements.syncViewport = syncViewport;
  }
  elements.channelList.addEventListener('contextmenu', event => {
    const row = event.target instanceof Element ? event.target.closest('.communications-channel-row') : null;
    if (!row) return;
    event.preventDefault();
    if (longPressJustFired(700)) return;
    const channel = state.channels.find(item => item.id === row.dataset.channelId);
    if (!channel) return;
    openChannelMenu(channel, row, { x: event.clientX, y: event.clientY });
  });
  elements.channelSearch.addEventListener('input', () => {
    state.channelQuery = elements.channelSearch.value;
    renderChannels();
  });
  elements.settingsOpen.addEventListener('click', () => openChannelSettings());
  elements.settingsPinned.addEventListener('change', saveChannelPrefsInstant);
  elements.settingsMuted.addEventListener('change', saveChannelPrefsInstant);
  elements.settingsFavorite.addEventListener('change', saveChannelPrefsInstant);
  elements.settingsClear.addEventListener('click', clearChannelHistoryFromSettings);
  elements.settingsClose.addEventListener('click', () => elements.settingsDialog.close());
  elements.settingsCancel.addEventListener('click', () => elements.settingsDialog.close());
  elements.settingsForm.addEventListener('submit', saveChannelSettings);
  elements.settingsNameRow.addEventListener('click', () => {
    if (elements.settingsNameRow.disabled) return;
    elements.settingsEdit.hidden = false;
    elements.settingsSave.hidden = false;
    elements.settingsName.focus();
  });
  elements.settingsAvatarBtn.addEventListener('click', () => {
    if (elements.settingsAvatarBtn.disabled) return;
    elements.settingsAvatarActions.hidden = !elements.settingsAvatarActions.hidden;
  });
  elements.settingsIdRow.addEventListener('click', () => {
    const value = elements.settingsInfoId.textContent;
    if (!value || value === '--') return;
    copyTextToClipboard(value).then(copied => {
      setFeedback(copied
        ? text('channels.channelIdCopied', '频道 ID 已复制')
        : text('channels.channelIdCopyFailed', '复制失败，请手动选择复制'));
    });
  });
  elements.settingsAnnouncementSave.addEventListener('click', saveChannelAnnouncement);
  elements.settingsNicknameInput.addEventListener('blur', saveMyNickname);
  elements.settingsNicknameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      elements.settingsNicknameInput.blur();
    }
  });
  elements.settingsSearchBtn.addEventListener('click', searchChannelHistory);
  elements.settingsSearchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchChannelHistory();
    }
  });
  elements.settingsBackgroundInput.addEventListener('change', () => {
    const file = elements.settingsBackgroundInput.files?.[0];
    elements.settingsBackgroundInput.value = '';
    if (file) uploadChannelBackground(file);
  });
  elements.settingsBackgroundReset.addEventListener('click', () => {
    const channel = state.channels.find(item => item.id === state.selectedChannelId);
    if (!channel) return;
    storeBackground(channel.id, null);
    applyChannelBackground(channel.id);
    renderBackgroundSwatches(channel);
  });
  elements.settingsLeave.addEventListener('click', leaveChannelFromSettings);
  elements.emojiButton.addEventListener('click', () => toggleEmojiPanel());
  document.addEventListener('pointerdown', event => {
    if (elements.emojiPanel.hidden) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && (elements.emojiPanel.contains(target) || elements.emojiButton.contains(target))) return;
    closeEmojiPanel();
  });
  elements.avatarInput.addEventListener('change', () => {
    const file = elements.avatarInput.files?.[0];
    elements.avatarInput.value = '';
    if (file) uploadChannelAvatar(file);
  });
  elements.avatarRemove.addEventListener('click', removeChannelAvatar);
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
    if (event.key !== 'Escape') return;
    if (!elements.emojiPanel.hidden) {
      event.preventDefault();
      closeEmojiPanel();
      return;
    }
    if (elements.contextMenu.hidden) return;
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
    if (!state.active) {
      closeContextMenu();
      closeUrgentModal();
    }
    if (!state.active) return;
    const bootstrapOptions = state.initialized
      ? { force: true, anchorUnread: true, scrollBottom: false }
      : { anchorUnread: true, scrollBottom: false };
    loadBootstrap(bootstrapOptions).then(() => {
      if (state.active) {
        startEvents();
        elements.syncViewport?.();
      }
    });
  });

  window.addEventListener('stella:open-channel', event => {
    const channelId = event.detail?.channelId;
    if (!channelId) return;
    state.active = true;
    setMobileView('conversation');
    loadBootstrap({ force: true, channelId, anchorUnread: true, scrollBottom: false }).then(() => {
      if (state.active) {
        startEvents();
        elements.syncViewport?.();
      }
    });
  });

  window.addEventListener('stella:identity-change', () => {
    closeContextMenu();
    closeUrgentModal();
    cancelQuoting();
    clearPendingFiles();
    stopVoicePlayback();
    state.initialized = false;
    state.selectedChannelId = null;
    state.messages = [];
    stopEvents();
    loadBootstrap({ force: true }).then(() => {
      startEvents();
    });
  });

  const initialButton = document.querySelector('[data-page="channels"].active');
  state.active = Boolean(initialButton);
  loadBootstrap({ anchorUnread: state.active, scrollBottom: !state.active }).then(() => {
    startEvents();
    elements.syncViewport?.();
  });
})();
