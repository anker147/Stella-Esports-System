(function () {
  'use strict';

  const root = document.getElementById('eventManagementRoot');
  if (!root) return;
  rebuildCreateInterface();

  function rebuildCreateInterface() {
    const method = document.getElementById('eventCreateMethod');
    const workflow = document.getElementById('eventEditorWorkflow');
    if (!method || !workflow) return;
    method.innerHTML = `<div class="event-method-hero"><span class="event-method-trophy"><svg viewBox="0 0 24 24" data-icon="trophy" aria-hidden="true"></svg></span><h3>${t('events.chooseMethod')}</h3><p>${t('events.chooseMethodDesc')}</p></div>
      <div class="event-method-grid">
        <button type="button" class="event-method-card is-formal" data-event-method="formal"><span class="event-method-icon"><svg viewBox="0 0 24 24" data-icon="trophy" aria-hidden="true"></svg></span><strong>${t('events.methodFormal')}</strong><small>${t('events.methodFormalDesc')}</small></button>
        <button type="button" class="event-method-card is-community" data-event-method="community"><span class="event-method-icon"><svg viewBox="0 0 24 24" data-icon="users-round" aria-hidden="true"></svg></span><strong>${t('events.methodCommunity')}</strong><small>${t('events.methodCommunityDesc')}</small><span class="event-development-mark">${t('common.developing')}</span></button>
        <button type="button" class="event-method-card is-quick" data-event-method="quick"><span class="event-method-icon"><svg viewBox="0 0 24 24" data-icon="zap" aria-hidden="true"></svg></span><strong>${t('events.methodQuick')}</strong><small>${t('events.methodQuickDesc')}</small><span class="event-development-mark">${t('common.developing')}</span></button>
      </div>`;
    workflow.innerHTML = `<nav class="event-stepper" id="eventStepper" aria-label="${t('events.createStepsAria')}"><button type="button" aria-current="step" data-event-step="0"><span>1</span><strong>${t('events.stepBasic')}</strong></button><i></i><button type="button" data-event-step="1"><span>2</span><strong>${t('events.stepConfig')}</strong></button><i></i><button type="button" data-event-step="2"><span>3</span><strong>${t('events.stepTeams')}</strong></button></nav>
      <div class="event-editor-panels">
        <section class="event-editor-step is-active" data-event-step-panel="0"><div class="event-form-columns">
          <div class="event-form-column"><label><span>${t('events.name')}</span><input id="eventName" maxlength="80" required></label><div class="event-logo-field"><span>${t('events.logo')}</span><div><span class="event-logo-preview"><img id="eventLogoImage" alt="" hidden><b id="eventLogoFallback">${t('events.logoInitial')}</b></span><input class="visually-hidden" id="eventLogoInput" type="file" accept="image/png,image/jpeg,image/webp"><button class="btn btn-secondary" id="eventLogoChoose" type="button">${t('events.uploadLogo')}</button></div></div><label><span>${t('events.handbook')}</span><span class="event-url-control"><input id="eventHandbookUrl" type="url" placeholder="https://..."><a id="eventHandbookOpen" href="#" target="_blank" rel="noopener noreferrer" aria-disabled="true">${t('events.openLink')}</a></span><small>${t('events.handbookHelp')}</small></label><fieldset><legend>${t('events.organizerType')}</legend><div class="event-radio-grid"><label><input type="radio" name="organizerType" value="personal" checked><span><b>${t('events.personal')}</b><small>${t('events.personalHostDesc')}</small></span></label><label><input type="radio" name="organizerType" value="organization"><span><b>${t('events.organization')}</b><small>${t('events.organizationHostDesc')}</small></span></label></div></fieldset><label><span>${t('events.organizer')}</span><input id="eventOrganizerName" maxlength="100" required></label></div>
          <div class="event-form-column"><div class="event-kv-upload" id="eventCoverPreview"><img id="eventCoverImage" alt="" hidden><span>${t('events.kv')}</span><small>${t('events.kvHelp')}</small><input class="visually-hidden" id="eventCoverInput" type="file" accept="image/png,image/jpeg,image/webp"><button class="btn btn-secondary" id="eventCoverChoose" type="button">${t('events.uploadKv')}</button></div><label><span>${t('events.contactGroup')}</span><input id="eventContactGroup" maxlength="160" required placeholder="${t('events.contactGroupPlaceholder')}"></label><label><span>${t('events.contactGroupLink')}</span><input id="eventContactGroupUrl" type="url" placeholder="https://..."></label><div class="event-qr-upload"><button type="button" id="eventGroupQrChoose" aria-label="${t('events.importQr')}"><svg viewBox="0 0 24 24" data-icon="qr-code" aria-hidden="true"></svg></button><span><strong>${t('events.importQr')}</strong><small>${t('events.importQrHelp')}</small></span><input class="visually-hidden" id="eventGroupQrInput" type="file" accept="image/png,image/jpeg,image/webp"></div></div>
        </div></section>
        <section class="event-editor-step" data-event-step-panel="1" hidden><div class="event-form-columns"><div class="event-form-column"><label><span>${t('events.format')}</span><select id="eventFormat"><option>${t('events.formatDoubleBo3')}</option><option>${t('events.formatSingleBo3')}</option><option>${t('events.formatSingleBo5')}</option><option>${t('events.formatRoundRobin')}</option><option>${t('events.formatCustom')}</option></select></label><label><span>${t('events.maxTeams')}</span><input id="eventMaxTeams" type="number" min="2" max="128" value="8" required></label><label><span>${t('events.division')}</span><select id="eventDivision"><option value="all">${t('events.division.all')}</option><option value="pc">${t('events.division.pc')}</option><option value="mobile">${t('events.division.mobile')}</option></select></label></div><div class="event-form-column"><label><span>${t('events.startDate')}</span><input id="eventStartDate" type="date" required></label><label><span>${t('events.endDate')}</span><input id="eventEndDate" type="date" required></label></div></div></section>
        <section class="event-editor-step event-team-step" data-event-step-panel="2" hidden><div class="event-team-layout"><div class="event-team-column event-team-selected-column"><div class="event-team-toolbar"><label class="event-team-field"><span>${t('events.minimum')}</span><input id="eventMinMembers" type="number" min="1" max="99" value="2" required></label><label class="event-team-field"><span>${t('events.maximum')}</span><input id="eventMaxMembers" type="number" min="1" max="99" value="10" required></label><button class="event-team-search" id="eventTeamSearch" type="button" aria-label="${t('events.teamSearchAria')}"><svg viewBox="0 0 24 24" data-icon="search" aria-hidden="true"></svg><span>${t('events.search')}</span></button></div><div class="event-team-panel"><header><strong>${t('events.selectedTeams')}</strong><span id="eventSelectedTeamCount">${t('events.teamCountValue', { count: 0 })}</span></header><div class="event-team-list" id="eventTeamSelectedList" data-state="empty"><strong>${t('events.teamSelectedEmpty')}</strong><span>${t('events.teamSelectedEmptyDesc')}</span></div></div></div><div class="event-team-column event-team-available-column"><div class="event-team-panel"><header><strong>${t('events.availableTeams')}</strong><button class="event-team-select-all" id="eventTeamSelectAll" type="button" disabled>${t('events.selectAll')}</button></header><div class="event-team-list" id="eventTeamResults" data-state="empty"><strong>${t('events.teamSearchIdle')}</strong><span>${t('events.teamSearchIdleDesc')}</span></div></div></div></div></section>
      </div>
      <input id="eventDescription" type="hidden" value=""><input id="eventVisibility" type="hidden" value="system"><input id="eventRegistrationMethod" type="hidden" value="invite"><input id="eventTeamRequirement" type="hidden" value="any"><input id="eventRequireRealName" type="checkbox" hidden><input id="eventRegistrationStart" type="hidden"><input id="eventRegistrationEnd" type="hidden"><input id="eventRequireLogin" type="checkbox" checked hidden><input id="eventContact" type="hidden"><input id="eventRules" type="hidden" value="${t('events.rulesDefault')}"><span id="eventRulesCount" hidden>0</span>`;
  }

  const elements = {
    grid: document.getElementById('eventCardGrid'),
    empty: document.getElementById('eventManagementEmpty'),
    status: document.getElementById('eventManagementStatus'),
    create: document.getElementById('eventCreateButton'),
    filters: [...document.querySelectorAll('[data-event-filter]')],
    counts: [...document.querySelectorAll('[data-event-count]')],
    dialog: document.getElementById('eventEditorDialog'),
    form: document.getElementById('eventEditorForm'),
    close: document.getElementById('eventEditorClose'),
    closeGuard: document.getElementById('eventCloseGuardDialog'),
    closeGuardSave: document.getElementById('eventCloseGuardSave'),
    closeGuardDiscard: document.getElementById('eventCloseGuardDiscard'),
    closeGuardStay: document.getElementById('eventCloseGuardStay'),
    mode: document.getElementById('eventEditorMode'),
    title: document.getElementById('eventEditorTitle'),
    method: document.getElementById('eventCreateMethod'),
    workflow: document.getElementById('eventEditorWorkflow'),
    footer: document.getElementById('eventEditorFooter'),
    stepper: document.getElementById('eventStepper'),
    panels: [...document.querySelectorAll('[data-event-step-panel]')],
    previous: document.getElementById('eventEditorPrevious'),
    next: document.getElementById('eventEditorNext'),
    submit: document.getElementById('eventEditorSubmit'),
    feedback: document.getElementById('eventEditorFeedback'),
    name: document.getElementById('eventName'),
    format: document.getElementById('eventFormat'),
    maxTeams: document.getElementById('eventMaxTeams'),
    description: document.getElementById('eventDescription'),
    visibility: document.getElementById('eventVisibility'),
    registrationMethod: document.getElementById('eventRegistrationMethod'),
    teamRequirement: document.getElementById('eventTeamRequirement'),
    division: document.getElementById('eventDivision'),
    requireRealName: document.getElementById('eventRequireRealName'),
    startDate: document.getElementById('eventStartDate'),
    endDate: document.getElementById('eventEndDate'),
    registrationStart: document.getElementById('eventRegistrationStart'),
    registrationEnd: document.getElementById('eventRegistrationEnd'),
    minMembers: document.getElementById('eventMinMembers'),
    maxMembers: document.getElementById('eventMaxMembers'),
    requireLogin: document.getElementById('eventRequireLogin'),
    organizerName: document.getElementById('eventOrganizerName'),
    contact: document.getElementById('eventContact'),
    rules: document.getElementById('eventRules'),
    rulesCount: document.getElementById('eventRulesCount'),
    logoInput: document.getElementById('eventLogoInput'),
    logoChoose: document.getElementById('eventLogoChoose'),
    logoImage: document.getElementById('eventLogoImage'),
    logoFallback: document.getElementById('eventLogoFallback'),
    coverInput: document.getElementById('eventCoverInput'),
    coverChoose: document.getElementById('eventCoverChoose'),
    coverImage: document.getElementById('eventCoverImage'),
    handbookUrl: document.getElementById('eventHandbookUrl'),
    handbookOpen: document.getElementById('eventHandbookOpen'),
    contactGroup: document.getElementById('eventContactGroup'),
    contactGroupUrl: document.getElementById('eventContactGroupUrl'),
    groupQrInput: document.getElementById('eventGroupQrInput'),
    groupQrChoose: document.getElementById('eventGroupQrChoose'),
    teamSearch: document.getElementById('eventTeamSearch'),
    teamResults: document.getElementById('eventTeamResults'),
    teamSelected: document.getElementById('eventTeamSelectedList'),
    selectedTeamCount: document.getElementById('eventSelectedTeamCount'),
    teamSelectAll: document.getElementById('eventTeamSelectAll')
  };

  let activeFilter = 'live';
  let activeStep = 0;
  let editingEvent = null;
  let items = [];
  let canManage = false;
  let loading = false;
  let dialogTrigger = null;
  let editorDirty = false;

  function markEditorDirty() {
    editorDirty = true;
  }

  function requestCloseEditor() {
    if (editorDirty) {
      elements.closeGuard.showModal();
      return;
    }
    elements.dialog.close('cancel');
  }
  let logoDraft = null;
  let logoChanged = false;
  let coverDraft = null;
  let coverChanged = false;
  let groupQrDraft = null;
  let groupQrChanged = false;
  let selectedTeamIds = [];

  function t(key, params = {}) {
    return window.t?.(key, params) || key;
  }

  function node(tag, className, content) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (content !== undefined) result.textContent = String(content);
    return result;
  }

  function formatDate(value) {
    if (!value) return t('events.datePending');
    const date = new Date(`${value}T00:00:00`);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function divisionLabel(value) {
    return t(`events.division.${value || 'all'}`);
  }

  function statusLabel(value) {
    return t(`events.status.${value || 'upcoming'}`);
  }

  function iconPath(name) {
    const paths = {
      edit: '<path d="M3 11.8V14h2.2L12.7 6.5 10.5 4 3 11.8zM9.8 4.8l2.2 2.2M9.8 4.8l1.1-1.1a1.4 1.4 0 012 0l.4.4a1.4 1.4 0 010 2L12 7"/>',
      schedule: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.3"/><path d="M2.5 6.5h11M5 2v3M11 2v3M5 9h2M9 9h2M5 11.3h2"/>',
      play: '<path d="M5 3.2l7 4.8-7 4.8V3.2z"/>',
      stop: '<rect x="4" y="4" width="8" height="8" rx="1"/>',
      mark: '<path d="M4 2.5h8v11l-4-2.6-4 2.6v-11z"/>',
      marked: '<path fill="currentColor" d="M4 2.5h8v11l-4-2.6-4 2.6v-11z"/>'
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.35');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = paths[name] || '';
    return svg;
  }

  function actionButton(label, icon, handler, className = '') {
    const button = node('button', `event-card-action ${className}`.trim());
    button.type = 'button';
    button.append(iconPath(icon), node('span', '', label));
    button.addEventListener('click', handler);
    return button;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || t('common.requestFailed', { status: response.status }));
    return payload;
  }

  function fact(label, value) {
    const wrap = node('div');
    wrap.append(node('dt', '', label), node('dd', '', value));
    return wrap;
  }

  function context(label, value, title = '') {
    const wrap = node('span');
    wrap.append(node('small', '', label));
    const strong = node('strong', '', value);
    if (title) strong.title = title;
    wrap.append(strong);
    return wrap;
  }

  function nextMatchLabel(event) {
    if (!event.nextMatch) return t('events.noNextMatch');
    return `${formatDate(event.nextMatch.date)} ${event.nextMatch.startTime || ''} ${event.nextMatch.matchup}`.trim();
  }

  function renderCard(event, index) {
    const card = node('article', `event-card ${event.marked ? 'is-marked' : ''}`.trim());
    card.style.setProperty('--event-card-delay', `${Math.min(index, 8) * 35}ms`);
    const header = node('header', 'event-card-header');
    const logo = node('span', 'event-card-logo');
    if (event.logoUrl) {
      const image = document.createElement('img');
      image.src = event.logoUrl;
      image.alt = '';
      image.addEventListener('error', () => {
        image.remove();
        logo.textContent = event.name.slice(0, 1);
      }, { once: true });
      logo.append(image);
    } else {
      logo.textContent = event.name.slice(0, 1);
    }
    const title = node('div', 'event-card-title');
    const nameRow = node('div', 'event-card-name-row');
    nameRow.append(node('h2', '', event.name), node('span', '', event.organizerName));
    const meta = node('div', 'event-card-meta');
    meta.append(node('span', `event-card-chip is-${event.status}`, statusLabel(event.status)));
    meta.append(node('span', 'event-card-chip', t('events.scale', { count: event.maxTeams || event.teamCount || 0 })));
    meta.append(node('span', 'event-card-chip', event.mode));
    title.append(nameRow, meta);
    header.append(logo, title);
    if (event.marked) {
      const mark = node('span', 'event-mark-indicator');
      mark.title = t('events.marked');
      mark.append(iconPath('marked'));
      header.append(mark);
    }

    const facts = node('dl', 'event-card-facts');
    facts.append(
      fact(t('events.startDate'), formatDate(event.startDate)),
      fact(t('events.endDate'), formatDate(event.endDate)),
      fact(t('events.teamCount'), t('events.teamCountValue', { count: event.teamCount })),
      fact(t('events.format'), event.format)
    );

    const details = node('div', 'event-card-context');
    details.append(
      context(t('events.currentStage'), event.stage),
      context(t('events.division'), divisionLabel(event.division)),
      context(t('events.environment'), event.requireSystemLogin ? t('events.environmentSystem') : t('events.environmentExternal')),
      context(t('events.nextMatch'), nextMatchLabel(event), nextMatchLabel(event))
    );

    const actions = node('footer', 'event-card-actions');
    if (canManage) actions.append(actionButton(t('common.edit'), 'edit', () => openEditor(event)));
    const scheduleButton = actionButton(t('events.scheduleManagement'), 'schedule', () => openSchedule(event.id));
    scheduleButton.disabled = event.status !== 'live' && event.status !== 'completed';
    if (scheduleButton.disabled) scheduleButton.title = t('events.scheduleRequiresLive');
    actions.append(scheduleButton);
    if (canManage) {
      if (event.status !== 'completed') {
        const statusAction = event.status === 'live' ? 'end' : 'start';
        actions.append(actionButton(
          statusAction === 'end' ? t('events.manualEnd') : t('events.manualStart'),
          statusAction === 'end' ? 'stop' : 'play',
          () => performAction(event, statusAction),
          'is-primary'
        ));
      }
      actions.append(actionButton(event.marked ? t('events.unmark') : t('events.mark'), event.marked ? 'marked' : 'mark', () => performAction(event, 'toggle-mark')));
    }
    card.append(header, facts, details, actions);
    return card;
  }

  function render(payload) {
    canManage = Boolean(payload.canManage);
    items = payload.items || [];
    elements.create.hidden = !canManage;
    elements.counts.forEach(count => {
      count.textContent = String(payload.counts?.[count.dataset.eventCount] || 0);
    });
    elements.grid.replaceChildren(...items.map(renderCard));
    elements.empty.hidden = items.length > 0;
  }

  async function load(force = false) {
    if (loading) return;
    loading = true;
    root.setAttribute('aria-busy', 'true');
    elements.status.textContent = t('events.loading');
    elements.status.className = 'event-management-status';
    try {
      const payload = await api(`/api/events?filter=${encodeURIComponent(activeFilter)}${force ? `&t=${Date.now()}` : ''}`);
      render(payload);
      elements.status.textContent = t('events.loaded', { count: items.length });
    } catch (error) {
      elements.status.textContent = t('events.loadFailed', { error: error.message });
      elements.status.className = 'event-management-status is-error';
    } finally {
      loading = false;
      root.removeAttribute('aria-busy');
    }
  }

  function setFilter(filter) {
    if (filter === activeFilter) return;
    activeFilter = filter;
    elements.filters.forEach(button => button.setAttribute('aria-selected', String(button.dataset.eventFilter === filter)));
    load(true);
  }

  function openSchedule(eventId) {
    sessionStorage.setItem('stella.scheduleManagedEventId', eventId);
    window.dispatchEvent(new CustomEvent('stella:operations-filter', {
      detail: { view: 'schedule', managedEventId: eventId }
    }));
    document.querySelector('[data-page="schedule"]:not([hidden])')?.click();
  }

  async function performAction(event, action) {
    if (action !== 'toggle-mark') {
      const confirmed = await window.StellaDialog.confirm({
        title: action === 'start' ? t('events.startConfirmTitle') : t('events.endConfirmTitle'),
        message: action === 'start'
          ? t('events.startConfirm', { name: event.name })
          : t('events.endConfirm', { name: event.name }),
        confirmText: action === 'start' ? t('events.manualStart') : t('events.manualEnd'),
        tone: action === 'end' ? 'danger' : 'default'
      });
      if (!confirmed) return;
    }
    try {
      await api(`/api/events/${encodeURIComponent(event.id)}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      window.StellaDataCache?.invalidate('/api/events');
      await load(true);
    } catch (error) {
      await window.StellaDialog.alert({ title: t('events.actionFailedTitle'), message: error.message, tone: 'danger' });
    }
  }

  function setImagePreview(image, fallback, value, fallbackText) {
    if (value) {
      image.src = value;
      image.hidden = false;
      if (fallback) fallback.hidden = true;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      if (fallback) {
        fallback.hidden = false;
        fallback.textContent = fallbackText || t('events.logoFallback');
      }
    }
  }

  function today(offset = 0) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return date.toLocaleDateString('sv-SE');
  }

  function resetEditor() {
    elements.form.reset();
    editingEvent = null;
    logoDraft = null;
    logoChanged = false;
    coverDraft = null;
    coverChanged = false;
    groupQrDraft = null;
    groupQrChanged = false;
    selectedTeamIds = [];
    teamCandidates = [];
    teamCandidates = [];
    elements.format.value = t('events.formatDoubleBo3');
    elements.maxTeams.value = '8';
    elements.visibility.value = 'system';
    elements.registrationMethod.value = 'invite';
    elements.teamRequirement.value = 'any';
    elements.division.value = 'all';
    elements.startDate.value = today();
    elements.endDate.value = today(1);
    elements.registrationStart.value = today(-7);
    elements.registrationEnd.value = today(-1);
    elements.minMembers.value = '2';
    elements.maxMembers.value = '10';
    elements.requireLogin.checked = true;
    elements.rulesCount.textContent = '0';
    elements.handbookUrl.value = '';
    updateHandbookLink();
    elements.contactGroup.value = '';
    elements.contactGroupUrl.value = '';
    elements.teamResults.dataset.state = 'empty';
    elements.teamResults.innerHTML = `<strong>${t('events.teamSearchIdle')}</strong><span>${t('events.teamSearchIdleDesc')}</span>`;
    elements.teamSelected.innerHTML = `<strong>${t('events.teamSelectedEmpty')}</strong><span>${t('events.teamSelectedEmptyDesc')}</span>`;
    elements.teamSelected.dataset.state = 'empty';
    elements.teamSelectAll.disabled = true;
    elements.teamSelectAll.textContent = t('events.selectAll');
    elements.feedback.textContent = '';
    elements.feedback.className = 'event-editor-feedback';
    setImagePreview(elements.logoImage, elements.logoFallback, '', t('events.logoFallback'));
    setImagePreview(elements.coverImage, null, '');
  }

  function populateEditor(event) {
    resetEditor();
    editingEvent = event;
    elements.name.value = event.name || '';
    elements.format.value = [...elements.format.options].some(option => option.value === event.format) ? event.format : t('events.formatCustom');
    elements.maxTeams.value = event.maxTeams || Math.max(2, event.teamCount || 8);
    elements.description.value = event.description || '';
    elements.visibility.value = event.visibility || 'system';
    elements.registrationMethod.value = event.registrationMethod || 'invite';
    elements.teamRequirement.value = event.teamRequirement || 'any';
    elements.division.value = event.division || 'all';
    elements.requireRealName.checked = Boolean(event.requireRealName);
    elements.startDate.value = event.startDate || today();
    elements.endDate.value = event.endDate || event.startDate || today(1);
    elements.registrationStart.value = event.registrationStart || '';
    elements.registrationEnd.value = event.registrationEnd || '';
    elements.minMembers.value = event.minTeamMembers || 2;
    elements.maxMembers.value = event.maxTeamMembers || 10;
    selectedTeamIds = Array.isArray(event.teamIds) ? [...event.teamIds] : [];
    elements.requireLogin.checked = event.requireSystemLogin !== false;
    document.querySelector(`[name="organizerType"][value="${event.organizerType || 'personal'}"]`).checked = true;
    elements.organizerName.value = event.organizerName === t('events.organizerPending') ? '' : event.organizerName || '';
    elements.contact.value = event.contact || '';
    elements.handbookUrl.value = event.handbookUrl || '';
    updateHandbookLink();
    elements.contactGroup.value = event.contactGroup || event.contact || '';
    elements.contactGroupUrl.value = event.contactGroupUrl || '';
    elements.rules.value = event.rulesText || '';
    elements.rulesCount.textContent = String(elements.rules.value.length);
    setImagePreview(elements.logoImage, elements.logoFallback, event.logoUrl || '', event.name.slice(0, 1));
    setImagePreview(elements.coverImage, null, event.coverUrl || '');
  }

  function setStep(step, focus = true) {
    activeStep = Math.max(0, Math.min(2, step));
    [...elements.stepper.querySelectorAll('[data-event-step]')].forEach(button => {
      const value = Number(button.dataset.eventStep);
      button.toggleAttribute('aria-current', value === activeStep);
      if (value === activeStep) button.setAttribute('aria-current', 'step');
      button.classList.toggle('is-complete', value < activeStep);
    });
    elements.panels.forEach(panel => {
      const current = Number(panel.dataset.eventStepPanel) === activeStep;
      panel.hidden = !current;
      panel.classList.toggle('is-active', current);
    });
    elements.previous.hidden = activeStep === 0;
    elements.next.hidden = activeStep === 2;
    elements.submit.hidden = activeStep !== 2;
    elements.feedback.textContent = '';
    elements.feedback.className = 'event-editor-feedback';
    if (focus) elements.panels[activeStep].querySelector('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')?.focus();
  }

  function showWorkflow() {
    elements.form.classList.add('is-workflow');
    elements.method.setAttribute('hidden', '');
    elements.workflow.removeAttribute('hidden');
    elements.footer.removeAttribute('hidden');
    elements.workflow.dataset.visible = 'true';
    elements.mode.textContent = editingEvent ? t('events.editEvent') : t('events.createEvent');
    elements.title.textContent = editingEvent ? editingEvent.name : t('events.createEvent');
    setStep(0, false);
    window.requestAnimationFrame(() => elements.name.focus());
  }

  function openCreate(trigger) {
    dialogTrigger = trigger;
    resetEditor();
    editorDirty = false;
    elements.mode.textContent = t('events.createEvent');
    elements.title.textContent = t('events.createEvent');
    elements.form.classList.remove('is-workflow');
    elements.method.removeAttribute('hidden');
    elements.workflow.setAttribute('hidden', '');
    elements.footer.setAttribute('hidden', '');
    delete elements.workflow.dataset.visible;
    elements.dialog.showModal();
    window.requestAnimationFrame(() => elements.method.querySelector('[data-event-method="formal"]')?.focus());
  }

  function openEditor(event, trigger = document.activeElement) {
    dialogTrigger = trigger instanceof HTMLElement ? trigger : null;
    editorDirty = false;
    populateEditor(event);
    elements.method.hidden = true;
    elements.workflow.hidden = false;
    elements.footer.hidden = false;
    elements.dialog.showModal();
    showWorkflow();
  }

  async function showValidation(control, message) {
    await window.StellaDialog.alert({
      title: t('events.validationTitle'),
      message,
      tone: 'warning'
    });
    control?.focus();
    return false;
  }

  async function validateStep(step) {
    const controls = [...elements.panels[step].querySelectorAll('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')];
    const invalid = controls.find(control => !control.checkValidity());
    if (invalid) {
      const field = invalid.closest('label')?.querySelector(':scope > span')?.textContent?.trim()
        || invalid.closest('fieldset')?.querySelector('legend')?.textContent?.trim()
        || t('events.fieldFallback');
      const message = invalid.validity.valueMissing
        ? t('events.fieldRequired', { field })
        : t('events.fieldInvalid', { field });
      return showValidation(invalid, message);
    }
    if (step === 1) {
      if (elements.endDate.value < elements.startDate.value) {
        return showValidation(elements.endDate, t('events.invalidEventDates'));
      }
    }
    if (step === 2) {
      if (Number(elements.maxMembers.value) < Number(elements.minMembers.value)) {
        return showValidation(elements.maxMembers, t('events.invalidTeamMembers'));
      }
      if (selectedTeamIds.length < 2) return showValidation(elements.teamSearch, t('events.selectTeamsRequired'));
      if (selectedTeamIds.length > Number(elements.maxTeams.value)) {
        return showValidation(elements.teamSearch, t('events.teamLimitExceeded', { selected: selectedTeamIds.length, limit: elements.maxTeams.value }));
      }
    }
    return true;
  }

  function payload() {
    return {
      name: elements.name.value.trim(),
      format: elements.format.value,
      maxTeams: Number(elements.maxTeams.value),
      description: elements.description.value.trim(),
      eventType: 'private',
      requireRealName: elements.requireRealName.checked,
      visibility: elements.visibility.value,
      registrationMethod: elements.registrationMethod.value,
      teamRequirement: elements.teamRequirement.value,
      division: elements.division.value,
      startDate: elements.startDate.value,
      endDate: elements.endDate.value,
      registrationStart: elements.registrationStart.value,
      registrationEnd: elements.registrationEnd.value,
      minTeamMembers: Number(elements.minMembers.value),
      maxTeamMembers: Number(elements.maxMembers.value),
      requireSystemLogin: elements.requireLogin.checked,
      organizerType: document.querySelector('[name="organizerType"]:checked')?.value || 'personal',
      organizerName: elements.organizerName.value.trim(),
      contact: elements.contactGroup.value.trim(),
      handbookUrl: elements.handbookUrl.value.trim(),
      contactGroup: elements.contactGroup.value.trim(),
      contactGroupUrl: elements.contactGroupUrl.value.trim(),
      rulesText: elements.rules.value.trim(),
      teamIds: selectedTeamIds,
      ...(logoChanged ? { logoChanged: true, logo: logoDraft } : {}),
      ...(coverChanged ? { coverChanged: true, cover: coverDraft } : {}),
      ...(groupQrChanged ? { groupQrChanged: true, groupQr: groupQrDraft } : {})
    };
  }

  // The byte limit applies to the compressed artifact; QR codes pass no
  // compress options because lossy re-encoding can break scanning.
  async function readImage(file, maximum, label, compressOptions) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(t('events.invalidImage', { label }));
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(t('events.imageReadFailed', { label })));
      reader.readAsDataURL(file);
    });
    if (compressOptions && window.ImageCompress?.compress) {
      let compressed = null;
      try {
        compressed = await window.ImageCompress.compress(source, compressOptions);
      } catch (error) {
        compressed = null;
      }
      if (compressed) {
        if (compressed.bytes > maximum) throw new Error(t('events.imageTooLarge', { label }));
        return compressed.dataUrl;
      }
    }
    if (file.size > maximum) throw new Error(t('events.imageTooLarge', { label }));
    return source;
  }

  async function handleImage(input, kind) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const logo = kind === 'logo';
    const qr = kind === 'groupQr';
    const label = qr ? t('events.groupQr') : t(logo ? 'events.logo' : 'events.cover');
    try {
      const value = await readImage(
        file,
        logo ? 2 * 1024 * 1024 : 4 * 1024 * 1024,
        label,
        qr ? null : { maxEdge: logo ? 512 : 1600, quality: 0.85 }
      );
      if (logo) {
        logoDraft = value;
        logoChanged = true;
        setImagePreview(elements.logoImage, elements.logoFallback, value, elements.name.value.slice(0, 1));
      } else if (qr) {
        groupQrDraft = value;
        groupQrChanged = true;
        elements.groupQrChoose.classList.add('is-ready');
      } else {
        coverDraft = value;
        coverChanged = true;
        setImagePreview(elements.coverImage, null, value);
      }
    } catch (error) {
      await window.StellaDialog.alert({
        title: t('events.imageFailedTitle'),
        message: error.message,
        tone: 'warning'
      });
    }
  }

  function updateHandbookLink() {
    const value = elements.handbookUrl.value.trim();
    let valid = false;
    try {
      const url = new URL(value);
      valid = url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      valid = false;
    }
    elements.handbookOpen.href = valid ? value : '#';
    elements.handbookOpen.setAttribute('aria-disabled', String(!valid));
    elements.handbookOpen.tabIndex = valid ? 0 : -1;
  }

  let teamCandidates = [];

  function updateSelectAllButton() {
    if (!teamCandidates.length) {
      elements.teamSelectAll.disabled = true;
      elements.teamSelectAll.textContent = t('events.selectAll');
      elements.teamSelectAll.classList.remove('is-all-selected');
      return;
    }
    elements.teamSelectAll.disabled = false;
    const allSelected = teamCandidates.every(team => selectedTeamIds.includes(team.id));
    elements.teamSelectAll.textContent = allSelected ? t('events.unselectAll') : t('events.selectAll');
    elements.teamSelectAll.classList.toggle('is-all-selected', allSelected);
  }

  function syncTeamCardStates() {
    renderTeamLists();
    updateSelectAllButton();
  }

  function toggleTeamSelection(teamId, force) {
    const isSelected = selectedTeamIds.includes(teamId);
    const shouldSelect = force === undefined ? !isSelected : force;
    if (shouldSelect && !isSelected) {
      selectedTeamIds = [...selectedTeamIds, teamId];
    } else if (!shouldSelect && isSelected) {
      selectedTeamIds = selectedTeamIds.filter(id => id !== teamId);
    }
    syncTeamCardStates();
  }

  const teamDivisionLabels = { pc: t('events.division.pc'), mobile: t('events.division.mobile') };
  const emptyTeamLogoSvg = '<svg viewBox="0 0 24 24" data-icon="shield" aria-hidden="true"></svg>';

  function renderTeamCard(team, selected = false) {
    const card = node('div', 'event-team-card');
    card.dataset.teamId = team.id;
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', String(selected || selectedTeamIds.includes(team.id)));
    card.tabIndex = 0;
    const copy = node('span');
    const nameRow = node('span', 'event-team-card-name-row');
    const divisionChip = node('span', 'event-team-card-division');
    divisionChip.dataset.division = team.division || 'none';
    divisionChip.textContent = teamDivisionLabels[team.division] || t('events.divisionNone');
    nameRow.append(node('strong', '', team.name), divisionChip);
    const stats = node('span', 'event-team-card-stats');
    stats.textContent = `${t('events.teamCardStats', { members: team.memberCount || 0, wins: team.matchWins || 0, events: team.eventCount || 0 })}`;
    const logoFrame = node('span', 'event-team-card-logo');
    const logoUrl = team.logos?.escape || team.logos?.hunter || team.logoUrl;
    if (logoUrl) {
      const logo = document.createElement('img');
      logo.src = logoUrl;
      logo.alt = '';
      logo.loading = 'lazy';
      logo.addEventListener('error', () => {
        logoFrame.classList.add('is-empty');
        logoFrame.innerHTML = emptyTeamLogoSvg;
      });
      logoFrame.append(logo);
    } else {
      logoFrame.classList.add('is-empty');
      logoFrame.innerHTML = emptyTeamLogoSvg;
    }
    card.prepend(logoFrame);
    copy.append(nameRow, stats);
    card.append(copy);
    card.classList.toggle('is-selected', selected || selectedTeamIds.includes(team.id));
    card.addEventListener('click', () => toggleTeamSelection(team.id));
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleTeamSelection(team.id);
      }
    });
    return card;
  }

  function renderTeamLists() {
    const selected = teamCandidates.filter(team => selectedTeamIds.includes(team.id));
    const available = teamCandidates.filter(team => !selectedTeamIds.includes(team.id));
    elements.teamSelected.replaceChildren(...selected.map(team => renderTeamCard(team, true)));
    elements.teamSelected.dataset.state = selected.length ? 'ready' : 'empty';
    elements.selectedTeamCount.textContent = `${t('events.teamCountValue', { count: selected.length })}`;
    elements.teamResults.replaceChildren(...available.map(team => renderTeamCard(team, false)));
    elements.teamResults.dataset.state = available.length ? 'ready' : (teamCandidates.length ? 'empty' : elements.teamResults.dataset.state);
    if (!selected.length) elements.teamSelected.append(node('strong', '', t('events.teamSelectedEmpty')), node('span', '', t('events.teamSelectedEmptyDesc')));
    if (teamCandidates.length && !available.length) elements.teamResults.append(node('strong', '', t('events.teamAllSelected')), node('span', '', t('events.teamAllSelectedDesc')));
  }

  function setupTeamMarquee() {
    const container = elements.teamResults;
    let marquee = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;

    function rectsIntersect(a, b) {
      return !(b.left > a.right || b.right < a.left || b.top > a.bottom || b.bottom < a.top);
    }

    container.addEventListener('mousedown', event => {
      if (container.dataset.state !== 'ready') return;
      if (event.target.closest('.event-team-card')) return;
      if (event.button !== 0) return;
      dragging = true;
      const containerRect = container.getBoundingClientRect();
      startX = event.clientX - containerRect.left + container.scrollLeft;
      startY = event.clientY - containerRect.top + container.scrollTop;
      marquee = node('div', 'event-team-marquee');
      marquee.style.left = `${startX}px`;
      marquee.style.top = `${startY}px`;
      marquee.style.width = '0px';
      marquee.style.height = '0px';
      container.append(marquee);
      event.preventDefault();
    });

    window.addEventListener('mousemove', event => {
      if (!dragging || !marquee) return;
      const containerRect = container.getBoundingClientRect();
      const currentX = event.clientX - containerRect.left + container.scrollLeft;
      const currentY = event.clientY - containerRect.top + container.scrollTop;
      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);
      marquee.style.left = `${left}px`;
      marquee.style.top = `${top}px`;
      marquee.style.width = `${width}px`;
      marquee.style.height = `${height}px`;
      const marqueeBox = { left, top, right: left + width, bottom: top + height };
      container.querySelectorAll('.event-team-card').forEach(card => {
        const hit = rectsIntersect(marqueeBox, {
          left: card.offsetLeft,
          top: card.offsetTop,
          right: card.offsetLeft + card.offsetWidth,
          bottom: card.offsetTop + card.offsetHeight
        });
        card.classList.toggle('is-marquee-hit', hit);
      });
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      container.querySelectorAll('.event-team-card.is-marquee-hit').forEach(card => {
        card.classList.remove('is-marquee-hit');
        toggleTeamSelection(card.dataset.teamId, true);
      });
      marquee?.remove();
      marquee = null;
    });
  }

  setupTeamMarquee();

  elements.teamSelectAll.addEventListener('click', () => {
    if (!teamCandidates.length) return;
    const allSelected = teamCandidates.every(team => selectedTeamIds.includes(team.id));
    selectedTeamIds = allSelected
      ? selectedTeamIds.filter(id => !teamCandidates.some(team => team.id === id))
      : [...new Set([...selectedTeamIds, ...teamCandidates.map(team => team.id)])];
    syncTeamCardStates();
  });

  async function searchTeams() {
    const minMembers = Number(elements.minMembers.value);
    const maxMembers = Number(elements.maxMembers.value);
    if (!minMembers || !maxMembers || maxMembers < minMembers) {
      await showValidation(elements.maxMembers, t('events.invalidMembersRange'));
      return;
    }
    elements.teamSearch.disabled = true;
    elements.teamSelectAll.disabled = true;
    elements.teamResults.dataset.state = 'loading';
    elements.teamResults.innerHTML = `<strong>${t('events.teamSearching')}</strong><span>${t('events.teamSearchingDesc')}</span>`;
    try {
      const result = await api(`/api/events/team-candidates?division=${encodeURIComponent(elements.division.value)}&minMembers=${minMembers}&maxMembers=${maxMembers}`);
      teamCandidates = result.items || [];
      selectedTeamIds = selectedTeamIds.filter(id => teamCandidates.some(team => team.id === id));
      if (!teamCandidates.length) {
        elements.teamResults.dataset.state = 'empty';
        elements.teamResults.append(node('strong', '', t('events.teamNoResults')), node('span', '', t('events.teamNoResultsDesc')));
        updateSelectAllButton();
        return;
      }
      elements.teamResults.dataset.state = 'ready';
      renderTeamLists();
      updateSelectAllButton();
    } catch (error) {
      teamCandidates = [];
      elements.teamResults.dataset.state = 'error';
      elements.teamResults.replaceChildren(node('strong', '', t('events.teamSearchFailed')), node('span', '', error.message));
      updateSelectAllButton();
    } finally {
      elements.teamSearch.disabled = false;
    }
  }

  async function save(event) {
    event.preventDefault();
    for (let step = 0; step < 3; step += 1) {
      if (!await validateStep(step)) {
        setStep(step, false);
        return;
      }
    }
    elements.form.setAttribute('aria-busy', 'true');
    elements.submit.disabled = true;
    elements.previous.disabled = true;
    elements.feedback.textContent = editingEvent ? t('events.saving') : t('events.creating');
    try {
      const url = editingEvent ? `/api/events/${encodeURIComponent(editingEvent.id)}` : '/api/events';
      await api(url, {
        method: editingEvent ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload())
      });
      editorDirty = false;
      elements.dialog.close('saved');
      window.StellaDataCache?.invalidate('/api/events');
      await load(true);
    } catch (error) {
      elements.feedback.textContent = '';
      await window.StellaDialog.alert({
        title: t('events.saveFailedTitle'),
        message: t('events.saveFailed', { error: error.message }),
        tone: 'danger'
      });
    } finally {
      elements.form.removeAttribute('aria-busy');
      elements.submit.disabled = false;
      elements.previous.disabled = false;
    }
  }

  elements.filters.forEach(button => button.addEventListener('click', () => setFilter(button.dataset.eventFilter)));
  elements.create.addEventListener('click', event => openCreate(event.currentTarget));
  // 关闭保护：仅右上角关闭与全流程保存两种出口；有未保存修改时先询问
  elements.close.addEventListener('click', () => requestCloseEditor());
  elements.dialog.dataset.dialogThemeStrict = 'true';
  elements.dialog.addEventListener('cancel', event => event.preventDefault());
  elements.form.addEventListener('input', markEditorDirty);
  elements.form.addEventListener('change', markEditorDirty);
  elements.closeGuardSave.addEventListener('click', () => {
    elements.closeGuard.close();
    elements.form.requestSubmit();
  });
  elements.closeGuardDiscard.addEventListener('click', () => {
    editorDirty = false;
    elements.closeGuard.close();
    elements.dialog.close('discard');
  });
  elements.closeGuardStay.addEventListener('click', () => elements.closeGuard.close());
  elements.dialog.addEventListener('close', () => {
    elements.form.classList.remove('is-workflow');
    if (elements.closeGuard.open) elements.closeGuard.close();
    if (dialogTrigger?.isConnected) dialogTrigger.focus();
    dialogTrigger = null;
  });
  elements.method.addEventListener('click', async event => {
    const method = event.target.closest('[data-event-method]')?.dataset.eventMethod;
    if (!method) return;
    if (method === 'formal') {
      showWorkflow();
      return;
    }
    await window.StellaDialog.alert({
      title: t('events.methodUnavailableTitle'),
      message: t('events.methodUnavailable'),
      tone: 'warning'
    });
  });
  elements.previous.addEventListener('click', () => setStep(activeStep - 1));
  elements.next.addEventListener('click', async () => {
    if (await validateStep(activeStep)) setStep(activeStep + 1);
  });
  elements.stepper.addEventListener('click', async event => {
    const button = event.target.closest('[data-event-step]');
    if (!button) return;
    const step = Number(button.dataset.eventStep);
    if (editingEvent || step <= activeStep || await validateStep(activeStep)) setStep(step);
  });
  elements.form.addEventListener('submit', save);
  elements.logoChoose.addEventListener('click', () => elements.logoInput.click());
  elements.coverChoose.addEventListener('click', () => elements.coverInput.click());
  elements.logoInput.addEventListener('change', () => handleImage(elements.logoInput, 'logo'));
  elements.coverInput.addEventListener('change', () => handleImage(elements.coverInput, 'cover'));
  elements.groupQrChoose.addEventListener('click', () => elements.groupQrInput.click());
  elements.groupQrInput.addEventListener('change', () => handleImage(elements.groupQrInput, 'groupQr'));
  elements.teamSearch.addEventListener('click', searchTeams);
  elements.handbookUrl.addEventListener('input', updateHandbookLink);
  elements.handbookOpen.addEventListener('click', event => {
    if (elements.handbookOpen.getAttribute('aria-disabled') === 'true') event.preventDefault();
  });
  elements.rules.addEventListener('input', () => {
    elements.rulesCount.textContent = String(elements.rules.value.length);
  });
  elements.name.addEventListener('input', () => {
    if (elements.logoImage.hidden) elements.logoFallback.textContent = elements.name.value.trim().slice(0, 1) || t('events.logoFallback');
  });

  window.addEventListener('stella:page-change', event => {
    if (event.detail?.page === 'events') load();
  });
  window.addEventListener('stella:identity-change', () => {
    canManage = false;
    elements.create.hidden = true;
    load(true);
  });

  window.Text.ready.then(() => { if (!document.getElementById('eventsPage').hidden) load(); });
})();
