(function () {
  const $ = id => document.getElementById(id);
  const elements = {
    scheduleDate: $('bpScheduleDate'), division: $('bpDivision'), match: $('bpMatch'),
    game: $('bpGame'), room: $('bpRoom'), attempt: $('bpAttempt'),
    load: $('bpLoad'), loadAndSwitch: $('bpLoadAndSwitch'), start: $('bpStart'), complete: $('bpComplete'), switchBpScene: $('bpSwitchScene'),
    sync: $('bpSync'), export: $('bpExport'), replay: $('bpReplay'), reset: $('bpReset'),
    commentatorImage: $('bpCommentatorImage'), commentatorStatus: $('bpCommentatorStatus'),
    commentatorLogo: $('bpCommentatorLogo'), commentatorLogoStatus: $('bpCommentatorLogoStatus'),
    dynamicBpEnabled: $('dynamicBpEnabled'), dynamicBpStatus: $('dynamicBpStatus'),
    forfeit: $('bpForfeit'), revokeForfeit: $('bpRevokeForfeit'), forfeitStatus: $('bpForfeitStatus'),
    escapeLogo: $('escapeTeamLogo'), escapeName: $('escapeTeamName'),
    hunterLogo: $('hunterTeamLogo'), hunterName: $('hunterTeamName'),
    phaseLabel: $('bpPhaseLabel'), clock: $('bpClock'), recordLabel: $('bpRecordLabel'), phases: $('bpPhases'),
    banSlots: $('banSlots'), hunterSlots: $('hunterPickSlots'), escapeSlots: $('escapePickSlots'),
    history: $('bpHistory'), log: $('bpLog'), obsStatus: $('obsStatus'),
    obsUrl: $('obsUrl'), obsPassword: $('obsPassword'), obsConnect: $('obsConnect'),
    resultPanel: $('bpResultPanel'), resultEscape: $('resultEscape'), resultHunter: $('resultHunter'),
    scoreLabel: $('bpScoreLabel'), nextGame: $('bpNextGame'),
    resetDialog: $('resetDialog'), cancelReset: $('cancelReset'), confirmReset: $('confirmReset'),
    completeDialog: $('completeDialog'), cancelComplete: $('cancelComplete'), confirmComplete: $('confirmComplete'),
    forfeitDialog: $('forfeitDialog'), forfeitTeamOptions: $('forfeitTeamOptions'), cancelForfeit: $('cancelForfeit'), continueForfeit: $('continueForfeit'),
    forfeitConfirmDialog: $('forfeitConfirmDialog'), forfeitConfirmText: $('forfeitConfirmText'), cancelForfeitConfirm: $('cancelForfeitConfirm'), confirmForfeit: $('confirmForfeit'),
    revokeForfeitDialog: $('revokeForfeitDialog'), revokeForfeitText: $('revokeForfeitText'), cancelRevokeForfeit: $('cancelRevokeForfeit'), confirmRevokeForfeit: $('confirmRevokeForfeit'),
    imageDialog: $('resultImageDialog'), imageDropZone: $('resultImageDropZone'), imageInput: $('resultImageInput'),
    imagePreview: $('resultImagePreview'), closeImage: $('closeResultImage'), clearImage: $('clearResultImage'), keepImage: $('keepResultImage'),
    dialog: $('characterDialog'), dialogTitle: $('characterDialogTitle'), dialogRole: $('characterDialogRole'),
    characterSearch: $('characterSearch'), characterGrid: $('characterGrid'), closeDialog: $('closeCharacterDialog')
  };

  let bootstrap = null;
  let session = null;
  let pickerSlotId = null;
  let events = null;
  let lastFocusedPhase = null;
  let resultImageUrl = null;
  let resultImageFile = null;
  let preparingBp = false;
  let dynamicBp = null;
  let updatingDynamicBp = false;
  let commentatorImageId = '';
  let commentatorLogoImageId = '';
  const beijingTime = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  function slotLabel(slotId) {
    return bootstrap?.slots[slotId]?.label || slotId;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || t('common.requestFailed', { status: response.status }));
    return payload;
  }

  function post(url, body) {
    return request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function log(message, tone = '') {
    const item = document.createElement('div');
    item.className = `log-item ${tone}`;
    item.textContent = `${beijingTime(Date.now())}  ${message}`;
    elements.log.prepend(item);
    while (elements.log.children.length > 20) elements.log.lastElementChild.remove();
  }

  function selectedContext() {
    return {
      matchId: elements.match.value,
      gameNumber: Number(elements.game.value),
      room: elements.room.value,
      attempt: Number(elements.attempt.value || 1)
    };
  }

  function saveContext() {
    localStorage.setItem('zfb.bpContext', JSON.stringify(selectedContext()));
  }

  function divisionLabel(division) {
    return division === 'pc' ? t('bp.divisionPc') : t('bp.divisionMobile');
  }

  function scheduleForMatch(matchId) {
    return bootstrap.schedules.find(schedule => schedule.matches.some(match => match.id === matchId)) || null;
  }

  function refreshScheduleOptions(preferredMatchId = null) {
    const dateSchedules = bootstrap.schedules.filter(schedule => schedule.event.date === elements.scheduleDate.value);
    const divisions = [...new Set(dateSchedules.map(schedule => schedule.event.division))];
    const preferredSchedule = preferredMatchId ? scheduleForMatch(preferredMatchId) : null;
    const preferredDivision = preferredSchedule?.event.date === elements.scheduleDate.value
      ? preferredSchedule.event.division
      : elements.division.value;
    elements.division.innerHTML = divisions.map(division =>
      `<option value="${division}">${divisionLabel(division)}</option>`).join('');
    if (divisions.includes(preferredDivision)) elements.division.value = preferredDivision;

    const schedule = dateSchedules.find(item => item.event.division === elements.division.value) || dateSchedules[0];
    elements.match.innerHTML = (schedule?.matches || []).map(match =>
      `<option value="${match.id}">${match.startTime} · ${escapeHtml(match.matchup.join(' vs '))}${match.ready === false ? t('bp.matchPending') : ''}</option>`).join('');
    if (preferredMatchId && [...elements.match.options].some(option => option.value === preferredMatchId)) {
      elements.match.value = preferredMatchId;
    }
  }

  function matchingSessions() {
    const context = selectedContext();
    return bootstrap.sessions.filter(item => item.matchId === context.matchId &&
      item.gameNumber === context.gameNumber && item.room === context.room);
  }

  function effectiveSession(gameNumber) {
    return bootstrap.sessions
      .filter(item => item.matchId === elements.match.value && item.room === elements.room.value && item.gameNumber === gameNumber)
      .sort((left, right) => right.attempt - left.attempt)[0] || null;
  }

  function gameAvailability(gameNumber) {
    const forfeited = bootstrap.sessions.some(item => item.matchId === elements.match.value &&
      item.room === elements.room.value && item.forfeit?.active);
    if (forfeited) return { available: false, reason: t('bp.roomForfeitReason') };
    if (gameNumber === 1) return { available: true, reason: '' };
    const previous = effectiveSession(gameNumber - 1);
    if (!previous || !['completed', 'replay'].includes(previous.status)) {
      return { available: false, reason: t('bp.prevGameNotDone', { n: gameNumber - 1 }) };
    }
    if (gameNumber === 3) {
      const score = { escape: 0, hunter: 0 };
      for (let game = 1; game <= 2; game += 1) {
        const winner = effectiveSession(game)?.result?.winnerRole;
        if (winner) score[winner] += 1;
      }
      if (score.escape >= 2 || score.hunter >= 2) {
        return { available: false, reason: t('bp.twoPointsScored') };
      }
    }
    return { available: true, reason: '' };
  }

  function refreshGameOptions(preferred = Number(elements.game.value || 1)) {
    for (const option of elements.game.options) {
      const availability = gameAvailability(Number(option.value));
      option.disabled = !availability.available;
      option.title = availability.reason;
    }
    const preferredOption = [...elements.game.options].find(option => Number(option.value) === preferred);
    if (!preferredOption || preferredOption.disabled) {
      const lastAvailable = [...elements.game.options].filter(option => !option.disabled).at(-1);
      if (lastAvailable) elements.game.value = lastAvailable.value;
    }
  }

  function refreshAttempts(preferred) {
    const records = matchingSessions().sort((a, b) => a.attempt - b.attempt);
    const selected = Number(preferred || elements.attempt.value || 1);
    elements.attempt.innerHTML = records.length
      ? records.map(item => `<option value="${item.attempt}">${item.attempt === 1 ? t('bp.officialBp') : t('bp.replayN', { n: item.attempt - 1 })}</option>`).join('')
      : `<option value="1">${t('bp.officialBp')}</option>`;
    if ([...elements.attempt.options].some(option => Number(option.value) === selected)) elements.attempt.value = String(selected);
  }

  function getTeam(role) {
    if (!session) return null;
    const teamId = session.roomAssignment[`${role}TeamId`];
    return bootstrap.tournament.teams[teamId];
  }

  function candidates(role) {
    const team = getTeam(role);
    if (!team) return [];
    const players = [...team.roster.escape, ...team.roster.hunter, ...team.roster.substitutes];
    const byId = new Map(players.filter(player => player.playerId).map(player => [player.playerId, player]));
    return team.candidatePools[role].map(id => {
      const player = byId.get(id);
      return { ...player, substitute: player.slot.startsWith('substitute') };
    });
  }

  function playerFor(slotId) {
    const config = bootstrap.slots[slotId];
    const id = session?.slots[slotId]?.playerId;
    return candidates(config.role).find(player => player.playerId === id) || null;
  }

  function phaseIndex(slotId) {
    return bootstrap.phases.findIndex(phase => phase.slots.includes(slotId));
  }

  function canEdit(slotId) {
    return Boolean(session && session.status === 'active' && phaseIndex(slotId) <= session.currentPhaseIndex);
  }

  function characterUrl(kind, character) {
    const folder = kind === 'ban' ? 'ban' : 'pick';
    return `/assets/characters/${folder}/${encodeURIComponent(character || '占位')}.png`;
  }

  function usedPlayers(role, exceptSlot) {
    if (!session) return new Set();
    return new Set(Object.entries(session.slots)
      .filter(([slotId, slot]) => slotId !== exceptSlot && bootstrap.slots[slotId].role === role && slot.playerId)
      .map(([, slot]) => slot.playerId));
  }

  function slotMarkup(slotId) {
    const config = bootstrap.slots[slotId];
    const slot = session?.slots[slotId] || {};
    const editable = canEdit(slotId);
    const player = playerFor(slotId);
    const characterMode = session?.outputMode === 'character';
    const complete = config.kind === 'ban' ? Boolean(slot.characterId) : Boolean(slot.characterId && (characterMode || slot.playerId || slot.playerText));
    const stateClass = !session ? 'locked' : complete ? 'complete' : editable ? 'editable' : 'locked';
    const currentClass = session && phaseIndex(slotId) === session.currentPhaseIndex ? 'current-phase' : '';
    const playerControl = config.kind === 'pick' && !characterMode ? `
      <div class="player-combobox" data-player-box="${slotId}">
        <input class="input player-search" data-player-input="${slotId}" value="${escapeHtml(slot.playerText || player?.nickname || '')}"
          placeholder="' + t('bp.playerPlaceholder') + '" autocomplete="off" ${editable ? '' : 'disabled'}>
        <div class="player-options" data-player-options="${slotId}" hidden></div>
      </div>
      <button class="manual-push" type="button" data-manual-push="${slotId}" ${editable && slot.characterId ? '' : 'disabled'}>${t('bp.manualPush')}</button>` : '';
    return `<article class="bp-slot ${config.kind}-slot ${stateClass} ${currentClass}" data-slot="${slotId}">
      <div class="slot-heading"><span>${slotLabel(slotId)}</span><i>${complete ? t('bp.pushed') : editable ? t('bp.currentSlot') : t('bp.locked')}</i></div>
      <button class="character-choice" type="button" data-character="${slotId}" ${editable ? '' : 'disabled'}>
        <img src="${characterUrl(config.kind, slot.characterId)}" alt="">
        <span>${escapeHtml(slot.characterId || t('bp.chooseCharacter'))}</span>
      </button>
      ${playerControl}
      <button class="slot-clear" type="button" data-clear="${slotId}" ${(editable && (slot.characterId || slot.playerId || slot.playerText)) ? '' : 'disabled'}>${t('bp.clearSlot')}</button>
    </article>`;
  }

  function renderSlots() {
    if (!bootstrap) return;
    elements.banSlots.innerHTML = bootstrap.ui.sections.ban.map(slotMarkup).join('');
    elements.hunterSlots.innerHTML = bootstrap.ui.sections.hunterPick.map(slotMarkup).join('');
    elements.escapeSlots.innerHTML = bootstrap.ui.sections.escapePick.map(slotMarkup).join('');
    bindSlotEvents();
  }

  function bindSlotEvents() {
    document.querySelectorAll('[data-character]').forEach(button => button.addEventListener('click', () => openCharacterPicker(button.dataset.character)));
    document.querySelectorAll('[data-clear]').forEach(button => button.addEventListener('click', () => act({ type: 'clear-slot', slotId: button.dataset.clear }, t('bp.clearedSlotLog', { slot: slotLabel(button.dataset.clear) }))));
    document.querySelectorAll('[data-manual-push]').forEach(button => button.addEventListener('click', () => {
      const slotId = button.dataset.manualPush;
      const input = document.querySelector(`[data-player-input="${CSS.escape(slotId)}"]`);
      const playerText = input.value.trim();
      if (!playerText) {
        log(t('bp.emptyPlayerText'), 'error');
        input.focus();
        return;
      }
      act({ type: 'set-slot', slotId, field: 'playerText', playerText }, t('bp.manualPushedLog', { slot: slotLabel(slotId) }));
    }));
    document.querySelectorAll('[data-player-input]').forEach(input => {
      input.addEventListener('focus', () => showPlayers(input.dataset.playerInput, input.value));
      input.addEventListener('input', () => showPlayers(input.dataset.playerInput, input.value));
      input.addEventListener('keydown', event => {
        if (event.key === 'Escape') hidePlayerOptions();
      });
    });
  }

  function showPlayers(slotId, query) {
    hidePlayerOptions();
    const config = bootstrap.slots[slotId];
    const used = usedPlayers(config.role, slotId);
    const list = candidates(config.role).filter(player =>
      !used.has(player.playerId) && window.ZfbSearch.matches(`${player.nickname} ${player.officialId}`, query)
    );
    const box = document.querySelector(`[data-player-options="${CSS.escape(slotId)}"]`);
    box.innerHTML = list.map(player => `<button type="button" data-player-id="${escapeHtml(player.playerId)}">
      <span>${escapeHtml(player.nickname)}</span><small>${player.substitute ? t('bp.substitute') : t('bp.starter')} · ${escapeHtml(player.officialId)}</small>
    </button>`).join('') || `<div class="empty-options">${t('bp.noPlayerMatch')}</div>`;
    box.hidden = false;
    const input = document.querySelector(`[data-player-input="${CSS.escape(slotId)}"]`);
    const rect = input.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 8;
    box.style.left = `${Math.max(8, rect.left)}px`;
    box.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
    box.style.right = 'auto';
    if (below >= 180) {
      box.style.top = `${rect.bottom + 4}px`;
      box.style.bottom = 'auto';
      box.style.maxHeight = `${Math.min(260, below)}px`;
    } else {
      box.style.top = 'auto';
      box.style.bottom = `${window.innerHeight - rect.top + 4}px`;
      box.style.maxHeight = `${Math.min(260, Math.max(120, rect.top - 12))}px`;
    }
    box.querySelectorAll('[data-player-id]').forEach(button => button.addEventListener('mousedown', event => {
      event.preventDefault();
      act({ type: 'set-slot', slotId, field: 'player', playerId: button.dataset.playerId }, t('bp.updatedPlayerLog', { slot: slotLabel(slotId) }));
    }));
  }

  function hidePlayerOptions() {
    document.querySelectorAll('.player-options').forEach(box => { box.hidden = true; });
  }

  function openCharacterPicker(slotId) {
    pickerSlotId = slotId;
    const config = bootstrap.slots[slotId];
    elements.dialogTitle.textContent = slotLabel(slotId);
    elements.dialogRole.textContent = config.role === 'escape' ? t('bp.escapeRole') : t('bp.hunterRole');
    elements.characterSearch.value = '';
    renderCharacterPicker();
    elements.dialog.showModal();
    elements.characterSearch.focus();
  }

  function renderCharacterPicker() {
    if (!pickerSlotId) return;
    const config = bootstrap.slots[pickerSlotId];
    const query = elements.characterSearch.value;
    const selectedCharacter = session?.slots[pickerSlotId]?.characterId || null;
    const banned = new Set(Object.entries(session?.slots || {})
      .filter(([slotId, slot]) => bootstrap.slots[slotId].kind === 'ban' && bootstrap.slots[slotId].role === config.role && slot.characterId)
      .map(([, slot]) => slot.characterId));
    elements.characterGrid.innerHTML = bootstrap.characters[config.role]
      .filter(name => window.ZfbSearch.matches(name, query))
      .map(name => {
        const unavailable = banned.has(name) && (config.kind === 'pick' || name !== selectedCharacter);
        return `<button type="button" data-pick-character="${escapeHtml(name)}" ${unavailable ? 'disabled' : ''}>
          <img src="${characterUrl(config.kind, name)}" alt=""><span>${escapeHtml(name)}${unavailable ? t('bp.bannedSuffix') : ''}</span>
        </button>`;
      }).join('');
    elements.characterGrid.querySelectorAll('[data-pick-character]').forEach(button => button.addEventListener('click', async () => {
      const slotId = pickerSlotId;
      elements.dialog.close();
      await act({ type: 'set-slot', slotId, field: 'character', characterId: button.dataset.pickCharacter }, t('bp.updatedCharacterLog', { slot: slotLabel(slotId) }));
    }));
  }

  function renderTeams() {
    const escapeTeam = getTeam('escape');
    const hunterTeam = getTeam('hunter');
    elements.escapeName.textContent = escapeTeam?.displayName || '-';
    elements.hunterName.textContent = hunterTeam?.displayName || '-';
    elements.escapeLogo.hidden = !escapeTeam;
    elements.hunterLogo.hidden = !hunterTeam;
    if (escapeTeam) elements.escapeLogo.src = escapeTeam.logos.escape.webFile;
    if (hunterTeam) elements.hunterLogo.src = hunterTeam.logos.hunter.webFile;
  }

  function displaySeconds() {
    if (!session) return 30;
    if (!session.timer.running || !session.timer.deadline) return session.timer.remainingSeconds;
    return Math.max(0, Math.ceil((session.timer.deadline - Date.now()) / 1000));
  }

  function renderHeader() {
    const forfeited = Boolean(session?.forfeit?.active);
    elements.clock.textContent = String(displaySeconds()).padStart(2, '0');
    elements.phaseLabel.textContent = !session ? t('bp.waitingLoad') : forfeited ? t('bp.forfeitSettled') : session.status === 'completed' ? t('bp.bpCompleted') : session.phase?.label || t('bp.readyToStart');
    elements.recordLabel.textContent = !session ? t('bp.noRecord') : t('bp.recordLine', { game: session.gameNumber, room: session.room, attempt: session.attempt === 1 ? t('bp.officialBp') : t('bp.replayN', { n: session.attempt - 1 }), revision: session.revision });
    elements.start.disabled = preparingBp || !session || forfeited || session.status !== 'ready' || session.attempt !== 1;
    elements.complete.disabled = preparingBp || !session || forfeited || !['ready', 'active'].includes(session.status);
    elements.switchBpScene.disabled = preparingBp;
    elements.sync.disabled = preparingBp || !session;
    elements.export.disabled = preparingBp || !session;
    elements.replay.disabled = preparingBp || !session || forfeited || session.status !== 'completed' || session.attempt !== 1;
    elements.reset.disabled = preparingBp || !session || forfeited || session.attempt !== 1;
    elements.forfeit.disabled = preparingBp || !session || forfeited;
    elements.revokeForfeit.disabled = preparingBp || !forfeited;
    elements.load.disabled = preparingBp;
    elements.loadAndSwitch.disabled = preparingBp;
    elements.dynamicBpEnabled.disabled = updatingDynamicBp;
    elements.commentatorImage.disabled = preparingBp || !bootstrap.commentatorImages.length;
    if (elements.commentatorImage.value !== commentatorImageId) elements.commentatorImage.value = commentatorImageId;
    elements.commentatorLogo.disabled = preparingBp || !bootstrap.commentatorLogoImages.length;
    if (elements.commentatorLogo.value !== commentatorLogoImageId) elements.commentatorLogo.value = commentatorLogoImageId;
    elements.forfeitStatus.hidden = !forfeited;
    if (forfeited) {
      const losing = bootstrap.tournament.teams[session.forfeit.forfeitingTeamId];
      const winner = bootstrap.tournament.teams[session.forfeit.winnerTeamId];
      elements.forfeitStatus.textContent = t('bp.forfeitStatusLine', { loser: losing?.displayName || session.forfeit.forfeitingTeamId, winner: winner?.displayName || session.forfeit.winnerTeamId });
    }
    document.querySelectorAll('[data-output-mode]').forEach(button => {
      button.classList.toggle('active', (session?.outputMode || 'nickname') === button.dataset.outputMode);
      button.disabled = !session || forfeited;
    });
  }

  function renderDynamicBpStatus() {
    if (!dynamicBp?.dynamicEnabled) {
      elements.dynamicBpStatus.textContent = t('bp.dynamicOff');
      elements.dynamicBpStatus.className = 'bp-dynamic-status';
      return;
    }
    const reason = String(dynamicBp.reason || '');
    let text = t('bp.dynamicOnWaiting');
    let tone = 'ready';
    if (reason.includes('failed') || dynamicBp.obsSynced === false) {
      text = t('bp.dynamicDegraded');
      tone = 'error';
    } else if (!dynamicBp.clientCount) {
      text = t('bp.dynamicNoOverlay');
      tone = 'waiting';
    } else if (dynamicBp.visibility === 'armed' && dynamicBp.playAt) {
      text = Number(dynamicBp.playAt) > Date.now() ? t('bp.dynamicScheduled') : t('bp.dynamicPlaying');
    } else if (dynamicBp.visibility === 'armed') {
      text = t('bp.dynamicPreloaded');
    }
    elements.dynamicBpStatus.textContent = text;
    elements.dynamicBpStatus.className = `bp-dynamic-status ${tone}`;
  }

  function rememberDynamicBp(next) {
    dynamicBp = { ...(next || {}) };
    elements.dynamicBpEnabled.checked = Boolean(dynamicBp.dynamicEnabled);
    renderDynamicBpStatus();
  }

  async function setDynamicBpEnabled() {
    if (updatingDynamicBp) return;
    const enabled = elements.dynamicBpEnabled.checked;
    const previous = Boolean(dynamicBp?.dynamicEnabled);
    updatingDynamicBp = true;
    renderHeader();
    elements.dynamicBpStatus.textContent = enabled ? t('bp.dynamicEnabling') : t('bp.dynamicDisabling');
    try {
      const next = await post('/api/bp/presentation/settings', { enabled });
      rememberDynamicBp(next);
      if (next.obsSynced === false) {
        log(t('bp.dynamicSaveFailLog', { error: next.obsError || t('bp.obsNotConnectedShort') }), 'error');
      } else {
        log(enabled ? t('bp.dynamicEnabledLog') : t('bp.dynamicDisabledLog'));
      }
    } catch (error) {
      elements.dynamicBpEnabled.checked = previous;
      rememberDynamicBp({ dynamicEnabled: previous });
      log(t('bp.dynamicSaveFail', { error: error.message }), 'error');
    } finally {
      updatingDynamicBp = false;
      renderHeader();
    }
  }

  function renderPhases() {
    elements.phases.innerHTML = bootstrap.phases.map((phase, index) => {
      const complete = session && phase.slots.every(slotId => {
        const config = bootstrap.slots[slotId];
        const slot = session.slots[slotId];
        return config.kind === 'ban' ? slot.characterId : slot.characterId && (session.outputMode === 'character' || slot.playerId || slot.playerText);
      });
      const state = complete ? 'complete' : session && index === session.currentPhaseIndex ? 'active' : session && index < session.currentPhaseIndex ? 'complete' : '';
      return `<div class="phase-step ${state}"><span>${index + 1}</span><strong>${escapeHtml(phase.label)}</strong></div>`;
    }).join('');
  }

  function renderHistory() {
    if (!session?.history?.length) {
      elements.history.innerHTML = `<div class="empty-state">${t('bp.noHistory')}</div>`;
      return;
    }
    elements.history.innerHTML = [...session.history].reverse().slice(0, 20).map(item => `<div class="history-item">
      <div><strong>R${item.revision} · ${escapeHtml(historyLabel(item.action))}</strong><small>${beijingTime(item.timestamp)}</small></div>
      <button type="button" data-restore="${item.revision}" ${item.revision === session.revision ? 'disabled' : ''}>${t('bp.restore')}</button>
    </div>`).join('');
    elements.history.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', () => {
      const revision = Number(button.dataset.restore);
      if (window.confirm(t('bp.restoreConfirm', { revision }))) act({ type: 'restore-revision', revision }, t('bp.restoredLog', { revision }));
    }));
  }

  function renderResult() {
    const forfeited = Boolean(session?.forfeit?.active);
    const visible = forfeited || session?.status === 'completed' || session?.status === 'replay';
    elements.resultPanel.hidden = !visible;
    if (!visible) return;
    const escapeTeam = getTeam('escape');
    const hunterTeam = getTeam('hunter');
    elements.resultEscape.textContent = t('bp.escapeWins', { name: escapeTeam.displayName });
    elements.resultHunter.textContent = t('bp.hunterWins', { name: hunterTeam.displayName });
    elements.resultEscape.classList.toggle('selected', session.result?.winnerRole === 'escape');
    elements.resultHunter.classList.toggle('selected', session.result?.winnerRole === 'hunter');
    elements.resultEscape.disabled = forfeited;
    elements.resultHunter.disabled = forfeited;
    elements.scoreLabel.textContent = t('bp.scoreLine', { escape: session.score?.escape || 0, hunter: session.score?.hunter || 0 });
    const matchFinished = (session.score?.escape || 0) >= 2 || (session.score?.hunter || 0) >= 2;
    elements.nextGame.hidden = forfeited || !session.result || session.gameNumber >= 3 || matchFinished;
    elements.nextGame.textContent = t('bp.nextGameN', { n: session.gameNumber + 1 });
  }

  function focusCurrentPhase(force = false) {
    if (!session || session.currentPhaseIndex < 0) return;
    const key = `${session.id}:${session.currentPhaseIndex}`;
    if (!force && lastFocusedPhase === key) return;
    lastFocusedPhase = key;
    const slotId = bootstrap.phases[session.currentPhaseIndex]?.slots[0];
    const card = slotId && document.querySelector(`[data-slot="${CSS.escape(slotId)}"]`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function historyLabel(action) {
    return window.UI_TEXT[`bp.logActions.${action}`] || action;
  }

  function render() {
    refreshGameOptions(session?.gameNumber || Number(elements.game.value || 1));
    renderTeams();
    renderHeader();
    renderPhases();
    renderSlots();
    renderHistory();
    renderResult();
  }

  function rememberSession(next) {
    const index = bootstrap.sessions.findIndex(item => item.id === next.id);
    if (index >= 0) bootstrap.sessions[index] = next;
    else bootstrap.sessions.push(next);
    session = next;
    refreshGameOptions(next.gameNumber);
    refreshAttempts(next.attempt);
    elements.attempt.value = String(next.attempt);
    render();
    setTimeout(() => focusCurrentPhase(), 80);
  }

  async function loadSession() {
    const context = selectedContext();
    const next = await post('/api/bp/sessions', context);
    saveContext();
    rememberSession(next);
    log(t('bp.loadedLog', { id: next.id }));
    return next;
  }

  async function act(action, successMessage) {
    if (!session) return null;
    try {
      const next = await post(`/api/bp/sessions/${encodeURIComponent(session.id)}/actions`, action);
      rememberSession(next);
      log(successMessage);
      return next;
    } catch (error) {
      log(error.message, 'error');
      return null;
    }
  }

  async function runLoadAction() {
    await loadSession();
    return act({ type: 'sync-match' }, t('bp.matchInfoSyncedLog'));
  }

  function runSyncAction(message = t('bp.fullSyncDefault')) {
    return act({ type: 'sync-obs' }, message);
  }

  async function prepareAndSwitchBp() {
    if (preparingBp) return;
    preparingBp = true;
    const originalText = elements.switchBpScene.textContent;
    renderHeader();
    try {
      elements.switchBpScene.textContent = t('bp.loading');
      if (!await runLoadAction()) return;
      elements.switchBpScene.textContent = t('bp.syncing');
      if (!await runSyncAction(t('bp.fullSyncedLog'))) return;
      elements.switchBpScene.textContent = t('bp.switching');
      const dynamicRequested = Boolean(dynamicBp?.dynamicEnabled);
      await act(
        { type: 'switch-scene-bp' },
        dynamicRequested
          ? t('bp.switchedDynamic')
          : t('bp.switchedLegacy')
      );
    } catch (error) {
      log(error.message, 'error');
    } finally {
      preparingBp = false;
      elements.switchBpScene.textContent = originalText;
      renderHeader();
    }
  }

  async function selectCommentatorImage() {
    const previousId = commentatorImageId;
    const imageId = elements.commentatorImage.value;
    if (!imageId || imageId === previousId) return;
    elements.commentatorImage.disabled = true;
    elements.commentatorStatus.textContent = t('bp.syncingShort');
    elements.commentatorStatus.className = 'commentator-sync-status';
    try {
      const selected = await post('/api/bp/commentator-image', { imageId });
      commentatorImageId = selected.id;
      if (session) session.commentatorImage = selected;
      elements.commentatorStatus.textContent = t('bp.synced');
      elements.commentatorStatus.className = 'commentator-sync-status success';
      log(t('bp.commentatorSyncedLog'), 'success');
    } catch (error) {
      elements.commentatorImage.value = previousId;
      elements.commentatorStatus.textContent = t('bp.syncFailed');
      elements.commentatorStatus.className = 'commentator-sync-status error';
      log(error.message, 'error');
    }
    renderHeader();
  }

  async function selectCommentatorLogoImage() {
    const previousId = commentatorLogoImageId;
    const imageId = elements.commentatorLogo.value;
    if (!imageId || imageId === previousId) return;
    elements.commentatorLogo.disabled = true;
    elements.commentatorLogoStatus.textContent = t('bp.syncingShort');
    elements.commentatorLogoStatus.className = 'commentator-sync-status';
    try {
      const selected = await post('/api/bp/commentator-logo-image', { imageId });
      commentatorLogoImageId = selected.id;
      elements.commentatorLogoStatus.textContent = t('bp.synced');
      elements.commentatorLogoStatus.className = 'commentator-sync-status success';
      log(t('bp.logoSyncedLog', { name: selected.name }), 'success');
    } catch (error) {
      elements.commentatorLogo.value = previousId;
      elements.commentatorLogoStatus.textContent = t('bp.syncFailed');
      elements.commentatorLogoStatus.className = 'commentator-sync-status error';
      log(error.message, 'error');
    }
    renderHeader();
  }

  function showResultImage(file) {
    if (!file?.type?.startsWith('image/')) {
      log(t('bp.noImageFile'), 'error');
      return;
    }
    if (resultImageUrl) URL.revokeObjectURL(resultImageUrl);
    resultImageFile = file;
    resultImageUrl = URL.createObjectURL(file);
    elements.imagePreview.src = resultImageUrl;
    elements.imagePreview.hidden = false;
    elements.imageDropZone.classList.add('has-image');
    elements.keepImage.disabled = false;
  }

  function clearResultImage() {
    if (resultImageUrl) URL.revokeObjectURL(resultImageUrl);
    resultImageUrl = null;
    resultImageFile = null;
    elements.imageInput.value = '';
    elements.imagePreview.removeAttribute('src');
    elements.imagePreview.hidden = true;
    elements.imageDropZone.classList.remove('has-image');
    elements.keepImage.disabled = true;
  }

  async function uploadResultImage() {
    if (!session || !resultImageFile) return;
    elements.keepImage.disabled = true;
    const originalText = elements.keepImage.textContent;
    elements.keepImage.textContent = t('bp.uploading');
    try {
      const response = await fetch(`/api/bp/sessions/${encodeURIComponent(session.id)}/result-image`, {
        method: 'POST', headers: { 'Content-Type': resultImageFile.type }, body: resultImageFile
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || t('common.uploadFailed'));
      rememberSession(payload.session);
      log(payload.obsSynced ? t('bp.resultImageSavedLog', { name: payload.fileName }) : t('bp.resultImageSavedNoSyncLog', { name: payload.fileName }));
      clearResultImage();
      elements.imageDialog.close();
    } catch (error) {
      log(error.message, 'error');
      elements.keepImage.disabled = false;
    } finally {
      elements.keepImage.textContent = originalText;
    }
  }

  function setObsStatus(status) {
    const connected = Boolean(status.connected);
    elements.obsStatus.textContent = connected ? t('header.obsConnected', { count: status.queueDepth || 0 }) : t('header.obsDisconnected');
    elements.obsStatus.classList.toggle('status-muted', !connected);
    const error = status.lastOperationError || status.lastError;
    elements.obsStatus.classList.toggle('status-error', Boolean(error));
    elements.obsStatus.title = error || status.url || '';
  }

  function connectEvents() {
    events?.close();
    events = new EventSource('/api/bp/events');
    events.addEventListener('session', event => {
      const payload = JSON.parse(event.data);
      const next = payload.session;
      const index = bootstrap.sessions.findIndex(item => item.id === next.id);
      if (index >= 0) bootstrap.sessions[index] = next; else bootstrap.sessions.push(next);
      refreshGameOptions();
      if (session?.id === next.id) {
        session = next;
        if (payload.reason === 'timer-tick') {
          renderHeader();
        } else if (payload.reason === 'phase-zero' || payload.reason === 'timer-expired') {
          renderHeader();
          renderPhases();
        } else {
          render();
          if (payload.reason === 'phase-started' || payload.reason === 'bp-started') {
            setTimeout(() => focusCurrentPhase(), 80);
          }
        }
      }
    });
    events.addEventListener('obs-status', event => setObsStatus(JSON.parse(event.data)));
    events.addEventListener('bp-presentation', event => rememberDynamicBp(JSON.parse(event.data)));
    events.addEventListener('obs-operation', event => {
      const operation = JSON.parse(event.data);
      log(operation.ok ? t('bp.logOpOk', { label: operation.label }) : t('bp.logOpFail', { error: operation.error }), operation.ok ? '' : 'error');
    });
  }

  function bindPageEvents() {
    elements.dynamicBpEnabled.addEventListener('change', setDynamicBpEnabled);
    elements.scheduleDate.addEventListener('change', () => {
      session = null;
      refreshScheduleOptions();
      refreshGameOptions(1);
      refreshAttempts();
      saveContext();
      render();
    });
    elements.division.addEventListener('change', () => {
      session = null;
      refreshScheduleOptions();
      refreshGameOptions(1);
      refreshAttempts();
      saveContext();
      render();
    });
    [elements.match, elements.room].forEach(select => select.addEventListener('change', () => {
      session = null;
      refreshGameOptions(1);
      refreshAttempts();
      saveContext();
      render();
    }));
    elements.game.addEventListener('change', () => {
      session = null;
      refreshAttempts();
      saveContext();
      render();
    });
    elements.attempt.addEventListener('change', () => { session = null; saveContext(); render(); });
    elements.load.addEventListener('click', async () => {
      try {
        await runLoadAction();
      } catch (error) {
        log(error.message, 'error');
      }
    });
    elements.loadAndSwitch.addEventListener('click', async () => {
      try {
        await loadSession();
        await act({ type: 'sync-match-and-switch' }, t('bp.switchWithTransitionsLog'));
      } catch (error) {
        log(error.message, 'error');
      }
    });
    elements.start.addEventListener('click', () => act({ type: 'start' }, t('bp.startedLog')));
    elements.complete.addEventListener('click', () => elements.completeDialog.showModal());
    elements.cancelComplete.addEventListener('click', () => elements.completeDialog.close());
    elements.confirmComplete.addEventListener('click', async () => {
      elements.completeDialog.close();
      await act({ type: 'complete' }, t('bp.completedLog'));
    });
    elements.forfeit.addEventListener('click', () => {
      if (!session) return;
      const escapeTeam = getTeam('escape');
      const hunterTeam = getTeam('hunter');
      elements.forfeitTeamOptions.innerHTML = [escapeTeam, hunterTeam].map((team, index) => `<label>
        <input type="radio" name="forfeitingTeam" value="${escapeHtml(team.id)}" ${index === 0 ? 'checked' : ''}>
        <strong>${escapeHtml(team.displayName)}</strong>
      </label>`).join('');
      elements.forfeitDialog.showModal();
    });
    elements.cancelForfeit.addEventListener('click', () => elements.forfeitDialog.close());
    elements.continueForfeit.addEventListener('click', () => {
      const teamId = elements.forfeitTeamOptions.querySelector('input:checked')?.value;
      if (!teamId) return;
      const forfeiting = bootstrap.tournament.teams[teamId];
      const winnerId = [session.roomAssignment.escapeTeamId, session.roomAssignment.hunterTeamId].find(id => id !== teamId);
      const winner = bootstrap.tournament.teams[winnerId];
      elements.confirmForfeit.dataset.teamId = teamId;
      elements.forfeitConfirmText.textContent = t('bp.forfeitConfirmText', { forfeiting: forfeiting.displayName, winner: winner.displayName });
      elements.forfeitDialog.close();
      elements.forfeitConfirmDialog.showModal();
    });
    elements.cancelForfeitConfirm.addEventListener('click', () => {
      elements.forfeitConfirmDialog.close();
      elements.forfeitDialog.showModal();
    });
    elements.confirmForfeit.addEventListener('click', async () => {
      const teamId = elements.confirmForfeit.dataset.teamId;
      elements.forfeitConfirmDialog.close();
      await act({ type: 'declare-forfeit', forfeitingTeamId: teamId }, t('bp.forfeitDoneLog'));
    });
    elements.revokeForfeit.addEventListener('click', () => {
      const forfeiting = bootstrap.tournament.teams[session.forfeit.forfeitingTeamId];
      elements.revokeForfeitText.textContent = t('bp.revokeConfirmText', { forfeiting: forfeiting.displayName });
      elements.revokeForfeitDialog.showModal();
    });
    elements.cancelRevokeForfeit.addEventListener('click', () => elements.revokeForfeitDialog.close());
    elements.confirmRevokeForfeit.addEventListener('click', async () => {
      elements.revokeForfeitDialog.close();
      await act({ type: 'revoke-forfeit' }, t('bp.revokeDoneLog'));
    });
    elements.switchBpScene.addEventListener('click', prepareAndSwitchBp);
    elements.sync.addEventListener('click', () => runSyncAction());
    elements.commentatorImage.addEventListener('change', selectCommentatorImage);
    elements.commentatorLogo.addEventListener('change', selectCommentatorLogoImage);
    elements.export.addEventListener('click', () => {
      if (!session) return;
      const link = document.createElement('a');
      link.href = `/api/bp/sessions/${encodeURIComponent(session.id)}/export`;
      link.click();
    });
    elements.replay.addEventListener('click', () => act({ type: 'create-replay' }, t('bp.replayLog')));
    elements.reset.addEventListener('click', () => elements.resetDialog.showModal());
    elements.cancelReset.addEventListener('click', () => elements.resetDialog.close());
    elements.confirmReset.addEventListener('click', async () => {
      elements.resetDialog.close();
      await act({ type: 'reset-session' }, t('bp.resetDoneLog'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    elements.obsConnect.addEventListener('click', async () => {
      try {
        localStorage.setItem('zfb.obsUrl', elements.obsUrl.value);
        const status = await post('/api/obs/connect', {
          url: elements.obsUrl.value,
          password: elements.obsPassword.value,
          countdownUrl: new URL('/hub/countdown', window.location.origin).href
        });
        setObsStatus(status);
        elements.obsPassword.value = '';
        elements.obsPassword.placeholder = status.passwordSaved ? t('bp.pwdSaved') : t('bp.pwdPlaceholder');
        log(t('bp.obsConnectedLog'));
      } catch (error) {
        log(error.message, 'error');
        setObsStatus({ connected: false, lastOperationError: error.message });
      }
    });
    elements.closeDialog.addEventListener('click', () => elements.dialog.close());
    elements.characterSearch.addEventListener('input', renderCharacterPicker);
    document.querySelectorAll('[data-output-mode]').forEach(button => button.addEventListener('click', () =>
      act({ type: 'set-output-mode', mode: button.dataset.outputMode }, button.dataset.outputMode === 'character' ? t('bp.modeCharacterLog') : t('bp.modeNicknameLog'))
    ));
    elements.resultEscape.addEventListener('click', async () => {
      if (await act({ type: 'set-result', winnerRole: 'escape' }, t('bp.escapeScoredLog'))) {
        clearResultImage();
        elements.imageDialog.showModal();
      }
    });
    elements.resultHunter.addEventListener('click', async () => {
      if (await act({ type: 'set-result', winnerRole: 'hunter' }, t('bp.hunterScoredLog'))) {
        clearResultImage();
        elements.imageDialog.showModal();
      }
    });
    elements.closeImage.addEventListener('click', () => elements.imageDialog.close());
    elements.keepImage.addEventListener('click', uploadResultImage);
    elements.clearImage.addEventListener('click', clearResultImage);
    elements.imageInput.addEventListener('change', () => showResultImage(elements.imageInput.files[0]));
    elements.imageDropZone.addEventListener('dragover', event => {
      event.preventDefault();
      elements.imageDropZone.classList.add('dragging');
    });
    elements.imageDropZone.addEventListener('dragleave', () => elements.imageDropZone.classList.remove('dragging'));
    elements.imageDropZone.addEventListener('drop', event => {
      event.preventDefault();
      elements.imageDropZone.classList.remove('dragging');
      showResultImage(event.dataTransfer.files[0]);
    });
    elements.imageDialog.addEventListener('paste', event => {
      const file = [...event.clipboardData.files].find(item => item.type.startsWith('image/'));
      if (file) showResultImage(file);
    });
    elements.nextGame.addEventListener('click', async () => {
      if (!session || session.gameNumber >= 3) return;
      try {
        elements.game.value = String(session.gameNumber + 1);
        session = null;
        refreshAttempts(1);
        await loadSession();
        await act({ type: 'sync-obs' }, t('bp.deployedLog', { game: session.gameNumber }));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (error) {
        refreshGameOptions();
        log(error.message, 'error');
      }
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.player-combobox')) hidePlayerOptions();
    });
  }

  async function init() {
    bootstrap = await request('/api/bp/bootstrap');
    rememberDynamicBp(bootstrap.dynamicBp);
    commentatorImageId = bootstrap.commentatorImage?.id || '';
    elements.commentatorImage.replaceChildren(
      new Option(bootstrap.commentatorImages.length ? t('bp.commentatorImagePlaceholder') : t('bp.noCommentatorImage'), ''),
      ...bootstrap.commentatorImages.map(image => new Option(image.name, image.id))
    );
    elements.commentatorImage.value = commentatorImageId;
    if (!bootstrap.commentatorImages.length) {
      elements.commentatorStatus.textContent = t('bp.commentatorImageNotFound');
      elements.commentatorStatus.className = 'commentator-sync-status error';
    }
    commentatorLogoImageId = bootstrap.commentatorLogoImage?.id || '';
    elements.commentatorLogo.replaceChildren(
      new Option(bootstrap.commentatorLogoImages.length ? t('bp.commentatorLogoPlaceholder') : t('bp.noCommentatorLogo'), ''),
      ...bootstrap.commentatorLogoImages.map(image => new Option(image.name, image.id))
    );
    elements.commentatorLogo.value = commentatorLogoImageId;
    if (!bootstrap.commentatorLogoImages.length) {
      elements.commentatorLogoStatus.textContent = t('bp.noCommentatorLogo');
      elements.commentatorLogoStatus.className = 'commentator-sync-status error';
    }
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('zfb.bpContext'));
    } catch {}
    const initial = saved || bootstrap.sessions[0] || {};
    const initialSchedule = scheduleForMatch(initial.matchId) || bootstrap.schedules[0];
    const dates = [...new Set(bootstrap.schedules.map(schedule => schedule.event.date))].sort();
    elements.scheduleDate.innerHTML = dates.map(date => `<option value="${date}">${date}</option>`).join('');
    elements.scheduleDate.value = initialSchedule.event.date;
    refreshScheduleOptions(initial.matchId || initialSchedule.matches[0]?.id);
    if (initial.gameNumber) elements.game.value = String(initial.gameNumber);
    if (initial.room) elements.room.value = initial.room;
    refreshGameOptions(initial.gameNumber || 1);
    refreshAttempts(initial.attempt);
    bindPageEvents();
    setObsStatus(bootstrap.obs);
    elements.obsUrl.value = localStorage.getItem('zfb.obsUrl') || bootstrap.obs.url || elements.obsUrl.value;
    elements.obsPassword.placeholder = bootstrap.obs.passwordSaved ? t('bp.pwdSaved') : t('bp.pwdPlaceholder');
    const existing = matchingSessions().find(item => item.attempt === Number(elements.attempt.value));
    if (existing) rememberSession(await request(`/api/bp/sessions/${encodeURIComponent(existing.id)}`));
    else render();
    connectEvents();
  }

  setInterval(() => {
    if (session?.timer.running) renderHeader();
    if (dynamicBp?.dynamicEnabled && dynamicBp.playAt) renderDynamicBpStatus();
  }, 200);
  window.addEventListener('beforeunload', () => events?.close());
  init().catch(error => log(t('bp.initFailedLog', { error: error.message }), 'error'));
})();
