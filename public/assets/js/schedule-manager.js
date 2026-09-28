(function () {
  'use strict';

  const root = document.getElementById('schedulePage');
  if (!root) return;
  sessionStorage.removeItem('stella.scheduleManagedEventId');

  const state = {
    loading: false,
    event: null,
    stages: [],
    teams: [],
    executors: [],
    selectedStageId: null,
    collapsed: false,
    createSelectedIds: new Set(),
    editMatchId: null,
    resultMatchId: null,
    commentatorOptions: null
  };

  const $ = id => document.getElementById(id);
  const el = {
    eventLogoImage: $('scheduleEventLogoImage'),
    eventLogoFallback: $('scheduleEventLogoFallback'),
    eventName: $('scheduleEventName'),
    eventStatus: $('scheduleEventStatus'),
    workspace: $('scheduleWorkspace'),
    stageCard: $('scheduleStageCard'),
    stageItems: $('scheduleStageItems'),
    stageRail: $('scheduleStageRail'),
    stageRailCount: $('scheduleStageRailCount'),
    detailCard: $('scheduleDetailCard'),
    detailLogoImage: $('scheduleDetailLogoImage'),
    detailLogoFallback: $('scheduleDetailLogoFallback'),
    detailName: $('scheduleDetailName'),
    detailMeta: $('scheduleDetailMeta'),
    detailBody: $('scheduleDetailBody'),
    toggleBtn: $('scheduleStageToggle'),
    completeBtn: $('scheduleStageComplete'),
    refreshBtn: $('scheduleStageRefresh'),
    deleteBtn: $('scheduleStageDelete'),
    nextRoundBtn: $('scheduleStageNextRound'),
    newBtn: $('scheduleStageNew'),
    collapseBtn: $('scheduleStageCollapse'),
    expandBtn: $('scheduleStageExpand'),
    backBtn: $('scheduleBackToEvents'),
    rankingBtn: $('scheduleRankingButton'),
    createDialog: $('scheduleStageCreateDialog'),
    createForm: $('scheduleStageCreateForm'),
    createClose: $('scheduleStageCreateClose'),
    createCancel: $('scheduleStageCreateCancel'),
    createFeedback: $('scheduleStageCreateFeedback'),
    stageName: $('scheduleStageName'),
    stageFormat: $('scheduleStageFormat'),
    stageDivision: $('scheduleStageDivision'),
    stageStart: $('scheduleStageStart'),
    stageEnd: $('scheduleStageEnd'),
    teamGrid: $('scheduleTeamGrid'),
    teamsEmpty: $('scheduleTeamsEmpty'),
    teamCount: $('scheduleStageTeamCount'),
    matchDialog: $('scheduleMatchEditDialog'),
    matchForm: $('scheduleMatchEditForm'),
    matchClose: $('scheduleMatchEditClose'),
    matchCancel: $('scheduleMatchEditCancel'),
    matchFeedback: $('scheduleMatchFeedback'),
    matchFormat: $('scheduleMatchFormat'),
    matchTime: $('scheduleMatchTime'),
    matchHome: $('scheduleMatchHome'),
    matchAway: $('scheduleMatchAway'),
    matchExecutor: $('scheduleMatchExecutor'),
    matchBpRoom: $('scheduleMatchBpRoom'),
    matchCommentator: $('scheduleMatchCommentator'),
    matchCommentatorLogo: $('scheduleMatchCommentatorLogo'),
    resultDialog: $('scheduleResultDialog'),
    resultForm: $('scheduleResultForm'),
    resultClose: $('scheduleResultClose'),
    resultMatch: $('scheduleResultMatch'),
    resultOptions: $('scheduleResultOptions'),
    rankingDialog: $('scheduleRankingDialog'),
    rankingClose: $('scheduleRankingClose'),
    rankingBody: $('scheduleRankingBody')
  };
  el.weekdayPills = [...root.querySelectorAll('.schedule-weekday-pill')];

  const EMPTY_LOGO_SVG = '<svg viewBox="0 0 24 24" data-icon="shield" aria-hidden="true"></svg>';
  const EVENT_STATUS_KEYS = { draft: 'schedule.statusDraft', live: 'schedule.statusLive', completed: 'schedule.statusCompleted' };
  const STAGE_STATUS_KEYS = { draft: 'schedule.statusDraft', live: 'schedule.statusLive', paused: 'schedule.statusPaused', completed: 'schedule.statusCompleted' };
  const BRACKET_KEYS = { upper: 'schedule.bracketUpper', lower: 'schedule.bracketLower', final: 'schedule.bracketFinal' };

  function t(key, params) {
    return typeof window.t === 'function' ? window.t(key, params) : key;
  }

  function node(tag, className, content) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (content !== undefined) result.textContent = String(content);
    return result;
  }

  function setLogoFrame(image, fallback, logoUrl, name) {
    if (logoUrl) {
      image.src = logoUrl;
      image.hidden = false;
      fallback.hidden = true;
      image.onerror = () => {
        image.hidden = true;
        fallback.hidden = false;
        fallback.textContent = (name || '?').slice(0, 1);
      };
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      fallback.hidden = false;
      fallback.textContent = (name || '?').slice(0, 1);
    }
  }

  function teamLogoFrame(team, sizeClass = '') {
    const frame = node('span', `schedule-match-side-logo${sizeClass ? ` ${sizeClass}` : ''}`);
    if (team && team.logo) {
      const image = document.createElement('img');
      image.src = team.logo;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => {
        frame.classList.add('is-empty');
        frame.innerHTML = EMPTY_LOGO_SVG;
      });
      frame.append(image);
    } else if (team && team.name) {
      frame.textContent = team.name.slice(0, 1);
    } else {
      frame.classList.add('is-empty');
      frame.innerHTML = EMPTY_LOGO_SVG;
    }
    return frame;
  }

  async function api(url, options = {}) {
    const config = { headers: {}, ...options };
    if (config.body && typeof config.body !== 'string') {
      config.body = JSON.stringify(config.body);
      config.headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url, config);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error = new Error(payload?.error || `请求失败 (${response.status})`);
      error.code = payload?.code;
      throw error;
    }
    return payload;
  }

  function selectedStage() {
    return state.stages.find(item => item.id === state.selectedStageId) || null;
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    try {
      let payload = null;
      const storedId = sessionStorage.getItem('stella.scheduleManagedEventId') || '';
      if (storedId) {
        try {
          payload = await api(`/api/events/${encodeURIComponent(storedId)}/stages`);
        } catch {
          payload = null;
        }
      }
      if (!payload) {
        const schedule = await api('/api/operations/schedule');
        const resolvedId = schedule?.data?.context?.managedEventId || schedule?.context?.managedEventId || '';
        if (!resolvedId) throw new Error(t('schedule.noLiveEvent'));
        sessionStorage.setItem('stella.scheduleManagedEventId', resolvedId);
        payload = await api(`/api/events/${encodeURIComponent(resolvedId)}/stages`);
      }
      state.event = payload.event;
      state.stages = payload.stages || [];
      state.teams = payload.teams || [];
      state.executors = payload.executors || [];
      if (state.selectedStageId && !selectedStage()) state.selectedStageId = null;
      render();
    } catch (error) {
      state.event = null;
      state.stages = [];
      state.teams = [];
      state.selectedStageId = null;
      renderEmpty(error.message || t('schedule.noLiveEvent'));
    } finally {
      state.loading = false;
    }
  }

  function renderEmpty(message) {
    el.eventName.textContent = t('schedule.noLiveEvent');
    el.eventStatus.hidden = true;
    setLogoFrame(el.eventLogoImage, el.eventLogoFallback, null, null);
    el.workspace.dataset.layout = 'list';
    el.stageCard.hidden = true;
    el.detailCard.hidden = true;
    let empty = root.querySelector('.schedule-page-empty');
    if (!empty) {
      empty = node('div', 'schedule-page-empty');
      el.workspace.after(empty);
    }
    empty.replaceChildren(node('strong', '', t('schedule.pageTitle')), node('span', '', message));
  }

  function render() {
    el.stageCard.hidden = false;
    el.detailCard.hidden = !selectedStage();
    const empty = root.querySelector('.schedule-page-empty');
    if (empty) empty.remove();
    renderTitleBar();
    renderStageList();
    const stage = selectedStage();
    if (stage) renderDetail(stage);
    layout();
  }

  function renderTitleBar() {
    const event = state.event;
    if (!event) return;
    setLogoFrame(el.eventLogoImage, el.eventLogoFallback, event.logoUrl, event.name);    el.eventName.textContent = event.name;
    el.eventStatus.hidden = false;
    el.eventStatus.dataset.state = event.status || 'draft';
    el.eventStatus.textContent = t(EVENT_STATUS_KEYS[event.status] || 'schedule.statusDraft');
  }

  function renderStageList() {
    if (!state.stages.length) {
      el.stageItems.replaceChildren(node('p', 'schedule-stage-empty', t('schedule.noStages')));
      return;
    }
    const items = state.stages.map(stage => {
      const item = node('button', `schedule-stage-item${stage.id === state.selectedStageId ? ' is-active' : ''}`);
      item.type = 'button';
      const top = node('span', 'schedule-stage-item-top');
      top.append(
        node('strong', '', stage.name),
        (() => {
          const chip = node('span', 'schedule-status-chip', t(STAGE_STATUS_KEYS[stage.status] || 'schedule.statusDraft'));
          chip.dataset.state = stage.status;
          return chip;
        })()
      );
      item.append(top);
      const meta = node('span', 'schedule-stage-item-meta');
      meta.append(
        node('span', '', stage.format),
        node('span', '', divisionText(stage.division)),
        node('span', '', `${(stage.startAt || '').slice(0, 10)} ~ ${(stage.endAt || '').slice(0, 10)}`)
      );
      item.append(meta);
      if (stage.status === 'live' || stage.status === 'paused') {
        const progress = node('span', 'schedule-progress');
        const copy = node('span', 'schedule-progress-copy');
        copy.append(
          node('span', '', `${stage.progress.completed}/${stage.progress.total}`),
          node('strong', '', `${stage.progress.percent}%`)
        );
        const track = node('span', 'schedule-progress-track');
        const fill = node('span', 'schedule-progress-fill');
        fill.style.width = `${stage.progress.percent}%`;
        track.append(fill);
        progress.append(copy, track);
        item.append(progress);
      }
      item.addEventListener('click', () => selectStage(stage.id));
      return item;
    });
    el.stageItems.replaceChildren(...items);
  }

  function divisionText(division) {
    if (division === 'pc') return t('schedule.divisionPc');
    if (division === 'mobile') return t('schedule.divisionMobile');
    return t('schedule.divisionAll');
  }

  function layout() {
    const stage = selectedStage();
    const layoutName = state.collapsed && stage ? 'collapsed' : stage ? 'split' : 'list';
    el.workspace.dataset.layout = layoutName;
    const collapsed = state.collapsed && Boolean(stage);
    el.stageCard.classList.toggle('is-collapsed', collapsed);
    el.stageRail.hidden = !collapsed;
    if (collapsed) el.stageRailCount.textContent = String(state.stages.length);
  }

  function selectStage(stageId) {
    state.selectedStageId = stageId;
    render();
  }

  function renderDetail(stage) {
    setLogoFrame(el.detailLogoImage, el.detailLogoFallback, state.event?.logoUrl || null, stage.name);    el.detailName.textContent = stage.name;
    el.detailMeta.replaceChildren(
      node('span', '', stage.format),
      node('span', '', t(STAGE_STATUS_KEYS[stage.status] || 'schedule.statusDraft')),
      node('span', '', stage.currentBatch > 0 ? t('schedule.roundLabel', { n: stage.currentBatch }) : t('schedule.roundNone')),
      node('span', '', `${(stage.startAt || '').replace('T', ' ')} ~ ${(stage.endAt || '').replace('T', ' ')}`)
    );

    renderDetailActions(stage);
    renderDetailBody(stage);
  }

  function renderDetailActions(stage) {
    const toggleLabels = { draft: 'schedule.startStage', live: 'schedule.pauseStage', paused: 'schedule.resumeStage' };
    const eventCompleted = state.event?.status === 'completed';
    if (stage.status === 'completed' || eventCompleted) {
      el.toggleBtn.textContent = t('schedule.statusCompleted');
      el.toggleBtn.disabled = true;
    } else {
      el.toggleBtn.textContent = t(toggleLabels[stage.status] || 'schedule.startStage');
      el.toggleBtn.disabled = false;
    }
    el.completeBtn.disabled = stage.status === 'draft' || stage.status === 'completed' || eventCompleted;
    el.deleteBtn.disabled = eventCompleted;
    if (stage.status === 'live' && stage.canGenerateNext && !eventCompleted) {
      el.nextRoundBtn.disabled = false;
      el.nextRoundBtn.title = '';
    } else if (stage.status === 'live') {
      el.nextRoundBtn.disabled = true;
      el.nextRoundBtn.title = stage.planBlockedReason || t('schedule.nextRoundHint');
    } else {
      el.nextRoundBtn.disabled = true;
      el.nextRoundBtn.title = '';
    }
  }

  function renderDetailBody(stage) {
    const body = [];
    if (stage.championTeamId) {
      const champion = stage.teams.find(team => team.id === stage.championTeamId);
      const banner = node('p', 'schedule-round-empty', t('schedule.champion', { name: champion?.name || stage.championTeamId }));
      banner.style.color = '#0d7a4d';
      body.push(banner);
    }
    if (stage.status === 'draft') {
      body.push(node('p', 'schedule-round-empty', t('schedule.draftHint')));
    } else if (!stage.rounds.length) {
      body.push(node('p', 'schedule-round-empty', t('schedule.noRounds')));
    }
    for (const round of stage.rounds) {
      const group = node('section', 'schedule-round-group');
      const head = node('header', 'schedule-round-head');
      head.append(
        node('h4', '', t('schedule.roundLabel', { n: round.roundNumber })),
        (() => {
          const chip = node('span', 'schedule-status-chip', t(round.status === 'completed' ? 'schedule.roundDone' : 'schedule.roundActive'));
          chip.dataset.state = round.status === 'completed' ? 'completed' : 'live';
          return chip;
        })()
      );
      group.append(head);
      if (!round.matches.length) {
        group.append(node('p', 'schedule-round-empty', t('schedule.byeRound')));
      } else {
        const grid = node('div', 'schedule-match-grid');
        grid.append(...round.matches.map(match => matchCard(stage, match)));
        group.append(grid);
      }
      body.push(group);
    }
    el.detailBody.replaceChildren(...body);
  }

  function matchCard(stage, match) {
    const card = node('article', `schedule-match-card${match.status === 'completed' ? ' is-completed' : ''}`);
    const top = node('div', 'schedule-match-top');
    const bracketChip = node('span', 'schedule-bracket-chip', t(BRACKET_KEYS[match.bracket] || match.bracket));
    bracketChip.dataset.bracket = match.bracket;
    top.append(bracketChip, node('span', 'schedule-match-format', match.format));
    card.append(top);

    const home = stage.teams.find(team => team.id === match.homeTeamId) || { id: match.homeTeamId, name: match.homeName, logo: match.homeLogo };
    const away = stage.teams.find(team => team.id === match.awayTeamId) || { id: match.awayTeamId, name: match.awayName, logo: match.awayLogo };
    card.append(matchSide(home, match.status === 'completed' && match.winnerTeamId === match.homeTeamId));
    card.append(matchSide(away, match.status === 'completed' && match.winnerTeamId === match.awayTeamId));

    const copy = node('p', 'schedule-match-copy');
    copy.append(
      node('span', '', match.startTime ? match.startTime.replace('T', ' ') : t('schedule.timeUnset')),
      node('span', '', match.executorName ? `${t('schedule.executor')}: ${match.executorName}` : `${t('schedule.executor')}: ${t('schedule.executorUnassigned')}`)
    );
    card.append(copy);

    if (match.status === 'pending' && (stage.status === 'live' || stage.status === 'paused') && state.event?.status !== 'completed') {
      const actions = node('div', 'schedule-match-actions');
      const editBtn = node('button', 'schedule-mini-btn', t('schedule.edit'));
      editBtn.type = 'button';
      editBtn.addEventListener('click', () => openMatchEdit(stage, match));
      const resultBtn = node('button', 'schedule-mini-btn', t('schedule.record'));
      resultBtn.type = 'button';
      resultBtn.addEventListener('click', () => openResultDialog(stage, match));
      actions.append(editBtn, resultBtn);
      if (match.bpReady) {
        const bpButton = node('button', 'schedule-mini-btn schedule-start-bp', t('schedule.startBp'));
        bpButton.type = 'button';
        bpButton.addEventListener('click', () => launchBp(stage, match));
        actions.append(bpButton);
      }
      card.append(actions);
    }
    return card;
  }

  function matchSide(team, isWinner) {
    const side = node('div', `schedule-match-side${isWinner ? ' is-winner' : ''}`);
    side.append(teamLogoFrame(team));
    side.append(node('strong', '', team?.name || t('schedule.unknownTeam')));
    if (isWinner) side.append(node('span', 'schedule-status-chip', t('schedule.winnerChip')));
    return side;
  }

  function setFeedback(target, message, isSuccess = false) {
    target.textContent = message || '';
    target.classList.toggle('is-success', isSuccess);
  }

  /* ===== 创建阶段弹窗 ===== */
  function openCreateDialog() {
    el.createForm.reset();
    state.createSelectedIds = new Set();
    el.weekdayPills.forEach(pill => pill.classList.remove('is-selected'));
    const start = new Date(Date.now() + 3600000);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 24 * 3600000);
    el.stageStart.value = toLocalInputValue(start);
    el.stageEnd.value = toLocalInputValue(end);
    setFeedback(el.createFeedback, '');
    renderTeamOptions();
    el.createDialog.showModal();
  }

  function toLocalInputValue(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function renderTeamOptions() {
    const division = el.stageDivision.value;
    const eligible = state.teams.filter(team => !division || team.division === division || !team.division);
    if (!eligible.length) {
      el.teamGrid.replaceChildren();
      el.teamsEmpty.hidden = false;
    } else {
      el.teamsEmpty.hidden = true;
      el.teamGrid.replaceChildren(...eligible.map(team => {
        const option = node('button', `schedule-team-option${state.createSelectedIds.has(team.id) ? ' is-selected' : ''}`);
        option.type = 'button';
        option.append(teamLogoFrame(team));
        option.append(node('strong', '', team.name));
        option.addEventListener('click', () => {
          if (state.createSelectedIds.has(team.id)) state.createSelectedIds.delete(team.id);
          else state.createSelectedIds.add(team.id);
          option.classList.toggle('is-selected');
          el.teamCount.textContent = t('schedule.teamsPicked', { n: state.createSelectedIds.size });
        });
        return option;
      }));
    }
    el.teamCount.textContent = t('schedule.teamsPicked', { n: state.createSelectedIds.size });
  }

  async function submitCreate(event) {
    event.preventDefault();
    const weekdays = el.weekdayPills.filter(pill => pill.classList.contains('is-selected')).map(pill => Number(pill.dataset.day));
    const teamIds = [...state.createSelectedIds];
    if (!el.stageName.value.trim()) return setFeedback(el.createFeedback, t('schedule.needName'));
    if (!el.stageStart.value || !el.stageEnd.value) return setFeedback(el.createFeedback, t('schedule.needDates'));
    if (!weekdays.length) return setFeedback(el.createFeedback, t('schedule.needWeekday'));
    if (teamIds.length < 4) return setFeedback(el.createFeedback, t('schedule.needTeams'));
    const submit = $('scheduleStageCreateSubmit');
    submit.disabled = true;
    try {
      const stage = await api(`/api/events/${encodeURIComponent(state.event.id)}/stages`, {
        method: 'POST',
        body: {
          name: el.stageName.value.trim(),
          format: el.stageFormat.value,
          division: el.stageDivision.value || null,
          startAt: el.stageStart.value,
          endAt: el.stageEnd.value,
          matchDayMode: 'weekday',
          matchDate: null,
          weekdays,
          teamIds
        }
      });
      el.createDialog.close();
      state.selectedStageId = stage.stage?.id || null;
      await load();
    } catch (error) {
      setFeedback(el.createFeedback, error.message);
    } finally {
      submit.disabled = false;
    }
  }

  /* ===== 修改比赛弹窗 ===== */
  function fillSelect(select, items, value, emptyLabel) {
    select.replaceChildren(...[
      ...(emptyLabel ? [new Option(emptyLabel, '')] : []),
      ...items.map(item => new Option(item.name, item.id))
    ]);
    select.value = value || '';
  }

  function openMatchEdit(stage, match) {
    state.editMatchId = match.id;
    el.matchFormat.value = match.format;
    el.matchTime.value = match.startTime || '';
    const teamOptions = stage.teams.map(team => ({ id: team.id, name: team.name }));
    fillSelect(el.matchHome, teamOptions, match.homeTeamId);
    fillSelect(el.matchAway, teamOptions, match.awayTeamId);
    fillSelect(el.matchExecutor, state.executors, match.executorUserId, t('schedule.executorUnassigned'));
    el.matchBpRoom.value = match.bpRoom || 'A';
    ensureCommentatorOptions().then(options => {
      fillCommentatorSelects(Object.assign({ bpRoom: match.bpRoom }, options));
    }).catch(() => {});
    setFeedback(el.matchFeedback, '');
    el.matchDialog.showModal();
  }

  async function submitMatchEdit(event) {
    event.preventDefault();
    const stage = selectedStage();
    if (!stage || !state.editMatchId) return;
    if (el.matchHome.value === el.matchAway.value) return setFeedback(el.matchFeedback, t('schedule.sameTeams'));
    try {
      await api(`/api/events/${encodeURIComponent(state.event.id)}/stages/${encodeURIComponent(stage.id)}/matches/${encodeURIComponent(state.editMatchId)}`, {
        method: 'PUT',
        body: {
          format: el.matchFormat.value,
          startTime: el.matchTime.value || null,
          homeTeamId: el.matchHome.value,
          awayTeamId: el.matchAway.value,
          executorUserId: el.matchExecutor.value || null,
          bpRoom: el.matchBpRoom.value || 'A'
        }
      });
      el.matchDialog.close();
      await load();
    } catch (error) {
      setFeedback(el.matchFeedback, error.message);
    }
  }

  /* ===== BP 跳转 ===== */
  function launchBp(stage, match) {
    sessionStorage.setItem('stella.bpLaunch', JSON.stringify({ matchId: match.id, room: match.bpRoom || 'A' }));
    document.querySelector('.nav-btn[data-page="bp"]')?.click();
  }

  async function ensureCommentatorOptions() {
    if (state.commentatorOptions) return state.commentatorOptions;
    const payload = await api('/api/bp/commentator-options');
    state.commentatorOptions = payload;
    return payload;
  }

  function fillCommentatorSelects(match) {
    const options = state.commentatorOptions;
    if (!options) return;
    fillSelect(el.matchCommentator, options.commentatorImages || [], options.selectedImageId);
    fillSelect(el.matchCommentatorLogo, options.commentatorLogoImages || [], options.selectedLogoImageId);
    void match;
  }

  async function syncCommentator(kind, value) {
    if (!value) return;
    const endpoint = kind === 'image' ? '/api/bp/commentator-image' : '/api/bp/commentator-logo-image';
    const bodyKey = kind === 'image' ? 'imageId' : 'imageId';
    try {
      await api(endpoint, { method: 'POST', body: { [bodyKey]: value } });
      setFeedback(el.matchFeedback, t('schedule.obsSynced'), true);
    } catch (error) {
      setFeedback(el.matchFeedback, error.message);
    }
  }

  /* ===== 录入结果弹窗 ===== */
  function openResultDialog(stage, match) {
    state.resultMatchId = match.id;
    el.resultMatch.textContent = `${match.homeName || '?'} vs ${match.awayName || '?'} (${match.format})`;
    const home = stage.teams.find(team => team.id === match.homeTeamId) || { id: match.homeTeamId, name: match.homeName, logo: match.homeLogo };
    const away = stage.teams.find(team => team.id === match.awayTeamId) || { id: match.awayTeamId, name: match.awayName, logo: match.awayLogo };
    el.resultOptions.replaceChildren(...[home, away].filter(team => team.id).map(team => {
      const option = node('button', 'schedule-result-option');
      option.type = 'button';
      option.append(teamLogoFrame(team));
      option.append(node('strong', '', team.name || ''));
      option.addEventListener('click', async () => {
        try {
          await api(`/api/events/${encodeURIComponent(state.event.id)}/stages/${encodeURIComponent(stage.id)}/matches/${encodeURIComponent(match.id)}`, {
            method: 'POST',
            body: { winnerTeamId: team.id }
          });
          el.resultDialog.close();
          await load();
        } catch (error) {
          el.resultMatch.textContent = error.message;
        }
      });
      return option;
    }));
    el.resultDialog.showModal();
  }

  /* ===== 积分排名弹窗 ===== */
  async function openRanking() {
    el.rankingDialog.showModal();
    el.rankingBody.replaceChildren(node('p', 'schedule-ranking-empty', t('schedule.loading')));
    try {
      const payload = await api(`/api/events/${encodeURIComponent(state.event.id)}/ranking`);
      if (!payload.ranking.length) {
        el.rankingBody.replaceChildren(node('p', 'schedule-ranking-empty', t('schedule.rankingEmpty')));
        return;
      }
      const table = node('table');
      const head = node('tr');
      [t('schedule.rankIndex'), t('schedule.rankTeam'), t('schedule.rankPlayed'), t('schedule.rankWins')].forEach(label => {
        head.append(node('th', '', label));
      });
      const thead = node('thead');
      thead.append(head);
      const tbody = node('tbody');
      payload.ranking.forEach((row, index) => {
        const tr = node('tr');
        tr.append(
          node('td', 'schedule-rank-num', String(index + 1)),
          (() => {
            const td = node('td');
            const side = node('div', 'schedule-match-side');
            side.append(teamLogoFrame(row));
            side.append(node('strong', '', row.name));
            td.append(side);
            return td;
          })(),
          node('td', '', String(row.played)),
          node('td', '', String(row.wins))
        );
        tbody.append(tr);
      });
      table.append(thead, tbody);
      el.rankingBody.replaceChildren(table);
    } catch (error) {
      el.rankingBody.replaceChildren(node('p', 'schedule-ranking-empty', error.message));
    }
  }

  async function toggleStage() {
    const stage = selectedStage();
    if (!stage || stage.status === 'completed') return;
    try {
      const action = stage.status === 'draft' ? 'start' : stage.status === 'live' ? 'pause' : 'resume';
      await api(`/api/events/${encodeURIComponent(state.event.id)}/stages/${encodeURIComponent(stage.id)}/${action}`, { method: 'POST' });
      await load();
    } catch (error) {
      await window.StellaDialog?.alert?.({ title: t('schedule.operationFailed'), message: error.message, tone: 'danger' });
    }
  }

  async function completeStage() {
    const stage = selectedStage();
    if (!stage) return;
    const confirmed = await window.StellaDialog?.confirm?.({
      title: t('schedule.completeStage'),
      message: t('schedule.confirmComplete', { name: stage.name })
    });
    if (!confirmed) return;
    try {
      await api(`/api/events/${encodeURIComponent(state.event.id)}/stages/${encodeURIComponent(stage.id)}/complete`, { method: 'POST' });
      await load();
    } catch (error) {
      await window.StellaDialog?.alert?.({ title: t('schedule.operationFailed'), message: error.message, tone: 'danger' });
    }
  }

  async function nextRound() {
    const stage = selectedStage();
    if (!stage) return;
    try {
      await api(`/api/events/${encodeURIComponent(state.event.id)}/stages/${encodeURIComponent(stage.id)}/next-round`, { method: 'POST' });
      await load();
    } catch (error) {
      await window.StellaDialog?.alert?.({ title: t('schedule.operationFailed'), message: error.message, tone: 'danger' });
    }
  }

  async function deleteStage() {
    const stage = selectedStage();
    if (!stage) return;
    const confirmed = await window.StellaDialog?.confirm?.({
      title: t('schedule.confirmDeleteTitle'),
      message: t('schedule.confirmDeleteMessage', { name: stage.name }),
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      await api(`/api/events/${encodeURIComponent(state.event.id)}/stages/${encodeURIComponent(stage.id)}`, { method: 'DELETE' });
      state.selectedStageId = null;
      await load();
    } catch (error) {
      await window.StellaDialog?.alert?.({ title: t('schedule.operationFailed'), message: error.message, tone: 'danger' });
    }
  }

  el.newBtn.addEventListener('click', () => {
    if (!state.event) return;
    openCreateDialog();
  });
  el.createClose.addEventListener('click', () => el.createDialog.close());
  el.createCancel.addEventListener('click', () => el.createDialog.close());
  el.createForm.addEventListener('submit', submitCreate);
  el.stageDivision.addEventListener('change', renderTeamOptions);
  el.weekdayPills.forEach(pill => {
    pill.addEventListener('click', () => pill.classList.toggle('is-selected'));
  });

  el.matchCommentator.addEventListener('change', () => syncCommentator('image', el.matchCommentator.value));
  el.matchCommentatorLogo.addEventListener('change', () => syncCommentator('logo', el.matchCommentatorLogo.value));
  el.matchClose.addEventListener('click', () => el.matchDialog.close());
  el.matchCancel.addEventListener('click', () => el.matchDialog.close());
  el.matchForm.addEventListener('submit', submitMatchEdit);
  el.resultClose.addEventListener('click', () => el.resultDialog.close());
  el.rankingClose.addEventListener('click', () => el.rankingDialog.close());

  el.toggleBtn.addEventListener('click', toggleStage);
  el.completeBtn.addEventListener('click', completeStage);
  el.nextRoundBtn.addEventListener('click', nextRound);
  el.deleteBtn.addEventListener('click', deleteStage);
  el.refreshBtn.addEventListener('click', () => load());
  el.collapseBtn.addEventListener('click', () => {
    state.collapsed = true;
    layout();
  });
  el.expandBtn.addEventListener('click', () => {
    state.collapsed = false;
    layout();
  });
  el.backBtn.addEventListener('click', () => {
    document.querySelector('.nav-btn[data-page="events"]')?.click();
  });
  el.rankingBtn.addEventListener('click', openRanking);

  window.addEventListener('stella:identity-change', () => {
    sessionStorage.removeItem('stella.scheduleManagedEventId');
    state.selectedStageId = null;
    state.event = null;
    state.stages = [];
  });
  window.addEventListener('stella:page-change', event => {
    if (event.detail?.page !== 'schedule') return;
    root.querySelector('.schedule-page')?.classList.add('is-entering');
    window.setTimeout(() => root.querySelector('.schedule-page')?.classList.remove('is-entering'), 600);
    load();
  });
})();
