(function () {
  const elements = {
    search: document.getElementById('logsSearch'),
    refresh: document.getElementById('logsRefresh'),
    export: document.getElementById('logsExport'),
    summary: document.getElementById('logsSummary'),
    body: document.getElementById('logsTableBody'),
    scroll: document.querySelector('#logsPage .logs-table-wrap'),
    loadSentinel: document.getElementById('logsLoadSentinel')
  };
  let logs = [];
  let activeCategory = 'event';
  let total = 0;
  let hasMore = false;
  let loading = false;
  let loadController = null;
  let searchTimer = null;
  let nextCursor = null;
  let autoLoadFrame = 0;
  const PAGE_SIZE = 50;
  const PREFETCH_DISTANCE = 640;
  const beijingTime = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  const actionLabels = {};
  for (const [key, value] of Object.entries(window.UI_TEXT)) {
    if (key.startsWith('bp.logActions.')) actionLabels[key.slice('bp.logActions.'.length)] = value;
  }

  function appendCell(row, value, className = '') {
    const cell = document.createElement('td');
    cell.textContent = value;
    cell.className = className;
    row.appendChild(cell);
    return cell;
  }

  function present(value, fallback = t('lg.notRecorded')) {
    if (value === null || value === undefined || value === '') return fallback;
    return String(value);
  }

  function statusLabel(item) {
    return item.success === false ? t('lg.failed') : t('lg.success');
  }

  function actionLabel(item) {
    return actionLabels[item.action] || item.label || item.action || t('lg.unknownAction');
  }

  function identityLabel(item) {
    const identityKey = item.actorIdentityKey || item.details?.actorIdentityKey;
    if (!identityKey || identityKey === 'unknown') return t('lg.identityUnknown');
    const suffix = identityKey.slice(0, 1).toUpperCase() + identityKey.slice(1);
    return t(`profile.identity${suffix}`);
  }

  function sessionLabel(item) {
    return present(item.sessionId || item.details?.sessionId, t('lg.noSession'));
  }

  function contentSummary(item) {
    if (item.error) return item.error;
    if (item.category === 'account') {
      return [statusLabel(item), present(item.ipAddress || item.details?.ipAddress),
        present(item.region || item.details?.region)].join(' · ');
    }
    const details = item.details && typeof item.details === 'object' ? item.details : {};
    const values = Object.entries(details)
      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) && value !== '')
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${value}`);
    return values.join(' · ') || statusLabel(item);
  }

  function addDetailItem(list, label, value, mono = false) {
    const wrapper = document.createElement('div');
    wrapper.className = 'log-detail-item';
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = present(value);
    if (mono) description.classList.add('log-detail-mono');
    wrapper.append(term, description);
    list.appendChild(wrapper);
  }

  function createDetailRow(item, detailId) {
    const row = document.createElement('tr');
    row.className = 'log-detail-row';
    row.id = detailId;
    row.hidden = true;
    const cell = document.createElement('td');
    cell.colSpan = 7;
    const panel = document.createElement('section');
    panel.className = 'log-detail-panel';
    panel.setAttribute('aria-label', t('lg.detailTitle', { action: actionLabel(item) }));
    const list = document.createElement('dl');
    list.className = 'log-detail-grid';
    addDetailItem(list, t('lg.detail.status'), statusLabel(item));
    addDetailItem(list, t('lg.detail.source'), item.source || item.type || t('lg.unknownSource'));
    addDetailItem(list, t('lg.detail.actor'), item.actorName || t('lg.systemActor'));
    addDetailItem(list, t('lg.detail.identity'), identityLabel(item));
    addDetailItem(list, t('lg.detail.time'), beijingTime(item.timestamp));
    addDetailItem(list, t('lg.detail.session'), sessionLabel(item), true);
    addDetailItem(list, t('lg.detail.ip'), item.ipAddress || item.details?.ipAddress, true);
    addDetailItem(list, t('lg.detail.region'), item.region || item.details?.region);
    addDetailItem(list, t('lg.detail.device'), item.deviceName || item.details?.deviceName);
    addDetailItem(list, t('lg.detail.fingerprint'), item.deviceFingerprint || item.details?.deviceFingerprint, true);
    addDetailItem(list, t('lg.detail.userAgent'), item.userAgent || item.details?.userAgent, true);
    addDetailItem(list, t('lg.detail.error'), item.error, true);
    panel.appendChild(list);
    const payload = document.createElement('div');
    payload.className = 'log-detail-payload';
    const payloadLabel = document.createElement('strong');
    payloadLabel.textContent = t('lg.detail.payload');
    const payloadValue = document.createElement('pre');
    const details = item.details && Object.keys(item.details).length ? item.details : { result: statusLabel(item) };
    payloadValue.textContent = JSON.stringify(details, null, 2);
    payload.append(payloadLabel, payloadValue);
    panel.appendChild(payload);
    cell.appendChild(panel);
    row.appendChild(cell);
    return row;
  }

  function replayCategoryAnimation() {
    const page = document.querySelector('#logsPage .logs-page');
    if (!page) return;
    page.classList.remove('logs-category-switch');
    void page.offsetWidth;
    page.classList.add('logs-category-switch');
  }

  function createRows(item, index) {
      const row = document.createElement('tr');
      row.className = 'log-summary-row';
      row.style.setProperty('--log-stagger', `${Math.min(index, 12) * 24}ms`);
      appendCell(row, beijingTime(item.timestamp), 'log-time');
      appendCell(row, item.category === 'account' ? t('lg.accountActionType') : t('lg.eventActionType'), `log-category ${item.category}`);
      appendCell(row, item.actorName || t('lg.systemActor'), 'log-actor');
      appendCell(row, identityLabel(item), 'log-identity');
      const actionCell = appendCell(row, '', 'log-action');
      const detailId = `log-detail-${index}`;
      let detailRow = null;
      const toggle = document.createElement('button');
      toggle.className = 'log-expand';
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', t('lg.expand', { action: actionLabel(item) }));
      const chevron = document.createElement('span');
      chevron.className = 'log-expand-chevron';
      chevron.textContent = '›';
      chevron.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = actionLabel(item);
      toggle.appendChild(chevron);
      if (item.sensitive) {
        const warning = document.createElement('span');
        warning.className = 'log-sensitive-warning';
        warning.setAttribute('role', 'img');
        warning.setAttribute('aria-label', t('lg.sensitiveWarning'));
        warning.title = t('lg.sensitiveWarning');
        warning.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.1 14 13H2L8 2.1Z"/><path d="M8 5.7v3.5M8 11.5v.1"/></svg>';
        toggle.appendChild(warning);
      }
      toggle.appendChild(label);
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        toggle.setAttribute('aria-label', t(expanded ? 'lg.expand' : 'lg.collapse', { action: actionLabel(item) }));
        if (!expanded && !detailRow) {
          detailRow = createDetailRow(item, detailId);
          toggle.setAttribute('aria-controls', detailId);
          row.after(detailRow);
        }
        detailRow.hidden = expanded;
        row.classList.toggle('is-expanded', !expanded);
      });
      actionCell.appendChild(toggle);
      appendCell(row, sessionLabel(item), 'log-session');
      appendCell(row, contentSummary(item), `log-details ${item.success === false ? 'is-error' : ''}`);
      return [row];
  }

  function updateLoadState() {
    elements.summary.textContent = t('lg.summary', { visible: logs.length, total });
    elements.loadSentinel.hidden = !hasMore;
  }

  function render(animate = false) {
    const rows = logs.flatMap(createRows);
    if (!rows.length) {
      const emptyRow = document.createElement('tr');
      const emptyCell = appendCell(emptyRow, t('lg.empty'), 'logs-empty');
      emptyCell.colSpan = 7;
      rows.push(emptyRow);
    }
    elements.body.replaceChildren(...rows);
    updateLoadState();
    if (animate) replayCategoryAnimation();
  }

  function appendRows(items, startIndex) {
    elements.body.querySelector('.logs-empty')?.closest('tr')?.remove();
    elements.body.append(...items.flatMap((item, index) => createRows(item, startIndex + index)));
    updateLoadState();
  }

  function pageParams(cursor = null, limit = PAGE_SIZE) {
    const params = new URLSearchParams({ category: activeCategory, limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    else params.set('offset', '0');
    const query = elements.search.value.trim();
    if (query) params.set('q', query);
    return params;
  }

  function prefetchNextPage() {
    if (!hasMore || !nextCursor || navigator.connection?.saveData) return;
    window.StellaDataCache.prefetch(`/api/logs?${pageParams(nextCursor)}`);
  }

  async function load({ reset = false, animate = false, force = false } = {}) {
    if (reset) {
      loadController?.abort();
      logs = [];
      total = 0;
      hasMore = false;
      nextCursor = null;
      elements.scroll.scrollTop = 0;
    } else if (loading || !hasMore) {
      return;
    }
    const controller = new AbortController();
    loadController = controller;
    loading = true;
    if (reset) render();
    else updateLoadState();
    const params = pageParams(nextCursor);
    const startIndex = logs.length;
    try {
      const payload = await window.StellaDataCache.json(`/api/logs?${params}`, {
        signal: controller.signal,
        force
      });
      logs.push(...payload.logs);
      if (Number.isFinite(payload.total)) total = payload.total;
      hasMore = payload.hasMore;
      nextCursor = payload.nextCursor || null;
      if (reset) render(animate);
      else appendRows(payload.logs, startIndex);
      prefetchNextPage();
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
    } finally {
      if (loadController === controller) {
        loading = false;
        loadController = null;
        updateLoadState();
        scheduleAutoLoad();
      }
    }
  }

  elements.search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      load({ reset: true, force: true }).catch(error => { elements.summary.textContent = error.message; });
    }, 250);
  });
  elements.refresh.addEventListener('click', () => load({ reset: true, force: true }).catch(error => { elements.summary.textContent = error.message; }));
  elements.export.addEventListener('click', async () => {
    elements.export.disabled = true;
    elements.summary.textContent = t('lg.exporting');
    try {
      const exported = [];
      let cursor = null;
      let more = true;
      while (more) {
        const params = pageParams(cursor, 200);
        const payload = await window.StellaDataCache.json(`/api/logs?${params}`, { force: true });
        exported.push(...payload.logs);
        more = payload.hasMore;
        cursor = payload.nextCursor || null;
        if (more && !cursor) throw new Error(t('lg.loadFailed'));
      }
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `zfb-logs-${new Date().toISOString().replaceAll(':', '-')}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      elements.summary.textContent = error.message;
    } finally {
      elements.export.disabled = false;
      render();
    }
  });
  document.querySelectorAll('[data-page="logs"]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.logCategory) activeCategory = button.dataset.logCategory;
      load({ reset: true, animate: true }).catch(error => { elements.summary.textContent = error.message; });
    });
  });

  function nearListEnd() {
    if (document.getElementById('logsPage').hidden || elements.loadSentinel.hidden) return false;
    const scrollableTable = elements.scroll.scrollHeight > elements.scroll.clientHeight + 1;
    const viewportBottom = scrollableTable
      ? elements.scroll.getBoundingClientRect().bottom
      : window.innerHeight;
    return elements.loadSentinel.getBoundingClientRect().top <= viewportBottom + PREFETCH_DISTANCE;
  }

  function scheduleAutoLoad() {
    if (autoLoadFrame) return;
    autoLoadFrame = window.requestAnimationFrame(() => {
      autoLoadFrame = 0;
      if (!nearListEnd() || loading || !hasMore) return;
      load().catch(error => { elements.summary.textContent = error.message; });
    });
  }

  elements.scroll.addEventListener('scroll', scheduleAutoLoad, { passive: true });
  window.addEventListener('scroll', scheduleAutoLoad, { passive: true });
  window.addEventListener('resize', scheduleAutoLoad, { passive: true });

  if (!document.getElementById('logsPage').hidden) {
    load({ reset: true }).catch(error => { elements.summary.textContent = error.message; });
  }
})();
