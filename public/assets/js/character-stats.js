(function () {
  'use strict';

  const page = document.getElementById('characterDataPage');
  if (!page) return;

  const elements = {
    games: document.getElementById('characterStatsGames'),
    decidedAt: document.getElementById('characterStatsDecidedAt'),
    updatedAt: document.getElementById('characterStatsUpdatedAt'),
    status: document.getElementById('characterDataStatus'),
    divisionSwitch: document.getElementById('characterDivisionSwitch'),
    manage: document.getElementById('characterManageButton'),
    escape: {
      list: document.getElementById('escapeCharacterRanks'),
      picks: document.getElementById('escapePickSamples'),
      bans: document.getElementById('escapeBanSamples')
    },
    hunter: {
      list: document.getElementById('hunterCharacterRanks'),
      picks: document.getElementById('hunterPickSamples'),
      bans: document.getElementById('hunterBanSamples')
    },
    detail: {
      dialog: document.getElementById('characterStatsDetailDialog'),
      close: document.getElementById('characterDetailClose'),
      avatar: document.getElementById('characterDetailAvatar'),
      role: document.getElementById('characterDetailRole'),
      title: document.getElementById('characterDetailTitle'),
      name: document.getElementById('characterDetailName'),
      releaseDate: document.getElementById('characterDetailReleaseDate'),
      rank: document.getElementById('characterDetailRank'),
      score: document.getElementById('characterDetailScore'),
      usageRate: document.getElementById('characterDetailUsageRate'),
      banRate: document.getElementById('characterDetailBanRate'),
      winRate: document.getElementById('characterDetailWinRate'),
      skillBox: document.getElementById('characterSkillBox'),
      skillOptions: document.getElementById('characterSkillOptions'),
      skillDescription: document.getElementById('characterSkillDescription'),
      skillCollapse: document.getElementById('characterSkillCollapse'),
      skillName: document.getElementById('characterSkillName'),
      skillCopy: document.getElementById('characterSkillCopy'),
      latestTeam: document.getElementById('characterLatestTeam'),
      latestPlayer: document.getElementById('characterLatestPlayer'),
      latestMatch: document.getElementById('characterLatestMatch'),
      latestUsedAt: document.getElementById('characterLatestUsedAt'),
      changeHistory: document.getElementById('characterChangeHistory'),
      changePagination: document.getElementById('characterChangePagination'),
      changePrevious: document.getElementById('characterChangePrevious'),
      changeNext: document.getElementById('characterChangeNext'),
      changePage: document.getElementById('characterChangePage'),
      changeDialog: document.getElementById('characterChangeDetailDialog'),
      changeDialogClose: document.getElementById('characterChangeDetailClose'),
      changeDialogTitle: document.getElementById('characterChangeDetailTitle'),
      changeDialogDate: document.getElementById('characterChangeDetailDate'),
      changeDialogContent: document.getElementById('characterChangeDetailContent'),
      commonTeams: document.getElementById('characterCommonTeams'),
      commonPlayers: document.getElementById('characterCommonPlayers'),
      recentResults: document.getElementById('characterRecentResults')
    },
    editor: {
      dialog: document.getElementById('characterEditorDialog'),
      form: document.getElementById('characterEditorForm'),
      body: document.querySelector('#characterEditorDialog .character-editor-body'),
      title: document.getElementById('characterEditorTitle'),
      close: document.getElementById('characterEditorClose'),
      cancel: document.getElementById('characterEditorCancel'),
      save: document.getElementById('characterEditorSave'),
      delete: document.getElementById('characterEditorDelete'),
      mode: document.getElementById('characterEditorMode'),
      characterName: document.getElementById('characterEditorCharacterName'),
      list: document.getElementById('characterManagerList'),
      create: document.getElementById('characterManagerNew'),
      id: document.getElementById('characterEditorId'),
      role: document.getElementById('characterEditorRole'),
      nickname: document.getElementById('characterEditorNickname'),
      name: document.getElementById('characterEditorName'),
      releaseDate: document.getElementById('characterEditorReleaseDate'),
      portraitInput: document.getElementById('characterPortraitInput'),
      portraitPreview: document.getElementById('characterPortraitPreview'),
      portraitFallback: document.getElementById('characterPortraitFallback'),
      portraitRemove: document.getElementById('characterPortraitRemove'),
      skills: document.getElementById('characterEditorSkills'),
      changeDrafts: document.getElementById('characterChangeDrafts'),
      existingChanges: document.getElementById('characterExistingChanges'),
      changeDraftAdd: document.getElementById('characterChangeDraftAdd'),
      status: document.getElementById('characterEditorStatus')
    }
  };
  const relevantReasons = new Set([
    'slot-updated', 'slot-cleared', 'result-updated', 'revision-restored',
    'replay-created', 'session-reset', 'forfeit-declared', 'forfeit-revoked'
  ]);
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const AUTO_SCROLL_SPEED = 48;
  const AUTO_SCROLL_IDLE_MS = 4000;
  const AUTO_SCROLL_EDGE_PAUSE_MS = 700;
  const roleOrderSignatures = { escape: '', hunter: '' };
  let initialized = false;
  let active = !document.getElementById('characterStatsPage').hidden;
  let events = null;
  let refreshTimer = 0;
  let selectedSkillId = null;
  let activeDivision = 'all';
  let loadSequence = 0;
  let activeChanges = [];
  let changePageIndex = 0;
  let selectedCharacter = null;
  let editingCharacter = null;
  let editorTrigger = null;
  let canManageCharacters = false;
  let managedCharacters = [];
  let portraitDraft = null;
  let portraitChanged = false;
  const skillIconDrafts = new Map();
  const changedSkillIcons = new Set();
  let changeDraftCounter = 0;
  let changeDialogTrigger = null;
  const CHANGES_PER_PAGE = 9;
  const autoScrollers = new Map();

  function createAutoScroller(list) {
    let frame = 0;
    let resumeTimer = 0;
    let lastFrameAt = 0;
    let edgePauseUntil = 0;
    let position = 0;
    let maxPosition = 0;
    let direction = 1;
    let running = false;

    function stop() {
      running = false;
      window.cancelAnimationFrame(frame);
      frame = 0;
      lastFrameAt = 0;
    }

    function canRun() {
      return active
        && !document.hidden
        && !motionPreference.matches
        && !elements.detail.dialog.open
        && maxPosition > 0;
    }

    function tick(now) {
      if (!running) return;
      if (!canRun()) {
        stop();
        return;
      }
      if (!lastFrameAt) lastFrameAt = now;
      const elapsed = Math.min(now - lastFrameAt, 64);
      lastFrameAt = now;
      if (now >= edgePauseUntil) {
        position += direction * AUTO_SCROLL_SPEED * elapsed / 1000;
        if (position >= maxPosition) {
          position = maxPosition;
          direction = -1;
          edgePauseUntil = now + AUTO_SCROLL_EDGE_PAUSE_MS;
        } else if (position <= 0) {
          position = 0;
          direction = 1;
          edgePauseUntil = now + AUTO_SCROLL_EDGE_PAUSE_MS;
        }
        list.scrollTop = position;
      }
      frame = window.requestAnimationFrame(tick);
    }

    function start(delay = 0) {
      window.clearTimeout(resumeTimer);
      if (delay > 0) {
        resumeTimer = window.setTimeout(() => {
          measure();
          start();
        }, delay);
        return;
      }
      if (running || !canRun()) return;
      running = true;
      lastFrameAt = 0;
      frame = window.requestAnimationFrame(tick);
    }

    function measure(reset = false) {
      maxPosition = Math.max(0, list.scrollHeight - list.clientHeight);
      if (reset) {
        position = 0;
        direction = 1;
        edgePauseUntil = 0;
        list.scrollTop = 0;
      } else {
        position = Math.min(list.scrollTop, maxPosition);
      }
    }

    function reset() {
      stop();
      window.clearTimeout(resumeTimer);
      window.requestAnimationFrame(() => {
        measure(true);
        start(900);
      });
    }

    function pauseForInteraction() {
      stop();
      window.clearTimeout(resumeTimer);
      position = list.scrollTop;
      start(AUTO_SCROLL_IDLE_MS);
    }

    list.addEventListener('wheel', pauseForInteraction, { passive: true });
    list.addEventListener('pointerdown', pauseForInteraction, { passive: true });
    list.addEventListener('touchstart', pauseForInteraction, { passive: true });
    list.addEventListener('keydown', event => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
        pauseForInteraction();
      }
    });

    return { measure, reset, start, stop };
  }

  for (const role of ['escape', 'hunter']) {
    autoScrollers.set(role, createAutoScroller(elements[role].list));
  }

  function stopAutoScroll() {
    for (const controller of autoScrollers.values()) controller.stop();
  }

  function startAutoScroll(delay = 0) {
    for (const controller of autoScrollers.values()) {
      controller.measure();
      controller.start(delay);
    }
  }

  function request(options = {}) {
    const url = `/api/character-stats?division=${encodeURIComponent(activeDivision)}`;
    if (window.StellaDataCache) return window.StellaDataCache.json(url, options);
    return fetch(url).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('characterStats.requestFailed', { status: response.status }));
      return payload;
    });
  }

  function mutate(url, options) {
    if (window.StellaDataCache) return window.StellaDataCache.json(url, options);
    return fetch(url, options).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('characterStats.requestFailed', { status: response.status }));
      return payload;
    });
  }

  function updateManagementAccess(profile = window.ProfileCenter?.getProfile?.()) {
    const permissions = new Set(profile?.permissions || profile?.identity?.permissions || []);
    canManageCharacters = permissions.has('characterStats.manage');
    elements.manage.hidden = !canManageCharacters;
    if (!canManageCharacters && elements.editor.dialog.open) elements.editor.dialog.close('permission-changed');
  }

  function createSkillInputs() {
    const rows = Array.from({ length: 3 }, (_, index) => {
      const slot = index + 1;
      const row = document.createElement('div');
      row.className = 'character-skill-row';
      const fields = [
        { key: 'name', label: t('characterStats.skillName', { slot }), type: 'input', maxLength: 80 },
        { key: 'description', label: t('characterStats.skillDescription', { slot }), type: 'textarea', maxLength: 2000 }
      ];
      const nameField = fields[0];
      const nameLabel = document.createElement('label');
      const nameCaption = document.createElement('span');
      nameCaption.textContent = nameField.label;
      const nameControl = document.createElement(nameField.type);
      nameControl.name = `skill-${slot}-${nameField.key}`;
      nameControl.dataset.skillSlot = String(slot);
      nameControl.dataset.skillField = nameField.key;
      nameControl.maxLength = nameField.maxLength;
      nameLabel.append(nameCaption, nameControl);

      const iconEditor = document.createElement('div');
      iconEditor.className = 'character-skill-icon-editor';
      const iconTitle = document.createElement('span');
      iconTitle.className = 'character-skill-icon-title';
      iconTitle.textContent = t('characterStats.skillIcon', { slot });
      const iconRow = document.createElement('div');
      iconRow.className = 'character-skill-icon-controls';
      const preview = document.createElement('span');
      preview.className = 'character-skill-icon-preview';
      preview.dataset.skillIconPreview = String(slot);
      const previewImage = document.createElement('img');
      previewImage.alt = '';
      previewImage.hidden = true;
      const previewFallback = document.createElement('span');
      previewFallback.textContent = String(slot);
      previewFallback.setAttribute('aria-hidden', 'true');
      preview.append(previewImage, previewFallback);
      const actions = document.createElement('span');
      actions.className = 'character-skill-icon-actions';
      const helpId = `characterSkillIconHelp${slot}`;
      const help = document.createElement('small');
      help.id = helpId;
      help.textContent = t('characterStats.skillIconHelp');
      const select = document.createElement('label');
      select.className = 'btn btn-secondary character-skill-icon-select';
      const selectText = document.createElement('span');
      selectText.textContent = t('characterStats.chooseSkillIcon');
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/png,image/jpeg,image/webp';
      fileInput.dataset.skillIconInput = String(slot);
      fileInput.setAttribute('aria-describedby', helpId);
      select.append(selectText, fileInput);
      const remove = document.createElement('button');
      remove.className = 'btn btn-secondary';
      remove.type = 'button';
      remove.dataset.skillIconRemove = String(slot);
      remove.textContent = t('characterStats.removeSkillIcon');
      remove.disabled = true;
      actions.append(select, remove, help);
      iconRow.append(preview, actions);
      iconEditor.append(iconTitle, iconRow);

      const field = fields[1];
      {
        const label = document.createElement('label');
        const caption = document.createElement('span');
        caption.textContent = field.label;
        const control = document.createElement(field.type);
        control.name = `skill-${slot}-${field.key}`;
        control.dataset.skillSlot = String(slot);
        control.dataset.skillField = field.key;
        control.maxLength = field.maxLength;
        label.append(caption, control);
        row.append(nameLabel, iconEditor, label);
      }
      return row;
    });
    elements.editor.skills.replaceChildren(...rows);
  }

  function skillValues(character) {
    const source = new Map((character?.skills || []).map((skill, index) => [Number(skill.slot || index + 1), skill]));
    skillIconDrafts.clear();
    changedSkillIcons.clear();
    for (const control of elements.editor.skills.querySelectorAll('[data-skill-slot]')) {
      const skill = source.get(Number(control.dataset.skillSlot)) || {};
      control.value = skill[control.dataset.skillField] || '';
    }
    for (let slot = 1; slot <= 3; slot += 1) {
      const skill = source.get(slot) || {};
      setSkillIconPreview(slot, skill.iconUrl || '', skill.name || '');
    }
  }

  function setSkillIconPreview(slot, source, name) {
    const preview = elements.editor.skills.querySelector(`[data-skill-icon-preview="${slot}"]`);
    const image = preview?.querySelector('img');
    const fallback = preview?.querySelector('span');
    const remove = elements.editor.skills.querySelector(`[data-skill-icon-remove="${slot}"]`);
    if (!preview || !image || !fallback || !remove) return;
    image.hidden = !source;
    fallback.hidden = Boolean(source);
    fallback.textContent = String(name || slot).trim().slice(0, 1) || String(slot);
    remove.disabled = !source;
    if (source) {
      image.src = source;
      image.alt = t('characterStats.skillIconAlt', { name: name || String(slot) });
      image.onerror = () => {
        image.hidden = true;
        fallback.hidden = false;
      };
    } else {
      image.removeAttribute('src');
      image.alt = '';
      image.onerror = null;
    }
  }

  function setPortraitPreview(source, name) {
    elements.editor.portraitPreview.hidden = !source;
    elements.editor.portraitFallback.hidden = Boolean(source);
    elements.editor.portraitFallback.textContent = String(name || '?').trim().slice(0, 1) || '?';
    if (source) {
      elements.editor.portraitPreview.src = source;
      elements.editor.portraitPreview.alt = t('characterStats.avatarAlt', { name: name || '' });
      elements.editor.portraitPreview.onerror = () => {
        elements.editor.portraitPreview.hidden = true;
        elements.editor.portraitFallback.hidden = false;
      };
    } else {
      elements.editor.portraitPreview.removeAttribute('src');
      elements.editor.portraitPreview.alt = '';
      elements.editor.portraitPreview.onerror = null;
    }
  }

  function animateEditorLayers() {
    elements.editor.body.classList.remove('is-layer-entering');
    window.requestAnimationFrame(() => elements.editor.body.classList.add('is-layer-entering'));
  }

  function createChangeDraft(focusTitle = true) {
    if (elements.editor.changeDrafts.children.length >= 12) {
      elements.editor.status.textContent = t('characterStats.changeDraftLimit');
      elements.editor.status.className = 'character-editor-status is-error';
      return;
    }
    changeDraftCounter += 1;
    const index = changeDraftCounter;
    const card = document.createElement('article');
    card.className = 'character-change-draft';
    card.dataset.changeDraft = String(index);

    const header = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = t('characterStats.changeDraft', { index: elements.editor.changeDrafts.children.length + 1 });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.changeDraftRemove = String(index);
    remove.setAttribute('aria-label', t('characterStats.removeChangeDraft', { index: elements.editor.changeDrafts.children.length + 1 }));
    remove.textContent = '×';
    header.append(heading, remove);

    const fields = document.createElement('div');
    const definitions = [
      { key: 'date', label: t('characterStats.changeDate'), type: 'date', maxLength: 10 },
      { key: 'title', label: t('characterStats.changeTitle'), type: 'text', maxLength: 120 },
      { key: 'content', label: t('characterStats.changeContent'), type: 'textarea', maxLength: 4000 }
    ];
    for (const definition of definitions) {
      const label = document.createElement('label');
      label.className = definition.key === 'content' ? 'is-wide' : '';
      const caption = document.createElement('span');
      caption.textContent = definition.label;
      const control = document.createElement(definition.type === 'textarea' ? 'textarea' : 'input');
      control.id = `characterChangeDraft${index}${definition.key}`;
      control.dataset.changeDraftField = definition.key;
      control.required = true;
      control.maxLength = definition.maxLength;
      control.setAttribute('aria-describedby', 'characterChangeDraftHelp');
      if (control instanceof HTMLInputElement) control.type = definition.type;
      if (definition.key === 'date') control.value = new Date().toLocaleDateString('sv-SE');
      label.append(caption, control);
      fields.append(label);
    }
    card.append(header, fields);
    elements.editor.changeDrafts.append(card);
    elements.editor.status.textContent = '';
    elements.editor.status.className = 'character-editor-status';
    if (focusTitle) card.querySelector('[data-change-draft-field="title"]').focus();
  }

  function clearChangeDrafts() {
    elements.editor.changeDrafts.replaceChildren();
  }

  function renderExistingChanges(character) {
    const changes = Array.isArray(character?.changes) ? character.changes : [];
    if (!changes.length) {
      elements.editor.existingChanges.replaceChildren();
      return;
    }
    const heading = document.createElement('small');
    heading.className = 'character-existing-changes-heading';
    heading.textContent = t('characterStats.existingChangeRecords', { count: changes.length });
    const list = document.createElement('div');
    list.className = 'character-existing-changes-list';
    changes.forEach(change => {
      const card = document.createElement('article');
      card.className = 'character-existing-change-card';
      const time = document.createElement('time');
      time.dateTime = change.date || '';
      time.textContent = change.date ? change.date.replaceAll('-', '.') : t('characterStats.noRecord');
      const title = document.createElement('strong');
      title.textContent = change.title || t('characterStats.noRecord');
      const content = document.createElement('p');
      content.textContent = change.content || t('characterStats.changeDetailUnavailable');
      card.append(time, title, content);
      list.append(card);
    });
    elements.editor.existingChanges.replaceChildren(heading, list);
  }

  function renumberChangeDrafts() {
    [...elements.editor.changeDrafts.querySelectorAll('[data-change-draft]')].forEach((card, index) => {
      const number = index + 1;
      card.querySelector('strong').textContent = t('characterStats.changeDraft', { index: number });
      card.querySelector('[data-change-draft-remove]')
        .setAttribute('aria-label', t('characterStats.removeChangeDraft', { index: number }));
    });
  }

  function renderManagerList(animate = false) {
    let itemIndex = 0;
    const groups = ['escape', 'hunter'].map(role => {
      const group = document.createElement('section');
      group.className = 'character-manager-group';
      const label = document.createElement('span');
      label.textContent = role === 'escape' ? t('characterStats.escapeSide') : t('characterStats.hunterSide');
      group.append(label);
      managedCharacters.filter(character => character.role === role).forEach(character => {
        const button = document.createElement('button');
        button.className = 'character-manager-item';
        if (animate && !motionPreference.matches) {
          button.classList.add('is-entering');
          button.style.setProperty('--character-manager-delay', `${Math.min(itemIndex, 18) * 24}ms`);
        }
        itemIndex += 1;
        button.type = 'button';
        button.dataset.characterId = character.id;
        button.setAttribute('aria-current', String(editingCharacter?.id === character.id));
        const image = document.createElement('img');
        image.src = character.imageUrl;
        image.alt = '';
        image.addEventListener('error', () => {
          const fallback = document.createElement('span');
          fallback.className = 'character-manager-avatar-fallback';
          fallback.textContent = String(character.nickname || character.id).slice(0, 1);
          image.replaceWith(fallback);
        }, { once: true });
        const name = document.createElement('strong');
        name.textContent = character.nickname || character.id;
        button.append(image, name);
        button.addEventListener('click', () => populateEditor(character, button));
        group.append(button);
      });
      return group;
    });
    elements.editor.list.replaceChildren(...groups);
  }

  function populateEditor(character = null, focusTarget = null, animateList = false) {
    const focusCharacterId = focusTarget?.dataset?.characterId || '';
    editingCharacter = character;
    portraitDraft = null;
    portraitChanged = false;
    elements.editor.mode.textContent = character
      ? t('characterStats.editingCharacter')
      : t('characterStats.creatingCharacter');
    elements.editor.characterName.textContent = character?.nickname || character?.id || t('characterStats.creatingCharacter');
    elements.editor.id.value = character?.id || '';
    elements.editor.role.value = character?.role || 'escape';
    elements.editor.nickname.value = character?.nickname || character?.id || '';
    elements.editor.name.value = character?.name || '';
    elements.editor.releaseDate.value = character?.releaseDate || '';
    setPortraitPreview(character?.imageUrl || '', character?.nickname || character?.name || '');
    elements.editor.portraitRemove.disabled = !character?.imageUrl;
    skillValues(character);
    clearChangeDrafts();
    renderExistingChanges(character);
    elements.editor.delete.hidden = !character;
    elements.editor.status.textContent = '';
    elements.editor.status.className = 'character-editor-status';
    elements.editor.nickname.removeAttribute('aria-invalid');
    elements.editor.name.removeAttribute('aria-invalid');
    renderManagerList(animateList);
    animateEditorLayers();
    const refreshedFocusTarget = focusCharacterId
      ? elements.editor.list.querySelector(`[data-character-id="${CSS.escape(focusCharacterId)}"]`)
      : focusTarget;
    if (refreshedFocusTarget instanceof HTMLElement && refreshedFocusTarget.isConnected) refreshedFocusTarget.focus();
  }

  function openManager(trigger = document.activeElement) {
    if (!canManageCharacters) return;
    editorTrigger = trigger instanceof HTMLElement ? trigger : null;
    if (elements.detail.dialog.open) elements.detail.dialog.close();
    populateEditor(selectedCharacter || managedCharacters[0] || null, null, true);
    elements.editor.dialog.showModal();
    window.requestAnimationFrame(() => elements.editor.list.querySelector('[aria-current="true"]')?.focus()
      || elements.editor.create.focus());
  }

  function readEditorImage(file, maximumBytes, invalidKey, tooLargeKey) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      return Promise.reject(new Error(t(invalidKey)));
    }
    if (file.size > maximumBytes) {
      return Promise.reject(new Error(t(tooLargeKey)));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result || '')));
      reader.addEventListener('error', () => reject(reader.error || new Error(t(invalidKey))));
      reader.readAsDataURL(file);
    });
  }

  function editorPayload() {
    return {
      role: elements.editor.role.value,
      nickname: elements.editor.nickname.value.trim(),
      displayName: elements.editor.name.value.trim(),
      releaseDate: elements.editor.releaseDate.value.trim(),
      skills: Array.from({ length: 3 }, (_, index) => {
        const slot = index + 1;
        const value = field => elements.editor.skills.querySelector(`[data-skill-slot="${slot}"][data-skill-field="${field}"]`).value.trim();
        return {
          slot,
          name: value('name'),
          description: value('description'),
          ...(changedSkillIcons.has(slot)
            ? { iconChanged: true, icon: skillIconDrafts.get(slot) || null }
            : {})
        };
      }),
      changesToAdd: [...elements.editor.changeDrafts.querySelectorAll('[data-change-draft]')].map(card => ({
        date: card.querySelector('[data-change-draft-field="date"]').value,
        title: card.querySelector('[data-change-draft-field="title"]').value.trim(),
        content: card.querySelector('[data-change-draft-field="content"]').value.trim()
      })),
      ...(portraitChanged ? { portraitChanged: true, portrait: portraitDraft } : {})
    };
  }

  async function saveEditor() {
    if (!elements.editor.form.reportValidity()) return;
    const payload = editorPayload();
    elements.editor.form.setAttribute('aria-busy', 'true');
    elements.editor.save.disabled = true;
    elements.editor.delete.disabled = true;
    elements.editor.status.textContent = '';
    try {
      const url = editingCharacter
        ? `/api/admin/characters/${encodeURIComponent(editingCharacter.id)}`
        : '/api/admin/characters';
      const result = await mutate(url, {
        method: editingCharacter ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const message = editingCharacter ? t('characterStats.updateSuccess') : t('characterStats.createSuccess');
      await load(true);
      populateEditor(managedCharacters.find(character => character.id === result.character.id) || null);
      elements.editor.status.textContent = message;
      elements.editor.status.className = 'character-editor-status is-success';
    } catch (error) {
      elements.editor.status.textContent = t('characterStats.saveFailed', { error: error.message });
      const changeTitle = elements.editor.changeDrafts.querySelector('[data-change-draft-field="title"]');
      const focusTarget = changeTitle || elements.editor.name;
      focusTarget.setAttribute('aria-invalid', 'true');
      focusTarget.focus();
    } finally {
      elements.editor.form.removeAttribute('aria-busy');
      elements.editor.save.disabled = false;
      elements.editor.delete.disabled = false;
    }
  }

  async function deleteCharacter() {
    if (!editingCharacter) return;
    const confirmed = await window.StellaDialog.confirm({
      title: t('characterStats.deleteConfirmTitle'),
      message: t('characterStats.deleteConfirm', { name: editingCharacter.nickname || editingCharacter.id }),
      confirmText: t('characterStats.deleteCharacter'),
      tone: 'danger'
    });
    if (!confirmed) return;
    elements.editor.form.setAttribute('aria-busy', 'true');
    elements.editor.delete.disabled = true;
    try {
      await mutate(`/api/admin/characters/${encodeURIComponent(editingCharacter.id)}`, { method: 'DELETE' });
      await load(true);
      populateEditor(managedCharacters[0] || null);
      elements.editor.status.textContent = t('characterStats.deleteSuccess');
      elements.editor.status.className = 'character-editor-status is-success';
    } catch (error) {
      elements.editor.status.textContent = t('characterStats.deleteFailed', { error: error.message });
    } finally {
      elements.editor.form.removeAttribute('aria-busy');
      elements.editor.delete.disabled = false;
    }
  }

  function percentage(value) {
    return `${(Number(value || 0) * 100).toFixed(1)}%`;
  }

  function dateTime(value, fallback) {
    if (!value) return fallback;
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date(value));
  }

  function fullDateTime(value, fallback = t('characterStats.noRecord')) {
    if (!value) return fallback;
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(value));
  }

  function metric(label, value, className = '') {
    const cell = document.createElement('span');
    cell.className = `character-rank-metric ${className}`.trim();
    cell.dataset.label = label;
    cell.textContent = value;
    return cell;
  }

  function rankItem(character, index, total, role, animate) {
    const item = document.createElement('li');
    item.className = 'character-rank-item';
    const alpha = Math.max(0.035, 0.16 - (index / Math.max(total - 1, 1)) * 0.125);
    item.style.setProperty('--character-rank-surface', role === 'escape'
      ? `rgba(52, 169, 236, ${alpha.toFixed(3)})`
      : `rgba(209, 52, 56, ${alpha.toFixed(3)})`);
    if (index < 3) item.classList.add(`is-top-${index + 1}`);
    if (animate && !motionPreference.matches) {
      item.classList.add('is-entering');
      item.style.setProperty('--character-rank-delay', `${Math.min(index, 14) * 90}ms`);
      const onEntryEnd = event => {
        if (event.target !== item || event.animationName !== 'character-rank-in') return;
        item.classList.remove('is-entering');
        item.style.removeProperty('--character-rank-delay');
        item.removeEventListener('animationend', onEntryEnd);
      };
      item.addEventListener('animationend', onEntryEnd);
    }

    const button = document.createElement('button');
    button.className = 'character-rank-button';
    button.type = 'button';
    button.setAttribute('aria-label', t('characterStats.viewDetails', { name: character.nickname || character.id }));
    button.addEventListener('click', () => openDetail(character));

    const identity = document.createElement('span');
    identity.className = 'character-rank-identity';
    const rank = document.createElement('strong');
    rank.className = 'character-rank-number';
    rank.textContent = String(character.rank).padStart(2, '0');
    const avatar = document.createElement('span');
    avatar.className = 'character-rank-avatar';
    const image = document.createElement('img');
    image.src = character.imageUrl;
    image.alt = '';
    image.loading = index > 5 ? 'lazy' : 'eager';
    image.addEventListener('error', () => {
      avatar.classList.add('is-missing');
      image.hidden = true;
    }, { once: true });
    const name = document.createElement('strong');
    name.className = 'character-rank-name';
    name.textContent = character.nickname || character.id;
    avatar.append(image);
    identity.append(rank, avatar, name);

    button.append(
      identity,
      metric(t('characterStats.score'), (Number(character.score || 0) * 100).toFixed(1), 'is-score'),
      metric(t('characterStats.usageRate'), percentage(character.usageRate)),
      metric(t('characterStats.banRate'), percentage(character.banRate)),
      metric(t('characterStats.winRate'), percentage(character.winRate)),
      metric(t('characterStats.uses'), String(character.uses || 0)),
      metric(t('characterStats.bans'), String(character.bans || 0))
    );
    item.append(button);
    return item;
  }

  function emptyLine(text = t('characterStats.noRecord')) {
    const line = document.createElement('span');
    line.className = 'character-detail-empty';
    line.textContent = text;
    return line;
  }

  function teamRow(team, count = null, featured = false) {
    const row = document.createElement('div');
    row.className = 'character-team-row';
    row.classList.toggle('is-featured', featured);
    const logoFrame = document.createElement('span');
    logoFrame.className = 'character-team-logo-frame';
    if (team?.logoUrl) {
      const logo = document.createElement('img');
      logo.src = team.logoUrl;
      logo.alt = '';
      logo.addEventListener('error', () => {
        const placeholder = document.createElement('span');
        placeholder.className = 'character-team-logo-placeholder';
        placeholder.textContent = team?.name?.slice(0, 1) || '?';
        logo.replaceWith(placeholder);
      }, { once: true });
      logoFrame.append(logo);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'character-team-logo-placeholder';
      placeholder.textContent = team?.name?.slice(0, 1) || '?';
      logoFrame.append(placeholder);
    }
    row.append(logoFrame);
    const identity = document.createElement('span');
    identity.className = 'character-team-identity';
    if (featured) {
      const label = document.createElement('small');
      label.textContent = t('characterStats.latestTeam');
      identity.append(label);
    }
    const name = document.createElement('strong');
    name.textContent = team?.name || t('characterStats.unknownTeam');
    identity.append(name);
    row.append(identity);
    if (count !== null) {
      const value = document.createElement('span');
      value.textContent = t('characterStats.count', { count });
      row.append(value);
    }
    return row;
  }

  function renderSkills(character) {
    collapseSkills();
    const skills = Array.from({ length: 3 }, (_, index) => character.skills?.[index] || {
      id: `${character.id}-skill-${index + 1}`, name: null, description: null
    });
    const buttons = skills.map((skill, index) => {
      const button = document.createElement('button');
      button.className = 'character-skill-button';
      button.type = 'button';
      button.dataset.skillId = skill.id;
      button.setAttribute('aria-expanded', 'false');
      const icon = document.createElement('span');
      icon.className = 'character-skill-icon';
      if (skill.iconUrl) {
        const image = document.createElement('img');
        image.src = skill.iconUrl;
        image.alt = '';
        image.addEventListener('error', () => {
          icon.textContent = String(index + 1);
        }, { once: true });
        icon.append(image);
      } else {
        icon.textContent = String(index + 1);
      }
      const label = document.createElement('span');
      label.className = 'character-skill-label';
      label.textContent = skill.name || t('characterStats.profilePending');
      button.append(icon, label);
      button.addEventListener('click', () => {
        if (selectedSkillId === skill.id) return;
        selectedSkillId = skill.id;
        elements.detail.skillBox.classList.add('is-expanded');
        elements.detail.skillDescription.hidden = false;
        for (const option of elements.detail.skillOptions.children) {
          const selected = option.dataset.skillId === selectedSkillId;
          option.hidden = !selected;
          option.classList.toggle('is-selected', selected);
          option.setAttribute('aria-expanded', String(selected));
        }
        elements.detail.skillName.textContent = skill.name || t('characterStats.skillPending');
        elements.detail.skillCopy.textContent = skill.description || t('characterStats.skillDescriptionPending');
      });
      return button;
    });
    elements.detail.skillOptions.replaceChildren(...buttons);
  }

  function collapseSkills() {
    selectedSkillId = null;
    elements.detail.skillBox.classList.remove('is-expanded');
    elements.detail.skillDescription.hidden = true;
    for (const option of elements.detail.skillOptions.children) {
      option.hidden = false;
      option.classList.remove('is-selected');
      option.setAttribute('aria-expanded', 'false');
    }
  }

  function renderChangePage() {
    const pageCount = Math.max(1, Math.ceil(activeChanges.length / CHANGES_PER_PAGE));
    changePageIndex = Math.min(changePageIndex, pageCount - 1);
    const changes = activeChanges.slice(
      changePageIndex * CHANGES_PER_PAGE,
      (changePageIndex + 1) * CHANGES_PER_PAGE
    );
    if (!changes.length) {
      elements.detail.changeHistory.replaceChildren(emptyLine());
    } else {
      const columnCount = 3;
      const itemsPerColumn = Math.ceil(changes.length / columnCount);
      const columns = Array.from({ length: columnCount }, (_, columnIndex) => {
        const column = document.createElement('div');
        column.className = 'character-change-column';
        changes.slice(columnIndex * itemsPerColumn, (columnIndex + 1) * itemsPerColumn).forEach(change => {
          const card = document.createElement('button');
          card.className = 'character-change-card';
          card.type = 'button';
          card.setAttribute('aria-haspopup', 'dialog');
          card.setAttribute('aria-label', t('characterStats.viewChangeDetail', {
            date: change.date || t('characterStats.noRecord'),
            title: change.title || t('characterStats.noRecord')
          }));
          const time = document.createElement('time');
          time.dateTime = change.date || '';
          time.textContent = change.date ? change.date.replaceAll('-', '.') : t('characterStats.noRecord');
          const title = document.createElement('strong');
          title.textContent = change.title || t('characterStats.noRecord');
          card.append(time, title);
          card.addEventListener('click', () => openChangeDetail(change, card));
          column.append(card);
        });
        return column;
      });
      elements.detail.changeHistory.replaceChildren(...columns);
    }
    elements.detail.changePagination.hidden = pageCount <= 1;
    elements.detail.changePrevious.disabled = changePageIndex === 0;
    elements.detail.changeNext.disabled = changePageIndex >= pageCount - 1;
    elements.detail.changePage.textContent = t('characterStats.changePage', {
      current: changePageIndex + 1,
      total: pageCount
    });
  }

  function openChangeDetail(change, trigger) {
    changeDialogTrigger = trigger;
    elements.detail.changeDialog.classList.toggle('is-hunter', selectedCharacter?.role === 'hunter');
    elements.detail.changeDialogTitle.textContent = change.title || t('characterStats.noRecord');
    elements.detail.changeDialogDate.dateTime = change.date || '';
    elements.detail.changeDialogDate.textContent = change.date
      ? change.date.replaceAll('-', '.')
      : t('characterStats.noRecord');
    elements.detail.changeDialogContent.textContent = change.content
      || t('characterStats.changeDetailUnavailable');
    elements.detail.changeDialog.showModal();
    elements.detail.changeDialogClose.focus();
  }

  function renderChanges(character) {
    activeChanges = Array.isArray(character.changes) ? character.changes : [];
    changePageIndex = 0;
    renderChangePage();
  }

  function renderUsage(character) {
    const usage = character.usage || {};
    elements.detail.latestTeam.replaceChildren(usage.latestTeam
      ? teamRow(usage.latestTeam, null, true)
      : emptyLine());
    elements.detail.latestPlayer.textContent = usage.latestPlayer
      ? `${usage.latestPlayer.nickname || t('characterStats.unknownPlayer')}${usage.latestPlayer.officialId ? ` · ${usage.latestPlayer.officialId}` : ''}`
      : t('characterStats.noRecord');
    elements.detail.latestMatch.textContent = usage.latestMatch?.matchupLabel
      || (usage.latestMatch ? t('characterStats.matchupPending') : t('characterStats.noRecord'));
    if (usage.latestMatch) {
      elements.detail.latestMatch.dataset.tooltip = t('characterStats.matchTooltip', {
        event: usage.latestMatch.eventName || t('characterStats.noRecord'),
        stage: usage.latestMatch.stageName || t('characterStats.noRecord'),
        game: usage.latestMatch.gameNumber,
        room: usage.latestMatch.room,
        replay: usage.latestMatch.attempt > 1
          ? t('characterStats.replaySuffix', { attempt: usage.latestMatch.attempt - 1 })
          : ''
      });
      elements.detail.latestMatch.tabIndex = 0;
      elements.detail.latestMatch.classList.add('has-tooltip');
    } else {
      elements.detail.latestMatch.removeAttribute('data-tooltip');
      elements.detail.latestMatch.removeAttribute('tabindex');
      elements.detail.latestMatch.classList.remove('has-tooltip');
    }
    elements.detail.latestUsedAt.textContent = fullDateTime(usage.latestUsedAt);
    renderChanges(character);

    elements.detail.commonTeams.replaceChildren(...((usage.commonTeams || []).length
      ? usage.commonTeams.map(team => teamRow(team, team.count))
      : [emptyLine()]));
    elements.detail.commonPlayers.replaceChildren(...((usage.commonPlayers || []).length
      ? usage.commonPlayers.map(player => {
        const row = document.createElement('div');
        row.className = 'character-player-row';
        const name = document.createElement('strong');
        name.textContent = player.nickname || t('characterStats.unknownPlayer');
        const count = document.createElement('span');
        count.textContent = t('characterStats.count', { count: player.count });
        row.append(name, count);
        return row;
      })
      : [emptyLine()]));
    elements.detail.recentResults.replaceChildren(...((usage.recentResults || []).length
      ? usage.recentResults.map(result => {
        const row = document.createElement('div');
        row.className = 'character-result-row';
        const outcome = document.createElement('strong');
        outcome.className = result.won ? 'is-win' : 'is-loss';
        outcome.textContent = result.won ? t('characterStats.win') : t('characterStats.loss');
        const copy = document.createElement('span');
        copy.textContent = t('characterStats.resultRecord', {
          lead: result.matchupLabel || result.eventName || t('characterStats.eventRecord'),
          game: result.gameNumber,
          room: result.room
        });
        const time = document.createElement('time');
        time.textContent = fullDateTime(result.decidedAt);
        row.append(outcome, copy, time);
        return row;
      })
      : [emptyLine()]));
  }

  function openDetail(character) {
    selectedCharacter = character;
    elements.detail.dialog.classList.toggle('is-hunter', character.role === 'hunter');
    elements.detail.avatar.src = character.imageUrl;
    elements.detail.avatar.alt = t('characterStats.avatarAlt', { name: character.nickname || character.id });
    elements.detail.avatar.hidden = false;
    elements.detail.avatar.onerror = () => { elements.detail.avatar.hidden = true; };
    elements.detail.role.textContent = character.role === 'escape'
      ? t('characterStats.escapeRole')
      : t('characterStats.hunterRole');
    elements.detail.title.textContent = character.nickname || character.id;
    elements.detail.name.textContent = character.name || t('characterStats.profilePending');
    elements.detail.releaseDate.textContent = character.releaseDate || t('characterStats.profilePending');
    elements.detail.rank.textContent = character.rank ? `#${character.rank}` : '—';
    elements.detail.score.textContent = (Number(character.score || 0) * 100).toFixed(1);
    elements.detail.usageRate.textContent = percentage(character.usageRate);
    elements.detail.banRate.textContent = percentage(character.banRate);
    elements.detail.winRate.textContent = percentage(character.winRate);
    renderSkills(character);
    renderUsage(character);
    if (!elements.detail.dialog.open) elements.detail.dialog.showModal();
  }

  function renderRole(role, payload) {
    const target = elements[role];
    const characters = payload?.characters || [];
    const signature = characters.map(character => character.id).join('|');
    const animate = !roleOrderSignatures[role] || roleOrderSignatures[role] !== signature;
    roleOrderSignatures[role] = signature;
    target.picks.textContent = String(payload?.totalPicks || 0);
    target.bans.textContent = String(payload?.totalBans || 0);
    target.list.replaceChildren(...characters.map((character, index) => rankItem(character, index, characters.length, role, animate)));
    autoScrollers.get(role).reset();
  }

  function render(stats) {
    elements.games.textContent = String(stats.sample?.effectiveGames || 0);
    elements.decidedAt.textContent = dateTime(stats.sample?.decidedAt, t('characterStats.noResult'));
    elements.updatedAt.textContent = dateTime(stats.generatedAt, t('characterStats.loading'));
    renderRole('escape', stats.roles?.escape);
    renderRole('hunter', stats.roles?.hunter);
    managedCharacters = [
      ...(stats.roles?.escape?.characters || []),
      ...(stats.roles?.hunter?.characters || [])
    ];
    if (elements.editor.dialog.open) renderManagerList();
    elements.status.textContent = '';
    page.setAttribute('aria-busy', 'false');
    initialized = true;
  }

  async function load(force = false) {
    const sequence = ++loadSequence;
    try {
      const stats = await request({ force });
      if (sequence !== loadSequence) return;
      render(stats);
    } catch (error) {
      if (sequence !== loadSequence) return;
      page.setAttribute('aria-busy', 'false');
      elements.status.textContent = t('characterStats.loadFailed', { error: error.message });
    }
  }

  function selectDivision(division) {
    if (division === activeDivision) return;
    activeDivision = division;
    roleOrderSignatures.escape = '';
    roleOrderSignatures.hunter = '';
    for (const button of elements.divisionSwitch.querySelectorAll('[data-division]')) {
      button.setAttribute('aria-pressed', String(button.dataset.division === division));
    }
    page.setAttribute('aria-busy', 'true');
    elements.status.textContent = t('characterStats.refreshing');
    load(false);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = 0;
      if (active) load(true);
    }, 220);
  }

  function connectEvents() {
    events?.close();
    events = new EventSource('/api/bp/events');
    events.addEventListener('session', event => {
      const payload = JSON.parse(event.data);
      if (relevantReasons.has(payload.reason)) scheduleRefresh();
    });
  }

  function activate() {
    active = true;
    document.body.classList.add('character-stats-mode');
    load(initialized);
    connectEvents();
    startAutoScroll(900);
  }

  function deactivate() {
    active = false;
    document.body.classList.remove('character-stats-mode');
    stopAutoScroll();
    clearTimeout(refreshTimer);
    refreshTimer = 0;
    events?.close();
    events = null;
  }

  window.addEventListener('stella:page-change', event => {
    if (event.detail?.page === 'characterStats') activate();
    else if (active) deactivate();
  });
  window.addEventListener('stella:identity-change', event => updateManagementAccess(event.detail));
  window.addEventListener('stella:permissions-change', () => {
    window.ProfileCenter?.refresh?.().then(updateManagementAccess).catch(() => updateManagementAccess());
  });
  window.addEventListener('beforeunload', deactivate);
  window.addEventListener('resize', () => startAutoScroll(250));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAutoScroll();
    else if (active) startAutoScroll(900);
  });
  motionPreference.addEventListener('change', () => {
    if (motionPreference.matches) stopAutoScroll();
    else if (active) startAutoScroll(900);
  });
  elements.detail.close.addEventListener('click', () => elements.detail.dialog.close());
  elements.detail.changeDialogClose.addEventListener('click', () => elements.detail.changeDialog.close());
  elements.detail.changeDialog.addEventListener('click', event => {
    if (event.target === elements.detail.changeDialog) elements.detail.changeDialog.close();
  });
  elements.detail.changeDialog.addEventListener('close', () => {
    if (changeDialogTrigger && document.contains(changeDialogTrigger)) changeDialogTrigger.focus();
    changeDialogTrigger = null;
  });
  elements.manage.addEventListener('click', event => openManager(event.currentTarget));
  elements.editor.create.addEventListener('click', () => populateEditor(null, elements.editor.nickname));
  elements.editor.portraitInput.addEventListener('change', async event => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    elements.editor.status.textContent = '';
    elements.editor.status.className = 'character-editor-status';
    try {
      portraitDraft = await readEditorImage(
        file,
        2 * 1024 * 1024,
        'characterStats.invalidPortrait',
        'characterStats.portraitTooLarge'
      );
      portraitChanged = true;
      setPortraitPreview(portraitDraft, elements.editor.name.value);
      elements.editor.portraitRemove.disabled = false;
    } catch (error) {
      elements.editor.status.textContent = error.message;
      elements.editor.status.className = 'character-editor-status is-error';
      elements.editor.portraitInput.focus();
    }
  });
  elements.editor.portraitRemove.addEventListener('click', () => {
    portraitDraft = null;
    portraitChanged = true;
    setPortraitPreview('', elements.editor.name.value);
    elements.editor.portraitRemove.disabled = true;
  });
  elements.editor.skills.addEventListener('change', async event => {
    const input = event.target.closest('[data-skill-icon-input]');
    if (!input) return;
    const slot = Number(input.dataset.skillIconInput);
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    elements.editor.status.textContent = '';
    try {
      const draft = await readEditorImage(
        file,
        512 * 1024,
        'characterStats.invalidSkillIcon',
        'characterStats.skillIconTooLarge'
      );
      skillIconDrafts.set(slot, draft);
      changedSkillIcons.add(slot);
      const name = elements.editor.skills.querySelector(`[data-skill-slot="${slot}"][data-skill-field="name"]`).value;
      setSkillIconPreview(slot, draft, name);
      elements.editor.status.textContent = t('characterStats.skillIconSelected', { slot });
      elements.editor.status.className = 'character-editor-status is-success';
    } catch (error) {
      elements.editor.status.textContent = error.message;
      elements.editor.status.className = 'character-editor-status is-error';
      input.focus();
    }
  });
  elements.editor.skills.addEventListener('click', event => {
    const remove = event.target.closest('[data-skill-icon-remove]');
    if (!remove) return;
    const slot = Number(remove.dataset.skillIconRemove);
    skillIconDrafts.set(slot, null);
    changedSkillIcons.add(slot);
    const name = elements.editor.skills.querySelector(`[data-skill-slot="${slot}"][data-skill-field="name"]`).value;
    setSkillIconPreview(slot, '', name);
    elements.editor.status.textContent = t('characterStats.skillIconRemoved', { slot });
    elements.editor.status.className = 'character-editor-status is-success';
  });
  elements.editor.skills.addEventListener('input', event => {
    const input = event.target.closest('[data-skill-field="name"]');
    if (!input) return;
    const slot = Number(input.dataset.skillSlot);
    const preview = elements.editor.skills.querySelector(`[data-skill-icon-preview="${slot}"]`);
    if (preview?.querySelector('img')?.hidden) {
      preview.querySelector('span').textContent = input.value.trim().slice(0, 1) || String(slot);
    }
  });
  elements.editor.changeDraftAdd.addEventListener('click', () => createChangeDraft(true));
  elements.editor.changeDrafts.addEventListener('click', event => {
    const remove = event.target.closest('[data-change-draft-remove]');
    if (!remove) return;
    const card = remove.closest('[data-change-draft]');
    const previous = card?.previousElementSibling?.querySelector('[data-change-draft-field="title"]');
    card?.remove();
    renumberChangeDrafts();
    elements.editor.status.textContent = t('characterStats.changeDraftRemoved');
    elements.editor.status.className = 'character-editor-status is-success';
    (previous || elements.editor.changeDraftAdd).focus();
  });
  elements.editor.nickname.addEventListener('input', () => {
    elements.editor.characterName.textContent = elements.editor.nickname.value.trim()
      || t('characterStats.creatingCharacter');
    elements.editor.nickname.removeAttribute('aria-invalid');
  });
  elements.editor.name.addEventListener('input', () => {
    if (!elements.editor.portraitPreview.hasAttribute('src')) {
      elements.editor.portraitFallback.textContent = elements.editor.nickname.value.trim().slice(0, 1)
        || elements.editor.name.value.trim().slice(0, 1) || '?';
    }
    elements.editor.name.removeAttribute('aria-invalid');
  });
  elements.editor.close.addEventListener('click', () => elements.editor.dialog.close('cancel'));
  elements.editor.cancel.addEventListener('click', () => elements.editor.dialog.close('cancel'));
  elements.editor.form.addEventListener('submit', event => {
    event.preventDefault();
    saveEditor();
  });
  elements.editor.delete.addEventListener('click', deleteCharacter);
  elements.editor.dialog.addEventListener('click', event => {
    if (event.target !== elements.editor.dialog) return;
    const bounds = elements.editor.dialog.getBoundingClientRect();
    const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
      && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    if (!inside) elements.editor.dialog.close('cancel');
  });
  elements.editor.dialog.addEventListener('close', () => {
    editingCharacter = null;
    if (editorTrigger && document.contains(editorTrigger)) editorTrigger.focus();
    editorTrigger = null;
    startAutoScroll(1200);
  });
  elements.detail.skillCollapse.addEventListener('click', () => {
    collapseSkills();
    elements.detail.skillOptions.querySelector('button')?.focus();
  });
  elements.detail.changePrevious.addEventListener('click', () => {
    if (changePageIndex === 0) return;
    changePageIndex -= 1;
    renderChangePage();
  });
  elements.detail.changeNext.addEventListener('click', () => {
    if ((changePageIndex + 1) * CHANGES_PER_PAGE >= activeChanges.length) return;
    changePageIndex += 1;
    renderChangePage();
  });
  elements.detail.dialog.addEventListener('click', event => {
    if (event.target === elements.detail.dialog) elements.detail.dialog.close();
  });
  elements.detail.dialog.addEventListener('close', () => startAutoScroll(1200));
  elements.divisionSwitch.addEventListener('click', event => {
    const button = event.target.closest('[data-division]');
    if (button) selectDivision(button.dataset.division);
  });
  createSkillInputs();
  window.ProfileCenter?.ready?.then(updateManagementAccess).catch(() => updateManagementAccess());
  updateManagementAccess();
  if (active) activate();
})();
