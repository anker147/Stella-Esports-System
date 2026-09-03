(function () {
  'use strict';

  const root = document.getElementById('eventManagementRoot');
  if (!root) return;

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
    coverImage: document.getElementById('eventCoverImage')
  };

  let activeFilter = 'all';
  let activeStep = 0;
  let editingEvent = null;
  let items = [];
  let canManage = false;
  let loading = false;
  let dialogTrigger = null;
  let logoDraft = null;
  let logoChanged = false;
  let coverDraft = null;
  let coverChanged = false;

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
    actions.append(actionButton(t('events.scheduleManagement'), 'schedule', () => openSchedule(event.id)));
    if (canManage) {
      const statusAction = event.status === 'live' ? 'end' : 'start';
      actions.append(actionButton(
        statusAction === 'end' ? t('events.manualEnd') : t('events.manualStart'),
        statusAction === 'end' ? 'stop' : 'play',
        () => performAction(event, statusAction),
        'is-primary'
      ));
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
    window.dispatchEvent(new CustomEvent('stella:operations-filter', { detail: { view: 'schedule', eventId } }));
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
    elements.format.value = 'BO3 双败淘汰';
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
    elements.feedback.textContent = '';
    elements.feedback.className = 'event-editor-feedback';
    setImagePreview(elements.logoImage, elements.logoFallback, '', t('events.logoFallback'));
    setImagePreview(elements.coverImage, null, '');
  }

  function populateEditor(event) {
    resetEditor();
    editingEvent = event;
    elements.name.value = event.name || '';
    elements.format.value = [...elements.format.options].some(option => option.value === event.format) ? event.format : '自定义赛制';
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
    elements.requireLogin.checked = event.requireSystemLogin !== false;
    document.querySelector(`[name="organizerType"][value="${event.organizerType || 'personal'}"]`).checked = true;
    elements.organizerName.value = event.organizerName === t('events.organizerPending') ? '' : event.organizerName || '';
    elements.contact.value = event.contact || '';
    elements.rules.value = event.rulesText || '';
    elements.rulesCount.textContent = String(elements.rules.value.length);
    setImagePreview(elements.logoImage, elements.logoFallback, event.logoUrl || '', event.name.slice(0, 1));
    setImagePreview(elements.coverImage, null, event.coverUrl || '');
  }

  function setStep(step, focus = true) {
    activeStep = Math.max(0, Math.min(4, step));
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
    elements.next.hidden = activeStep === 4;
    elements.submit.hidden = activeStep !== 4;
    elements.feedback.textContent = '';
    elements.feedback.className = 'event-editor-feedback';
    if (focus) elements.panels[activeStep].querySelector('input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')?.focus();
  }

  function showWorkflow() {
    elements.method.hidden = true;
    elements.workflow.hidden = false;
    elements.footer.hidden = false;
    elements.mode.textContent = editingEvent ? t('events.editEvent') : t('events.createEvent');
    elements.title.textContent = editingEvent ? editingEvent.name : t('events.createFormal');
    setStep(0, false);
    window.requestAnimationFrame(() => elements.name.focus());
  }

  function openCreate(trigger) {
    dialogTrigger = trigger;
    resetEditor();
    elements.mode.textContent = t('events.createEvent');
    elements.title.textContent = t('events.chooseMethod');
    elements.method.hidden = false;
    elements.workflow.hidden = true;
    elements.footer.hidden = true;
    elements.dialog.showModal();
    window.requestAnimationFrame(() => elements.method.querySelector('[data-event-method="formal"]')?.focus());
  }

  function openEditor(event, trigger = document.activeElement) {
    dialogTrigger = trigger instanceof HTMLElement ? trigger : null;
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
    if (step === 2) {
      if (elements.endDate.value < elements.startDate.value) {
        return showValidation(elements.endDate, t('events.invalidEventDates'));
      }
      if (elements.registrationStart.value && elements.registrationEnd.value
        && elements.registrationEnd.value < elements.registrationStart.value) {
        return showValidation(elements.registrationEnd, t('events.invalidRegistrationDates'));
      }
      if (Number(elements.maxMembers.value) < Number(elements.minMembers.value)) {
        return showValidation(elements.maxMembers, t('events.invalidTeamMembers'));
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
      contact: elements.contact.value.trim(),
      rulesText: elements.rules.value.trim(),
      ...(logoChanged ? { logoChanged: true, logo: logoDraft } : {}),
      ...(coverChanged ? { coverChanged: true, cover: coverDraft } : {})
    };
  }

  async function readImage(file, maximum, label) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(t('events.invalidImage', { label }));
    if (file.size > maximum) throw new Error(t('events.imageTooLarge', { label }));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(t('events.imageReadFailed', { label })));
      reader.readAsDataURL(file);
    });
  }

  async function handleImage(input, kind) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const logo = kind === 'logo';
    const label = t(logo ? 'events.logo' : 'events.cover');
    try {
      const value = await readImage(file, logo ? 2 * 1024 * 1024 : 4 * 1024 * 1024, label);
      if (logo) {
        logoDraft = value;
        logoChanged = true;
        setImagePreview(elements.logoImage, elements.logoFallback, value, elements.name.value.slice(0, 1));
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

  async function save(event) {
    event.preventDefault();
    for (let step = 0; step < 5; step += 1) {
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
  elements.close.addEventListener('click', () => elements.dialog.close('cancel'));
  elements.dialog.addEventListener('click', event => {
    if (event.target === elements.dialog) elements.dialog.close('cancel');
  });
  elements.dialog.addEventListener('close', () => {
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

  if (!document.getElementById('eventsPage').hidden) load();
})();
