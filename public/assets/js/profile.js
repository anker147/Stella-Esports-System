(function () {
  const elements = {
    showcase: document.getElementById('profileShowcase'),
    name: document.getElementById('profileDisplayName'),
    role: document.getElementById('profileDisplayRole'),
    title: document.getElementById('profileDisplayTitle'),
    gender: document.getElementById('profileDisplayGender'),
    age: document.getElementById('profileDisplayAge'),
    regionFact: document.getElementById('profileDisplayRegionFact'),
    genderIcon: document.getElementById('profileGenderIcon'),
    bio: document.getElementById('profileDisplayBio'),
    displayPresence: document.getElementById('profileDisplayPresence'),
    cover: document.getElementById('profileCover'),
    coverImage: document.getElementById('profileCoverImage'),
    stats: document.getElementById('profileStats'),
    history: document.getElementById('profileHistoryList'),
    historyEmpty: document.getElementById('profileHistoryEmpty'),
    pageStatus: document.getElementById('profilePageStatus'),
    headerName: document.getElementById('headerUserName'),
    headerRole: document.getElementById('headerUserRole'),
    headerTitle: document.getElementById('headerUserTitle'),
    headerToggle: document.getElementById('headerUserToggle'),
    headerMenu: document.getElementById('headerUserMenu'),
    menuName: document.getElementById('userMenuName'),
    menuRole: document.getElementById('userMenuRole'),
    menuPresence: document.getElementById('userMenuPresence'),
    menuPresenceList: document.getElementById('userMenuPresenceList'),
    menuPresenceStatus: document.getElementById('userMenuPresenceStatus'),
    menuIdentities: document.getElementById('userMenuIdentities'),
    menuIdentityList: document.getElementById('userMenuIdentityList'),
    menuIdentityStatus: document.getElementById('userMenuIdentityStatus'),
    openSettings: document.getElementById('profileOpenSettings'),
    previewPublic: document.getElementById('profilePreviewPublic'),
    settingsDialog: document.getElementById('profileSettingsDialog'),
    settingsForm: document.getElementById('profileSettingsForm'),
    settingsClose: document.getElementById('profileSettingsClose'),
    settingsCancel: document.getElementById('profileSettingsCancel'),
    settingsSave: document.getElementById('profileSettingsSave'),
    settingsStatus: document.getElementById('profileSettingsStatus'),
    displayNameInput: document.getElementById('profileDisplayNameInput'),
    titleInput: document.getElementById('profileTitleInput'),
    bioInput: document.getElementById('profileBioInput'),
    bioCount: document.getElementById('profileBioCount'),
    genderInput: document.getElementById('profileGenderInput'),
    birthDateInput: document.getElementById('profileBirthDateInput'),
    accountInput: document.getElementById('profileAccountInput'),
    currentPassword: document.getElementById('profileCurrentPassword'),
    newPassword: document.getElementById('profileNewPassword'),
    confirmPassword: document.getElementById('profileConfirmPassword'),
    newPasswordError: document.getElementById('profileNewPasswordError'),
    confirmPasswordError: document.getElementById('profileConfirmPasswordError'),
    identityReadonly: document.getElementById('profileIdentityReadonly'),
    regionReadonly: document.getElementById('profileRegionReadonly'),
    avatarInput: document.getElementById('profileAvatarInput'),
    removeAvatar: document.getElementById('profileRemoveAvatar'),
    settingsAvatar: document.querySelector('[data-profile-settings-avatar]'),
    coverInput: document.getElementById('profileCoverInput'),
    removeCover: document.getElementById('profileRemoveCover'),
    coverEditor: document.getElementById('profileCoverEditorPreview'),
    titleReview: document.getElementById('profileTitleReview'),
    previewDialog: document.getElementById('profilePublicPreviewDialog'),
    previewClose: document.getElementById('profilePublicPreviewClose'),
    previewContent: document.getElementById('profilePublicPreviewContent'),
    cropDialog: document.getElementById('profileCoverCropDialog'),
    cropClose: document.getElementById('profileCoverCropClose'),
    cropCancel: document.getElementById('profileCoverCropCancel'),
    cropConfirm: document.getElementById('profileCoverCropConfirm'),
    cropStage: document.getElementById('profileCoverCropStage'),
    cropImage: document.getElementById('profileCoverCropImage'),
    cropZoom: document.getElementById('profileCoverCropZoom'),
    cropZoomValue: document.getElementById('profileCoverCropZoomValue'),
    cropX: document.getElementById('profileCoverCropX'),
    cropY: document.getElementById('profileCoverCropY'),
    cropStatus: document.getElementById('profileCoverCropStatus')
  };

  let savedProfile = null;
  let avatarDraft = '';
  let coverDraft = '';
  let avatarChanged = false;
  let coverChanged = false;
  let cropState = null;

  function initials(name) {
    const value = String(name || '').trim();
    if (!value) return '--';
    const parts = value.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts.slice(0, 2).map(part => part[0]).join('') : value.slice(0, 2)).toUpperCase();
  }

  function identityLabel(profile) {
    const key = profile.activeIdentityKey || profile.identityKey || (profile.role === 'developer' ? 'developer' : profile.role === 'admin' ? 'administrator' : 'guest');
    return t(`profile.identity${key.slice(0, 1).toUpperCase()}${key.slice(1)}`);
  }

  function roleLabel(profile) {
    return identityLabel(profile);
  }

  function presenceLabel(status) {
    const key = String(status || 'offline').slice(0, 1).toUpperCase() + String(status || 'offline').slice(1);
    return t(`profile.presenceStatus${key}`);
  }

  function renderPresence(profile) {
    const status = profile.presenceStatus || 'offline';
    const label = presenceLabel(status);
    const headerPresence = document.getElementById('headerPresenceStatus');
    if (headerPresence) {
      headerPresence.textContent = label;
      headerPresence.className = `header-state-item presence-${status}`;
    }
    elements.menuPresence.textContent = label;
    elements.menuPresence.className = `user-menu-presence presence-${status}`;
    elements.displayPresence.textContent = label;
    elements.displayPresence.className = `presence-status presence-${status}`;
    elements.menuPresenceList.querySelectorAll('[data-presence-preference]').forEach(item => {
      const active = item.dataset.presencePreference === (profile.presencePreference || 'auto');
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-checked', String(active));
    });
  }

  function updatePresence(snapshot) {
    if (!savedProfile || !snapshot) return;
    savedProfile.presenceStatus = snapshot.status || snapshot.presenceStatus || savedProfile.presenceStatus;
    savedProfile.presencePreference = snapshot.preference
      || snapshot.presencePreference || savedProfile.presencePreference || 'auto';
    renderPresence(savedProfile);
  }

  function genderLabel(value) {
    const keys = { male: 'profile.genderMale', female: 'profile.genderFemale', other: 'profile.genderOther', unspecified: 'profile.genderUnspecified' };
    return t(keys[value] || keys.unspecified);
  }

  const GENDER_ICON_PATHS = {
    male: '<circle cx="6.9" cy="9.1" r="3.4"/><path d="M9.6 6.4l3.5-3.5M9.9 2.9h3.2v3.2"/>',
    female: '<circle cx="8" cy="5.9" r="3.4"/><path d="M8 9.3v4.2M5.9 11.4h4.2"/>',
    neutral: '<circle cx="8" cy="5.5" r="2.4"/><path d="M3.4 13.5c.5-2.8 2.3-4 4.6-4s4.1 1.2 4.6 4"/>'
  };

  function renderGenderIconInto(root, value) {
    if (!root) return;
    const key = GENDER_ICON_PATHS[value] ? value : 'neutral';
    root.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${GENDER_ICON_PATHS[key]}</svg>`;
  }

  function renderGenderIcon(value) {
    renderGenderIconInto(elements.genderIcon, value);
  }

  function formatDate(value, fallback = t('profile.statNotSet')) {
    if (!value) return fallback;
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (days) return `${days}天 ${hours}小时`;
    if (hours) return `${hours}小时 ${minutes}分钟`;
    return `${minutes}分钟`;
  }

  function setAvatar(root, value, name) {
    if (!root) return;
    const image = root.querySelector('img');
    const fallback = root.querySelector('span');
    if (image) {
      image.hidden = !value;
      image.src = value || 'assets/brand/stella-logo.png';
    }
    if (fallback) {
      fallback.hidden = Boolean(value);
      fallback.textContent = initials(name);
    }
  }

  function renderAllAvatars(value, name) {
    document.querySelectorAll('[data-profile-avatar]').forEach(root => setAvatar(root, value, name));
  }

  function setCover(root, image, value) {
    if (!root || !image) return;
    image.hidden = !value;
    image.src = value || '';
    root.classList.toggle('has-cover', Boolean(value));
    const fallback = root.querySelector('.profile-cover-default, span');
    if (fallback) fallback.hidden = Boolean(value);
  }

  function statValue(profile, key) {
    if (key === 'duty_time') return formatDuration(profile.stats.dutySeconds);
    if (key === 'account_expiry') return profile.accountExpiresAt ? formatDate(profile.accountExpiresAt) : t('profile.statForever');
    if (key === 'event_count') return t('profile.statEventsUnit', { value: profile.stats.eventCount });
    return t('profile.statGamesUnit', { value: profile.stats.gameCount });
  }

  function statLabel(key) {
    const labels = { duty_time: 'profile.statDuty', account_expiry: 'profile.statExpiry', event_count: 'profile.statEvents', game_count: 'profile.statGames' };
    return t(labels[key]);
  }

  function renderStats(root, profile) {
    root.replaceChildren(...profile.visibleStats.map(key => {
      const item = document.createElement('div');
      item.className = 'profile-stat';
      const label = document.createElement('span');
      label.textContent = statLabel(key);
      const value = document.createElement('strong');
      value.textContent = statValue(profile, key);
      item.append(label, value);
      return item;
    }));
    root.hidden = profile.visibleStats.length === 0;
  }

  function renderHistory(profile) {
    elements.history.replaceChildren(...profile.recentExecutions.map(entry => {
      const item = document.createElement('li');
      const copy = document.createElement('div');
      const eventName = document.createElement('strong');
      eventName.textContent = entry.eventName;
      const match = document.createElement('span');
      match.textContent = `${entry.matchLabel} · ${t('profile.historyItem', { game: entry.gameNumber, room: entry.room })}`;
      copy.append(eventName, match);
      const date = document.createElement('span');
      date.textContent = formatDate(entry.executedAt);
      item.append(copy, date);
      return item;
    }));
    elements.historyEmpty.hidden = profile.recentExecutions.length > 0;
  }

  let identityAccessAnimation = null;

  function applyIdentityAccess(canManageSystem, animate = false) {
    const accessEntry = document.querySelector('[data-developer-only]');
    const wasAllowed = document.body.classList.contains('auth-developer');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!canManageSystem && document.querySelector('[data-developer-page]:not([hidden])')) {
      navigate('personalCenter');
    }

    identityAccessAnimation?.cancel();
    identityAccessAnimation = null;
    accessEntry?.classList.remove('identity-access-transition');
    document.body.classList.toggle('auth-developer', canManageSystem);
    document.body.classList.toggle('auth-operator', !canManageSystem);
    if (accessEntry) {
      accessEntry.inert = !canManageSystem;
      accessEntry.setAttribute('aria-hidden', String(!canManageSystem));
    }
    if (!accessEntry || !animate || wasAllowed === canManageSystem || reducedMotion) return;

    accessEntry.classList.add('identity-access-transition');
    const fullHeight = accessEntry.scrollHeight;
    const keyframes = canManageSystem
      ? [
          { height: '0px', opacity: 0, transform: 'translateY(-8px) scale(0.985)' },
          { height: `${fullHeight}px`, opacity: 1, transform: 'translateY(0) scale(1)' }
        ]
      : [
          { height: `${fullHeight}px`, opacity: 1, transform: 'translateY(0) scale(1)' },
          { height: '0px', opacity: 0, transform: 'translateY(-8px) scale(0.985)' }
        ];
    const animation = accessEntry.animate(keyframes, {
      duration: canManageSystem ? 340 : 280,
      easing: canManageSystem ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'cubic-bezier(0.4, 0, 0.2, 1)',
      fill: 'both'
    });
    identityAccessAnimation = animation;
    animation.finished.catch(() => {}).then(() => {
      if (identityAccessAnimation !== animation) return;
      identityAccessAnimation = null;
      animation.cancel();
      accessEntry.classList.remove('identity-access-transition');
    });
  }

  function renderHeader(profile, { animateAccess = false } = {}) {
    const name = profile.displayName || profile.account;
    elements.headerName.textContent = name;
    elements.menuName.textContent = name;
    elements.headerRole.textContent = roleLabel(profile);
    elements.menuRole.textContent = roleLabel(profile);
    elements.headerTitle.textContent = profile.title || t('profile.noTitle');
    renderPresence(profile);
    renderAllAvatars(profile.avatarUrl, name);
    const identityKeys = profile.identityKeys || [profile.activeIdentityKey || profile.identityKey];
    elements.menuIdentities.hidden = identityKeys.length < 2;
    elements.menuIdentityList.replaceChildren(...identityKeys.map(key => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'user-menu-item is-radio';
      item.dataset.identityKey = key;
      const active = key === profile.activeIdentityKey;
      if (active) item.classList.add('is-active');
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(active));
      const check = document.createElement('span');
      check.className = 'user-menu-check';
      const label = document.createElement('span');
      label.textContent = t(`profile.identity${key.slice(0, 1).toUpperCase()}${key.slice(1)}`);
      item.append(check, label);
      return item;
    }));
    const canManageSystem = Boolean(profile.identity?.systemManagement);
    applyIdentityAccess(canManageSystem, animateAccess);
    const pagePermissions = {
      countdown: 'countdown.operate',
      bp: 'bp.view',
      events: 'operations.view',
      schedule: 'operations.view',
      teams: 'operations.view',
      players: 'operations.view',
      matchRecords: 'operations.view',
      hudCenter: 'hud.view',
      bracket: 'bracket.publish',
      materials: 'materials.view',
      resourceMonitor: 'materials.view',
      characterStats: 'characterStats.view',
      dataConfig: 'system.manage',
      terminalStatus: 'system.status.view',
      systemSettings: 'system.manage',
      riskResponse: 'system.manage',
      friends: 'friends.manage',
      addFriend: 'friends.manage',
      channels: 'communication.use'
    };
    document.querySelectorAll('[data-page]').forEach(entry => {
      if (entry.dataset.page === 'logs') {
        entry.dataset.permission = entry.dataset.logCategory === 'account'
          ? 'logs.account.view' : 'logs.event.view';
      } else if (pagePermissions[entry.dataset.page]) {
        entry.dataset.permission = pagePermissions[entry.dataset.page];
      }
    });
    const permissions = new Set(profile.permissions || profile.identity?.permissions || []);
    document.querySelectorAll('[data-permission]').forEach(entry => {
      const allowed = permissions.has(entry.dataset.permission);
      entry.hidden = !allowed;
      entry.inert = !allowed;
      entry.setAttribute('aria-hidden', String(!allowed));
    });
    const activePermissionEntry = document.querySelector('[data-page].active[data-permission]');
    if (activePermissionEntry && !permissions.has(activePermissionEntry.dataset.permission)) {
      const fallback = document.querySelector('[data-page="personalCenter"]')
        || document.querySelector('[data-page="updates"]')
        || document.querySelector('[data-page="profile"]');
      if (fallback) fallback.click();
    }
    const identityKeys2 = ['developer', 'administrator', 'director', 'commentator', 'referee', 'scorer', 'guest'];
    identityKeys2.forEach(key => document.body.classList.remove(`identity-${key}`));
    const identityKey = profile.activeIdentityKey || profile.identityKey || 'guest';
    document.body.classList.add(`identity-${identityKeys2.includes(identityKey) ? identityKey : 'guest'}`);
  }

  function renderProfile(profile, options) {
    savedProfile = structuredClone(profile);
    const name = profile.displayName || profile.account;
    elements.name.textContent = name;
    elements.role.textContent = roleLabel(profile);
    elements.title.textContent = profile.title || t('profile.noTitle');
    elements.regionFact.textContent = profile.region;
    elements.gender.textContent = genderLabel(profile.gender);
    renderGenderIcon(profile.gender);
    elements.age.textContent = profile.age == null ? t('profile.statNotSet') : t('profile.statYears', { value: profile.age });
    elements.bio.textContent = profile.bio || t('profile.noBio');
    renderAllAvatars(profile.avatarUrl, name);
    setCover(elements.cover, elements.coverImage, profile.coverUrl);
    renderStats(elements.stats, profile);
    renderHistory(profile);
    renderHeader(profile, options);
    elements.showcase.setAttribute('aria-busy', 'false');
  }

  async function requestJson(url, options) {
    return window.StellaDataCache.json(url, options);
  }

  function setStatus(message, type = '') {
    elements.settingsStatus.textContent = message;
    elements.settingsStatus.className = type;
  }

  function selectSettingsTab(name, focus = false) {
    document.querySelectorAll('[data-settings-tab]').forEach(button => {
      const active = button.dataset.settingsTab === name;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    document.querySelectorAll('[data-settings-panel]').forEach(panel => {
      const active = panel.dataset.settingsPanel === name;
      panel.hidden = !active;
      panel.classList.remove('is-entering');
      if (active) {
        requestAnimationFrame(() => {
          panel.classList.add('is-entering');
          panel.querySelectorAll('.form-stack, .profile-media-editor, .profile-cover-editor, .profile-security-note, .profile-readonly-location, .profile-stat-selector').forEach((item, index) => {
            item.style.setProperty('--profile-stagger', `${Math.min(index, 5) * 38}ms`);
          });
        });
      }
    });
  }

  function populateSettings() {
    const profile = savedProfile;
    avatarDraft = profile.avatarUrl || '';
    coverDraft = profile.coverUrl || '';
    avatarChanged = false;
    coverChanged = false;
    elements.displayNameInput.value = profile.displayName || profile.account;
    elements.titleInput.value = profile.title || '';
    elements.bioInput.value = profile.bio || '';
    elements.bioCount.textContent = `${elements.bioInput.value.length} / 200`;
    elements.genderInput.value = profile.gender || 'unspecified';
    elements.birthDateInput.value = profile.birthDate || '';
    elements.accountInput.value = profile.account;
    elements.currentPassword.value = '';
    elements.newPassword.value = '';
    elements.confirmPassword.value = '';
    elements.newPasswordError.textContent = '';
    elements.confirmPasswordError.textContent = '';
    elements.identityReadonly.textContent = `${roleLabel(profile)} · ${profile.identity.accessLevel === 'full' ? t('profile.accessFull') : t('profile.accessStandard')}`;
    elements.titleReview.hidden = !profile.pendingTitle;
    elements.titleReview.textContent = profile.pendingTitle
      ? t('profile.titlePending', { title: profile.pendingTitle }) : '';
    elements.regionReadonly.textContent = profile.region;
    elements.settingsForm.querySelectorAll('input[name="profileStat"]').forEach(input => {
      input.checked = profile.visibleStats.includes(input.value);
    });
    setAvatar(elements.settingsAvatar, avatarDraft, profile.displayName);
    setCover(elements.coverEditor, elements.coverEditor.querySelector('img'), coverDraft);
    elements.removeAvatar.disabled = !avatarDraft;
    elements.removeCover.disabled = !coverDraft;
    selectSettingsTab('public');
    setStatus('');
  }

  function openSettings() {
    if (!savedProfile) return;
    populateSettings();
    elements.settingsDialog.showModal();
    requestAnimationFrame(() => elements.settingsClose.focus());
  }

  function validatePasswordFields() {
    const next = elements.newPassword.value;
    const confirmation = elements.confirmPassword.value;
    let valid = true;
    elements.newPasswordError.textContent = next && next.length < 10 ? t('profile.passwordMinError') : '';
    elements.confirmPasswordError.textContent = confirmation && (!next || confirmation !== next)
      ? t('profile.passwordMismatch') : '';
    valid = !elements.newPasswordError.textContent && !elements.confirmPasswordError.textContent;
    elements.newPassword.setCustomValidity(valid ? '' : elements.newPasswordError.textContent || elements.confirmPasswordError.textContent);
    elements.confirmPassword.setCustomValidity(valid ? '' : elements.confirmPasswordError.textContent);
    return valid;
  }

  function syncSensitiveRequirement() {
    const accountChanged = savedProfile && elements.accountInput.value.trim() !== savedProfile.account;
    elements.currentPassword.required = Boolean(accountChanged || elements.newPassword.value);
  }

  function closeSettings() {
    elements.settingsDialog.close();
    elements.openSettings.focus();
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
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(t('profile.avatarTypeError'));
    const limit = type === 'avatar' ? 5 : 8;
    if (file.size > limit * 1024 * 1024) throw new Error(t('profile.imageTooLarge', { type: type === 'avatar' ? '头像' : '顶置图', size: limit }));
    const image = await loadImage(file);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (type === 'avatar') {
      const size = Math.min(image.naturalWidth, image.naturalHeight);
      canvas.width = 320;
      canvas.height = 320;
      context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, canvas.width, canvas.height);
    } else {
      canvas.width = 1600;
      canvas.height = 480;
      const sourceRatio = image.naturalWidth / image.naturalHeight;
      const targetRatio = canvas.width / canvas.height;
      const sourceWidth = sourceRatio > targetRatio ? image.naturalHeight * targetRatio : image.naturalWidth;
      const sourceHeight = sourceRatio > targetRatio ? image.naturalHeight : image.naturalWidth / targetRatio;
      context.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    }
    return canvas.toDataURL('image/webp', type === 'avatar' ? 0.86 : 0.82);
  }

  function updateCropPreview() {
    if (!cropState?.image?.naturalWidth) return;
    const width = elements.cropStage.clientWidth;
    const height = elements.cropStage.clientHeight;
    const baseScale = Math.max(width / cropState.image.naturalWidth, height / cropState.image.naturalHeight);
    const displayScale = baseScale * (Number(elements.cropZoom.value) / 100);
    const imageWidth = cropState.image.naturalWidth * displayScale;
    const imageHeight = cropState.image.naturalHeight * displayScale;
    const left = -Math.max(0, imageWidth - width) * (Number(elements.cropX.value) / 100);
    const top = -Math.max(0, imageHeight - height) * (Number(elements.cropY.value) / 100);
    cropState.displayScale = displayScale;
    cropState.offsetX = left;
    cropState.offsetY = top;
    elements.cropImage.style.width = `${imageWidth}px`;
    elements.cropImage.style.height = `${imageHeight}px`;
    elements.cropImage.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    elements.cropZoomValue.textContent = `${elements.cropZoom.value}%`;
  }

  function closeCoverCrop() {
    elements.cropDialog.close();
    if (cropState?.objectUrl) URL.revokeObjectURL(cropState.objectUrl);
    cropState = null;
    elements.coverInput.focus();
  }

  async function openCoverCrop(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(t('profile.imageTypeError'));
    if (file.size > 8 * 1024 * 1024) throw new Error(t('profile.imageTooLarge', { type: '顶置图', size: 8 }));
    const objectUrl = URL.createObjectURL(file);
    const image = await new Promise((resolve, reject) => {
      const loaded = new Image();
      loaded.onload = () => resolve(loaded);
      loaded.onerror = () => reject(new Error(t('profile.avatarReadFailed')));
      loaded.src = objectUrl;
    });
    cropState = { image, objectUrl };
    elements.cropImage.src = objectUrl;
    elements.cropZoom.value = '100';
    elements.cropX.value = '50';
    elements.cropY.value = '50';
    elements.cropStatus.textContent = '';
    elements.cropDialog.showModal();
    requestAnimationFrame(() => {
      updateCropPreview();
      elements.cropZoom.focus();
    });
  }

  function confirmCoverCrop(event) {
    event.preventDefault();
    if (!cropState?.displayScale) return;
    const width = elements.cropStage.clientWidth;
    const height = elements.cropStage.clientHeight;
    const sourceWidth = width / cropState.displayScale;
    const sourceHeight = height / cropState.displayScale;
    const sourceX = -cropState.offsetX / cropState.displayScale;
    const sourceY = -cropState.offsetY / cropState.displayScale;
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 480;
    const context = canvas.getContext('2d');
    context.drawImage(cropState.image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    coverDraft = canvas.toDataURL('image/webp', 0.82);
    coverChanged = true;
    setCover(elements.coverEditor, elements.coverEditor.querySelector('img'), coverDraft);
    elements.removeCover.disabled = false;
    closeCoverCrop();
    setStatus(t('profile.imageReady'), 'success');
  }

  function buildPublicPreview(profile) {
    const wrapper = document.createElement('div');
    wrapper.className = 'profile-showcase public-profile-preview';
    const hero = document.createElement('article');
    hero.className = 'profile-hero';
    const cover = document.createElement('div');
    cover.className = 'profile-cover';
    if (profile.coverUrl) {
      const coverImage = document.createElement('img');
      coverImage.src = profile.coverUrl;
      coverImage.alt = '';
      cover.append(coverImage);
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'profile-cover-default';
      const logo = document.createElement('img');
      logo.src = 'assets/brand/stella-logo.png';
      logo.alt = '';
      fallback.append(logo);
      cover.append(fallback);
    }
    const body = document.createElement('div');
    body.className = 'profile-hero-body';
    const avatar = document.createElement('div');
    avatar.className = 'profile-display-avatar';
    if (profile.avatarUrl) {
      const avatarImage = document.createElement('img');
      avatarImage.src = profile.avatarUrl;
      avatarImage.alt = '';
      avatar.append(avatarImage);
    } else {
      const fallback = document.createElement('span');
      fallback.textContent = initials(profile.displayName);
      fallback.setAttribute('aria-hidden', 'true');
      avatar.append(fallback);
    }
    const copy = document.createElement('div');
    copy.className = 'profile-display-copy';
    const nameRow = document.createElement('div');
    nameRow.className = 'profile-display-name-row';
    const name = document.createElement('h2');
    name.textContent = profile.displayName;
    const badge = document.createElement('span');
    badge.className = 'profile-role-badge';
    badge.textContent = roleLabel(profile);
    const presence = document.createElement('span');
    presence.className = `presence-status presence-${profile.presenceStatus || 'offline'}`;
    presence.textContent = presenceLabel(profile.presenceStatus);
    nameRow.append(name, badge, presence);
    const job = document.createElement('p');
    job.className = 'profile-job';
    job.textContent = profile.title || t('profile.noTitle');
    const factLine = document.createElement('p');
    factLine.className = 'profile-fact-line';
    const genderFact = document.createElement('span');
    genderFact.className = 'profile-fact';
    const genderIconWrap = document.createElement('span');
    genderIconWrap.className = 'profile-fact-ico';
    genderIconWrap.setAttribute('aria-hidden', 'true');
    const genderValue = document.createElement('span');
    genderValue.textContent = genderLabel(profile.gender);
    genderFact.append(genderIconWrap, genderValue);
    const ageFact = document.createElement('span');
    ageFact.className = 'profile-fact';
    const ageIcon = document.createElement('span');
    ageIcon.className = 'profile-fact-ico';
    ageIcon.setAttribute('aria-hidden', 'true');
    ageIcon.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.2 13.2V9.4a1.8 1.8 0 0 1 1.8-1.8h4a1.8 1.8 0 0 1 1.8 1.8v3.8"/><path d="M2.6 13.2h10.8"/><path d="M8 7.6V5.6"/><path d="M8 3.8v.01"/></svg>';
    const ageValue = document.createElement('span');
    ageValue.textContent = profile.age == null ? t('profile.statNotSet') : t('profile.statYears', { value: profile.age });
    ageFact.append(ageIcon, ageValue);
    const regionFact = document.createElement('span');
    regionFact.className = 'profile-fact';
    const regionIcon = document.createElement('span');
    regionIcon.className = 'profile-fact-ico';
    regionIcon.setAttribute('aria-hidden', 'true');
    regionIcon.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6.9c0 3.6-5 7.3-5 7.3S3 10.5 3 6.9a5 5 0 0 1 10 0z"/><circle cx="8" cy="6.9" r="1.7"/></svg>';
    const regionValue = document.createElement('span');
    regionValue.textContent = profile.region;
    regionFact.append(regionIcon, regionValue);
    factLine.append(genderFact, ageFact, regionFact);
    renderGenderIconInto(genderIconWrap, profile.gender);
    const bio = document.createElement('p');
    bio.className = 'profile-bio';
    bio.textContent = profile.bio || t('profile.noBio');
    copy.append(nameRow, job, factLine, bio);
    body.append(avatar, copy);
    hero.append(cover, body);
    const content = document.createElement('div');
    content.className = 'profile-content-grid';
    const left = document.createElement('div');
    left.className = 'profile-left-column';
    const statBand = document.createElement('section');
    statBand.className = 'profile-stat-band';
    const statHeading = document.createElement('div');
    statHeading.className = 'profile-section-heading';
    const statTitle = document.createElement('h3');
    statTitle.textContent = t('profile.statsTitle');
    statHeading.append(statTitle);
    const stats = document.createElement('div');
    stats.className = 'profile-stats';
    renderStats(stats, profile);
    statBand.append(statHeading, stats);
    left.append(statBand);
    const history = document.createElement('article');
    history.className = 'profile-history';
    const historyHeading = document.createElement('div');
    historyHeading.className = 'profile-section-heading';
    const historyTitle = document.createElement('h3');
    historyTitle.textContent = t('profile.historyTitle');
    historyHeading.append(historyTitle);
    const historyList = document.createElement('ol');
    historyList.className = 'profile-history-list';
    historyList.replaceChildren(...profile.recentExecutions.map(entry => {
      const item = document.createElement('li');
      const entryCopy = document.createElement('div');
      const eventName = document.createElement('strong');
      eventName.textContent = entry.eventName;
      const match = document.createElement('span');
      match.textContent = `${entry.matchLabel} · ${t('profile.historyItem', { game: entry.gameNumber, room: entry.room })}`;
      entryCopy.append(eventName, match);
      const date = document.createElement('span');
      date.textContent = formatDate(entry.executedAt);
      item.append(entryCopy, date);
      return item;
    }));
    if (!profile.recentExecutions.length) {
      const empty = document.createElement('div');
      empty.className = 'profile-empty';
      empty.textContent = t('profile.historyEmpty');
      history.append(historyHeading, empty);
    } else {
      history.append(historyHeading, historyList);
    }
    content.append(left, history);
    wrapper.append(hero, content);
    return wrapper;
  }

  async function openPublicProfile(userId = savedProfile?.id) {
    try {
      const profile = userId === savedProfile?.id ? savedProfile : await requestJson(`/api/profiles/${encodeURIComponent(userId)}`);
      document.getElementById('profilePublicPreviewTitle').textContent = t('profile.previewTitle', {
        name: profile.displayName || profile.account
      });
      elements.previewContent.replaceChildren(buildPublicPreview(profile));
      elements.previewDialog.showModal();
      requestAnimationFrame(() => elements.previewClose.focus());
    } catch (error) {
      elements.pageStatus.textContent = error.message;
      elements.pageStatus.className = 'profile-page-status error';
    }
  }

  function navigate(page) {
    document.querySelector(`.sidebar [data-page="${page}"]`)?.click();
  }

  function bindEvents() {
    let menuOpen = false;
    function setMenuOpen(open) {
      menuOpen = open;
      if (open) {
        elements.menuPresenceStatus.textContent = '';
        elements.menuIdentityStatus.textContent = '';
      }
      elements.headerToggle.setAttribute('aria-expanded', String(open));
      elements.headerMenu.classList.toggle('is-open', open);
      elements.headerMenu.hidden = !open;
    }
    setMenuOpen(false);
    elements.headerToggle.addEventListener('click', event => {
      const open = !menuOpen;
      setMenuOpen(open);
      if (open && event.detail === 0) {
        elements.headerMenu.querySelector('[role="menuitem"], [role="menuitemradio"]')?.focus();
      }
    });
    document.addEventListener('pointerdown', event => {
      if (!menuOpen) return;
      if (event.target.closest('#headerUserMenu') || event.target.closest('#headerUserToggle')) return;
      setMenuOpen(false);
    });
    elements.headerMenu.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        elements.headerToggle.focus();
        return;
      }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(elements.headerMenu.querySelectorAll('[role="menuitem"], [role="menuitemradio"]'));
      const index = items.indexOf(document.activeElement);
      const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      if (next) next.focus();
    });
    elements.headerMenu.addEventListener('click', async event => {
      const identityItem = event.target.closest('[data-identity-key]');
      if (identityItem) {
        const identityKey = identityItem.dataset.identityKey;
        if (!identityKey || !savedProfile) return;
        if (identityKey === savedProfile.activeIdentityKey) {
          setMenuOpen(false);
          elements.headerToggle.focus();
          return;
        }
        elements.menuIdentityList.querySelectorAll('[data-identity-key]').forEach(item => {
          item.disabled = true;
        });
        elements.menuIdentityList.setAttribute('aria-busy', 'true');
        elements.menuIdentityStatus.textContent = t('profile.identitySwitching');
        try {
          const profile = await requestJson('/api/profile/identity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identityKey })
          });
          renderProfile(profile, { animateAccess: true });
          window.dispatchEvent(new CustomEvent('stella:identity-change', { detail: profile }));
          setMenuOpen(false);
          elements.headerToggle.focus();
        } catch (error) {
          elements.menuIdentityStatus.textContent = error.message;
        } finally {
          elements.menuIdentityList.querySelectorAll('[data-identity-key]').forEach(item => {
            item.disabled = false;
          });
          elements.menuIdentityList.removeAttribute('aria-busy');
        }
        return;
      }
      const presenceItem = event.target.closest('[data-presence-preference]');
      if (presenceItem) {
        const preference = presenceItem.dataset.presencePreference;
        if (!preference || !savedProfile) return;
        if (preference === savedProfile.presencePreference) {
          setMenuOpen(false);
          elements.headerToggle.focus();
          return;
        }
        const options = Array.from(elements.menuPresenceList.querySelectorAll('[data-presence-preference]'));
        options.forEach(item => { item.disabled = true; });
        elements.menuPresenceList.setAttribute('aria-busy', 'true');
        elements.menuPresenceStatus.textContent = '';
        try {
          const snapshot = await requestJson('/api/presence/preference', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preference })
          });
          updatePresence(snapshot);
          setMenuOpen(false);
          elements.headerToggle.focus();
        } catch (error) {
          elements.menuPresenceStatus.textContent = error.message;
        } finally {
          options.forEach(item => { item.disabled = false; });
          elements.menuPresenceList.removeAttribute('aria-busy');
        }
        return;
      }
      const actionItem = event.target.closest('[data-user-action]');
      if (!actionItem) return;
      const action = actionItem.dataset.userAction;
      setMenuOpen(false);
      if (action === 'settings') openSettings();
      else if (action === 'preview') openPublicProfile();
      else if (action === 'logout') document.getElementById('logoutButton').click();
      else navigate('profile');
    });
    elements.openSettings.addEventListener('click', openSettings);
    elements.previewPublic.addEventListener('click', () => openPublicProfile());
    elements.settingsClose.addEventListener('click', closeSettings);
    elements.settingsCancel.addEventListener('click', closeSettings);
    elements.previewClose.addEventListener('click', () => elements.previewDialog.close());
    elements.settingsDialog.addEventListener('cancel', event => {
      event.preventDefault();
      closeSettings();
    });
    elements.cropClose.addEventListener('click', closeCoverCrop);
    elements.cropCancel.addEventListener('click', closeCoverCrop);
    elements.cropDialog.addEventListener('cancel', event => {
      event.preventDefault();
      closeCoverCrop();
    });
    elements.cropDialog.addEventListener('submit', confirmCoverCrop);
    [elements.cropZoom, elements.cropX, elements.cropY].forEach(input => input.addEventListener('input', updateCropPreview));
    elements.previewDialog.addEventListener('cancel', event => {
      event.preventDefault();
      elements.previewDialog.close();
      elements.previewPublic.focus();
    });
    const tabs = Array.from(document.querySelectorAll('[data-settings-tab]'));
    tabs.forEach((button, index) => {
      button.addEventListener('click', () => selectSettingsTab(button.dataset.settingsTab));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        const next = tabs[(index + offset + tabs.length) % tabs.length];
        selectSettingsTab(next.dataset.settingsTab, true);
      });
    });
    elements.bioInput.addEventListener('input', () => {
      elements.bioCount.textContent = `${elements.bioInput.value.length} / 200`;
    });
    elements.newPassword.addEventListener('input', validatePasswordFields);
    elements.confirmPassword.addEventListener('input', validatePasswordFields);
    elements.accountInput.addEventListener('input', syncSensitiveRequirement);
    elements.newPassword.addEventListener('input', syncSensitiveRequirement);
    elements.avatarInput.addEventListener('change', async () => {
      const file = elements.avatarInput.files?.[0];
      if (!file) return;
      try {
        setStatus(t('profile.processingImage'), 'pending');
        avatarDraft = await processImage(file, 'avatar');
        avatarChanged = true;
        setAvatar(elements.settingsAvatar, avatarDraft, elements.displayNameInput.value);
        elements.removeAvatar.disabled = false;
        setStatus(t('profile.imageReady'), 'success');
      } catch (error) {
        setStatus(error.message, 'error');
      } finally {
        elements.avatarInput.value = '';
      }
    });
    elements.coverInput.addEventListener('change', async () => {
      const file = elements.coverInput.files?.[0];
      if (!file) return;
      try {
        await openCoverCrop(file);
      } catch (error) {
        setStatus(error.message, 'error');
      } finally {
        elements.coverInput.value = '';
      }
    });
    elements.removeAvatar.addEventListener('click', () => {
      avatarDraft = '';
      avatarChanged = true;
      setAvatar(elements.settingsAvatar, '', elements.displayNameInput.value);
      elements.removeAvatar.disabled = true;
    });
    elements.removeCover.addEventListener('click', () => {
      coverDraft = '';
      coverChanged = true;
      setCover(elements.coverEditor, elements.coverEditor.querySelector('img'), '');
      elements.removeCover.disabled = true;
    });
    elements.settingsForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!elements.settingsForm.reportValidity()) return;
      if (!validatePasswordFields()) return;
      const payload = {
        account: elements.accountInput.value.trim(),
        displayName: elements.displayNameInput.value.trim(),
        title: elements.titleInput.value.trim(),
        bio: elements.bioInput.value.trim(),
        gender: elements.genderInput.value,
        birthDate: elements.birthDateInput.value || null,
        currentPassword: elements.currentPassword.value,
        newPassword: elements.newPassword.value,
        visibleStats: Array.from(elements.settingsForm.querySelectorAll('input[name="profileStat"]:checked')).map(input => input.value)
      };
      if (avatarChanged) payload.avatar = avatarDraft;
      if (coverChanged) payload.cover = coverDraft;
      elements.settingsSave.disabled = true;
      elements.settingsForm.setAttribute('aria-busy', 'true');
      setStatus(t('profile.saving'), 'pending');
      try {
        const profile = await requestJson('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        renderProfile(profile);
        populateSettings();
        setStatus(t('profile.saved'), 'success');
      } catch (error) {
        setStatus(t('profile.saveFailed', { error: error.message }), 'error');
      } finally {
        elements.settingsSave.disabled = false;
        elements.settingsForm.removeAttribute('aria-busy');
      }
    });
  }

  bindEvents();
  const ready = requestJson('/api/profile')
    .then(profile => {
      renderProfile(profile);
      return profile;
    })
    .catch(error => {
      elements.showcase.setAttribute('aria-busy', 'false');
      elements.pageStatus.textContent = t('profile.loadFailed', { error: error.message });
      elements.pageStatus.className = 'profile-page-status error';
      throw error;
    });

  async function refresh() {
    const profile = await requestJson('/api/profile', { force: true });
    renderProfile(profile, { animateAccess: true });
    return profile;
  }

  window.addEventListener('stella:permissions-change', () => {
    refresh().catch(() => {});
  });

  window.ProfileCenter = {
    ready,
    navigate,
    openPublicProfile,
    updatePresence,
    refresh,
    getProfile: () => savedProfile ? structuredClone(savedProfile) : null
  };
})();
