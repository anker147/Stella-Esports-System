(function () {
  'use strict';


  const PAGE_TO_VIEW = {
    personalCenter: 'personal',
    events: 'events',
    teams: 'teams',
    players: 'players',
    resourceMonitor: 'resources',
    matchRecords: 'matches',
    dataConfig: 'dataConfig',
    terminalStatus: 'terminal',
    systemSettings: 'settings',
    riskResponse: 'alerts'
  };
  const MANAGEMENT_VIEWS = new Set(['dataConfig', 'terminal', 'settings', 'alerts']);
  const PAGED_VIEWS = new Set(['teams', 'players', 'matches']);
  const VIEW_CONFIG = {
    events: { search: false },
    teams: { search: true, placeholder: text('ops.searchTeams', '搜索战队名称或编号') },
    players: { search: true, role: true, placeholder: text('ops.searchPlayers', '搜索选手、官方 ID 或战队') },
    resources: {},
    matches: { search: true, division: true, placeholder: text('ops.searchMatches', '搜索赛事、战队或比赛编号') },
    dataConfig: {},
    terminal: {},
    settings: {},
    alerts: {}
  };
  const IDENTITY_LABELS = {
    developer: text('ops.identityDeveloper', '开发者'), administrator: text('ops.identityAdmin', '管理员'),
    director: text('ops.identityDirector', '赛事导演'), commentator: text('ops.identityCommentator', '解说'),
    referee: text('ops.identityReferee', '裁判'), scorer: text('ops.identityScorer', '记分员'),
    guest: text('ops.identityGuest', '访客'), operator: text('ops.identityAdmin', '管理员'),
    technical: text('ops.identityTechnical', '技术支持（历史身份）'), analyst: text('ops.identityAnalyst', '赛事分析（历史身份）')
  };
  const STATUS_LABELS = {
    completed: text('ops.statusCompleted', '已结束'), upcoming: text('ops.statusUpcoming', '待开始'),
    live: text('ops.statusLive', '今日进行'), incomplete: text('ops.statusIncomplete', '待补录'),
    planned: text('ops.statusPlanned', '规划中')
  };

  const states = new Map();
  let liveTimer = 0;

  function element(tag, className, textContent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined && textContent !== null) node.textContent = String(textContent);
    return node;
  }

  function button(label, handler, className = 'operations-action') {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  }

  function api(url, options = {}) {
    if (window.StellaDataCache) return window.StellaDataCache.json(url, options);
    return fetch(url).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || text('ops.requestFailed', '请求失败', { status: response.status }));
        error.code = payload.code || '';
        throw error;
      }
      return payload;
    });
  }

  function stateFor(view) {
    if (!states.has(view)) {
      states.set(view, {
        view,
        loading: false,
        initialized: false,
        data: null,
        query: '',
        division: '',
        role: '',
        eventId: '',
        offset: 0,
        hasMore: false,
        requestVersion: 0,
        observer: null
      });
    }
    return states.get(view);
  }

  function rootFor(view) {
    return document.querySelector(`[data-operations-root="${CSS.escape(view)}"]`);
  }

  function contentFor(view) {
    return rootFor(view)?.querySelector('[data-operations-content]');
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return text('ops.dateTbd', '日期待定');
    const date = new Date(`${value}T00:00:00`);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function formatTime(value) {
    return value || '--:--';
  }

  function formatTimestamp(value) {
    if (value === undefined || value === null || value === '') return text('ops.noRecord', '暂无记录');
    const date = new Date(Number(value) || value);
    if (!Number.isFinite(date.getTime())) return text('ops.noRecord', '暂无记录');
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(date);
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours) return text('ops.hoursMinutes', '{hours} 小时 {minutes} 分', { hours: hours, minutes: minutes });
    return text('ops.minutes', '{minutes} 分钟', { minutes: minutes });
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 ** 2).toFixed(1)} MB`;
  }

  function percentage(value) {
    return `${(Number(value || 0) * 100).toFixed(1)}%`;
  }

  function statusChip(label, mode = 'neutral') {
    return element('span', `operations-chip is-${mode}`, label);
  }

  function metrics(items) {
    const grid = element('section', 'operations-metrics');
    grid.setAttribute('aria-label', text('ops.metricsAria', '关键指标'));
    for (const item of items) {
      const card = element('article', `operations-metric ${item.mode ? `is-${item.mode}` : ''}`.trim());
      card.append(element('span', 'operations-metric-label', item.label));
      card.append(element('strong', 'operations-metric-value', item.value));
      if (item.detail) card.append(element('small', 'operations-metric-detail', item.detail));
      grid.append(card);
    }
    return grid;
  }

  function panel(title, description) {
    const section = element('section', 'operations-panel');
    const header = element('header', 'operations-panel-header');
    const copy = element('div');
    copy.append(element('h2', '', title));
    if (description) copy.append(element('p', '', description));
    header.append(copy);
    section.append(header);
    return { section, header };
  }

  function emptyState(title, detail) {
    const empty = element('div', 'operations-empty');
    empty.append(element('strong', '', title), element('span', '', detail));
    return empty;
  }

  function loadingState() {
    const loading = element('div', 'operations-loading');
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-label', text('ops.loadingAria', '正在读取数据'));
    for (let index = 0; index < 5; index += 1) loading.append(element('span'));
    return loading;
  }

  function navigate(page) {
    const entry = document.querySelector(`[data-page="${CSS.escape(page)}"]:not([hidden])`);
    entry?.click();
  }

  function table(headers, rows, className = '') {
    const wrapper = element('div', `operations-table-wrap ${className}`.trim());
    const tableNode = element('table', 'operations-table');
    const thead = element('thead');
    const headingRow = element('tr');
    headers.forEach(header => headingRow.append(element('th', '', header)));
    thead.append(headingRow);
    const tbody = element('tbody');
    rows.forEach(row => {
      const tr = element('tr');
      row.forEach(cell => {
        const td = element('td');
        if (cell instanceof Node) td.append(cell);
        else td.textContent = cell === undefined || cell === null || cell === '' ? text('ops.none', '暂无') : String(cell);
        tr.append(td);
      });
      tbody.append(tr);
    });
    tableNode.append(thead, tbody);
    wrapper.append(tableNode);
    return wrapper;
  }

  function teamIdentity(team, logoUrl) {
    const wrap = element('span', 'operations-team-identity');
    const mark = element('span', 'operations-team-logo');
    if (logoUrl) {
      const image = document.createElement('img');
      image.src = logoUrl;
      image.alt = '';
      image.addEventListener('error', () => {
        image.remove();
        mark.textContent = String(team || '?').slice(0, 1);
      }, { once: true });
      mark.append(image);
    } else mark.textContent = String(team || '?').slice(0, 1);
    wrap.append(mark, element('strong', '', team || text('ops.unknownTeam', '未知战队')));
    return wrap;
  }

  function buildActivityHeatmap(activity) {
    const wrap = element('div', 'personal-activity');
    const grid = element('div', 'personal-activity-grid');
    const byDay = new Map(activity.map(item => [item.day, item.count]));
    const pad = value => String(value).padStart(2, '0');
    const keyOf = date => date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    const start = new Date(Date.now() - 25 * 7 * 86400000);
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    const dayCount = 26 * 7;
    let max = 1;
    for (let i = 0; i < dayCount; i += 1) {
      const date = new Date(start.getTime() + i * 86400000);
      max = Math.max(max, byDay.get(keyOf(date)) || 0);
    }
    for (let i = 0; i < dayCount; i += 1) {
      const date = new Date(start.getTime() + i * 86400000);
      const key = keyOf(date);
      const count = byDay.get(key) || 0;
      const ratio = count / max;
      const level = count === 0 ? 0 : ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4;
      const cell = element('span', 'personal-activity-cell l' + level);
      cell.title = text('ops.heatTooltip', '{date} · {count} 次操作', { date: key, count: count });
      grid.append(cell);
    }
    wrap.append(grid);
    const legend = element('div', 'personal-activity-legend');
    legend.append(element('span', '', text('ops.heatLess', '少')));
    for (let level = 0; level <= 4; level += 1) legend.append(element('span', 'personal-activity-cell l' + level));
    legend.append(element('span', '', text('ops.heatMore', '多')));
    wrap.append(legend);
    return wrap;
  }

  function renderPersonal(data) {
    const fragment = document.createDocumentFragment();
    const heading = element('section', 'operations-personal-heading');
    const copy = element('div');
    copy.append(element('span', 'operations-eyebrow', text('ops.todayWork', '今日工作')));
    copy.append(element('h2', '', text('ops.dutySynced', '{name}，值守信息已同步', { name: data.user?.displayName || text('ops.currentUser', '当前用户') })));
    copy.append(element('p', '', data.scheduleMode === 'today'
      ? text('ops.todaySchedule', '今天共有 {count} 场赛事安排，请按时间确认控制台与通讯频道。', { count: data.matches.length })
      : text('ops.noScheduleToday', '今天暂无赛事，以下显示数据库中距离今天最近的赛程，便于提前核对。')));
    heading.append(copy, statusChip(data.scheduleMode === 'today' ? text('ops.scheduleTodayLabel', '今日赛程') : text('ops.scheduleRecentLabel', '最近赛程'), data.scheduleMode === 'today' ? 'live' : 'neutral'));
    fragment.append(heading);
    fragment.append(metrics([
      { label: text('ops.metricDuty', '今日值守'), value: formatDuration(data.duty.seconds), detail: text('ops.loginSessions', '{count} 个登录会话', { count: data.duty.sessions }) },
      { label: data.scheduleMode === 'today' ? text('ops.metricTodayMatches', '今日比赛') : text('ops.metricRefMatches', '参考赛程'), value: formatNumber(data.matches.length), detail: text('ops.linkedDb', '已关联赛事数据库') },
      { label: text('ops.metricRecentActions', '最近操作'), value: formatNumber(data.recentActions.length), detail: text('ops.auditNote', '当前账号审计记录') }
    ]));

    const schedulePanel = panel(data.scheduleMode === 'today' ? text('ops.scheduleTodayLabel', '今日赛程') : text('ops.scheduleRecentLabel', '最近赛程'), text('ops.schedulePanelDesc', '时间、对阵和端别来自赛事数据库。'));
    schedulePanel.header.append(button(text('ops.viewAllSchedule', '查看全部赛程'), () => navigate('schedule')));
    if (!data.matches.length) schedulePanel.section.append(emptyState(text('ops.noSchedule', '暂无可用赛程'), text('ops.noScheduleDesc', '赛事数据录入后会自动出现在这里。')));
    else {
      const list = element('div', 'operations-personal-schedule');
      data.matches.forEach(match => {
        const row = element('article', 'operations-agenda-row');
        const when = element('time');
        when.append(element('strong', '', formatTime(match.start_time)), element('span', '', formatDate(match.date)));
        const matchup = element('div');
        matchup.append(element('strong', '', text('ops.matchupLine', '{home} vs {away}', { home: match.matchup_home || text('ops.tbd', '待定'), away: match.matchup_away || text('ops.tbd', '待定') })));
        matchup.append(element('span', '', match.event_name));
        row.append(when, matchup, statusChip(match.division === 'pc' ? text('ops.pcSide', 'PC 端') : text('ops.peSide', 'PE 端'), 'blue'));
        list.append(row);
      });
      schedulePanel.section.append(list);
    }
    fragment.append(schedulePanel.section);

    const todoPanel = panel(text('ops.todoTitle', '待办事项'), text('ops.todoDesc', '功能迁移后的新入口指引，点击条目直达。'));
    if (!data.todos?.length) todoPanel.section.append(emptyState(text('ops.todoEmpty', '暂无待办'), text('ops.todoEmptyDesc', '有新的功能迁移时会出现在这里。')));
    else {
      const todoList = element('div', 'operations-personal-schedule');
      data.todos.forEach(todo => {
        const row = element('button', 'operations-agenda-row operations-todo-row');
        row.type = 'button';
        const copy = element('div');
        copy.append(element('strong', '', todo.title), element('span', '', todo.description));
        row.append(copy, statusChip(text('ops.todoGo', '前往'), 'blue'));
        row.addEventListener('click', () => navigate(todo.page));
        todoList.append(row);
      });
      todoPanel.section.append(todoList);
    }
    fragment.append(todoPanel.section);

    const activityPanel = panel(text('ops.activityTitle', '个人活跃'), text('ops.activityDesc', '近 26 周的操作频率，数据来自账号审计记录。'));
    if (!data.activity?.length) activityPanel.section.append(emptyState(text('ops.activityEmpty', '暂无活跃数据'), text('ops.activityEmptyDesc', '开始使用赛事工具后会生成活跃记录。')));
    else activityPanel.section.append(buildActivityHeatmap(data.activity));
    fragment.append(activityPanel.section);

    const actionPanel = panel(text('ops.recentActionsTitle', '账号近期操作'), text('ops.recentActionsDesc', '用于交接班时快速确认当前账号最近执行的动作。'));
    if (!data.recentActions.length) actionPanel.section.append(emptyState(text('ops.noRecentActions', '暂无近期操作'), text('ops.noRecentActionsDesc', '开始使用赛事工具后会自动记录。')));
    else actionPanel.section.append(table([text('ops.colTime', '时间'), text('ops.colAction', '动作'), text('ops.colIdentity', '身份'), text('ops.colResult', '结果')], data.recentActions.map(item => [
      formatTimestamp(item.timestamp), item.action, IDENTITY_LABELS[item.identityKey] || item.identityKey,
      statusChip(item.success ? text('ops.success', '成功') : text('ops.failure', '失败'), item.success ? 'success' : 'danger')
    ])));
    fragment.append(actionPanel.section);
    return fragment;
  }

  function renderEvents(data) {
    const fragment = document.createDocumentFragment();
    fragment.append(metrics([
      { label: text('ops.metricEvents', '赛事总数'), value: formatNumber(data.metrics.events), detail: text('ops.upcomingCount', '{count} 项待进行', { count: data.metrics.upcoming }) },
      { label: text('ops.metricMatchesTotal', '赛程总数'), value: formatNumber(data.metrics.matches), detail: text('ops.linkedMatches', '关联比赛表') },
      { label: text('ops.metricTeams', '参赛战队'), value: formatNumber(data.metrics.teams), detail: text('ops.uniqueTeams', '去重战队') }
    ]));
    const eventPanel = panel(text('ops.eventCatalogTitle', '赛事目录'), text('ops.eventCatalogDesc', '按赛事日期与原始配置顺序展示。'));
    const list = element('div', 'operations-event-list');
    data.items.forEach(item => {
      const record = element('article', 'operations-event-record');
      const main = element('div', 'operations-event-main');
      const title = element('div', 'operations-record-title');
      title.append(element('h3', '', item.name), statusChip(item.division === 'pc' ? text('ops.pcSide', 'PC 端') : text('ops.peSide', 'PE 端'), 'blue'),
        statusChip(STATUS_LABELS[item.status] || item.status, item.status));
      main.append(title, element('p', '', text('ops.eventMeta', '{stage} · {mode} · {format}', { stage: item.stage || text('ops.stageTbd', '阶段待定'), mode: item.mode || text('ops.modeTbd', '赛制待定'), format: item.format || text('ops.formatTbd', '格式待定') })));
      const facts = element('div', 'operations-record-facts');
      facts.append(element('span', '', formatDate(item.date)), element('span', '', text('ops.teamCount', '{count} 支战队', { count: item.teamCount })),
        element('span', '', text('ops.playerCount', '{count} 名选手', { count: item.playerCount })), element('span', '', item.sourceName || text('ops.noSourceFile', '无来源文件')));
      main.append(facts);
      const progress = element('div', 'operations-progress');
      const progressValue = item.matchCount ? Math.round(item.completedMatchCount / item.matchCount * 100) : 0;
      progress.append(element('div', 'operations-progress-copy', text('ops.progressCopy', '{done} / {total} 场完成', { done: item.completedMatchCount, total: item.matchCount })));
      const track = element('span', 'operations-progress-track');
      const fill = element('span', 'operations-progress-fill');
      fill.style.width = `${progressValue}%`;
      track.append(fill);
      progress.append(track, element('strong', '', `${progressValue}%`));
      record.append(main, progress);
      list.append(record);
    });
    eventPanel.section.append(data.items.length ? list : emptyState(text('ops.noEvents', '暂无赛事'), text('ops.noEventsDesc', '导入赛事数据后会显示赛事目录。')));
    fragment.append(eventPanel.section);
    return fragment;
  }

  const teamDetailCache = new Map();
  const teamDialog = {
    dialog: document.getElementById('teamDetailDialog'),
    logo: document.getElementById('teamDetailLogo'),
    title: document.getElementById('teamDetailTitle'),
    aliases: document.getElementById('teamDetailAliases'),
    division: document.getElementById('teamDetailDivision'),
    stats: document.getElementById('teamDetailStats'),
    body: document.getElementById('teamDetailBody'),
    footer: document.getElementById('teamDetailFooter'),
    close: document.getElementById('teamDetailClose')
  };
  let openTeamItemId = null;

  function loadTeamDetail(teamId) {
    if (!teamDetailCache.has(teamId)) {
      const request = api(`/api/operations/teams/${encodeURIComponent(teamId)}/detail`)
        .then(payload => payload.data)
        .catch(error => {
          teamDetailCache.delete(teamId);
          throw error;
        });
      teamDetailCache.set(teamId, request);
    }
    return teamDetailCache.get(teamId);
  }

  function setTeamLogo(frame, logoUrl, name) {
    frame.replaceChildren();
    if (logoUrl) {
      const image = document.createElement('img');
      image.src = logoUrl;
      image.alt = '';
      image.addEventListener('error', () => {
        image.remove();
        frame.textContent = String(name || '?').slice(0, 1);
      }, { once: true });
      frame.append(image);
    } else frame.textContent = String(name || '?').slice(0, 1);
  }

  function teamDialogLoading() {
    const loading = element('div', 'operations-team-loading');
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-label', text('ops.teamDetailLoading', ''));
    for (let index = 0; index < 5; index += 1) loading.append(element('span'));
    return loading;
  }

  function copyViaExecCommand(value, done) {
    const helper = document.createElement('textarea');
    helper.value = value;
    helper.className = 'visually-hidden';
    document.body.appendChild(helper);
    helper.select();
    try { document.execCommand('copy'); } catch { /* clipboard unavailable */ }
    helper.remove();
    done();
  }

  const copyToastState = { timer: 0 };

  function ensureCopyToast() {
    if (!teamDialog.dialog) return null;
    let toast = teamDialog.dialog.querySelector('.operations-copy-toast');
    if (!toast) {
      toast = element('div', 'operations-copy-toast');
      toast.setAttribute('role', 'status');
      teamDialog.dialog.append(toast);
    }
    return toast;
  }

  function flashCopied(label) {
    const toast = ensureCopyToast();
    if (!toast) return;
    toast.textContent = label;
    toast.classList.add('show');
    clearTimeout(copyToastState.timer);
    copyToastState.timer = setTimeout(() => toast.classList.remove('show'), 1300);
  }

  function copyToClipboard(value, label) {
    const done = () => flashCopied(label);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done, () => copyViaExecCommand(value, done));
    } else copyViaExecCommand(value, done);
  }

  function rosterRow(player) {
    const row = element('div', 'operations-roster-row');
    const nameButton = document.createElement('button');
    nameButton.type = 'button';
    nameButton.className = 'operations-roster-name';
    nameButton.title = text('ops.copyNameHint', '点击复制姓名');
    nameButton.append(element('span', 'operations-roster-title', player.nickname || text('ops.unnamed', '未命名')));
    if (player.registeredNickname && player.registeredNickname !== player.nickname) {
      nameButton.append(element('span', 'operations-roster-registered', player.registeredNickname));
    }
    nameButton.addEventListener('click', () => copyToClipboard(player.nickname || '', text('ops.copiedName', '姓名已复制')));
    row.append(nameButton);

    const chipCell = element('span', 'operations-roster-chip');
    chipCell.append(player.substitute
      ? statusChip(text('ops.substituteChip', '替补'), 'neutral')
      : statusChip(player.role === 'escape' ? text('ops.escape', '逃生') : text('ops.hunter', '追捕'),
        player.role === 'escape' ? 'blue' : 'danger'));
    row.append(chipCell);

    row.append(element('span', 'operations-roster-slot', player.slot ? `#${player.slot}` : ''));

    const officialId = player.officialId || player.registeredOfficialId || '';
    const idButton = document.createElement('button');
    idButton.type = 'button';
    idButton.className = 'operations-roster-id';
    idButton.title = text('ops.copyIdHint', '点击复制 ID');
    idButton.append(element('code', 'operations-code', officialId || text('ops.unregistered', '未登记')));
    if (officialId) idButton.addEventListener('click', () => copyToClipboard(officialId, text('ops.copiedId', 'ID 已复制')));
    else idButton.disabled = true;
    row.append(idButton);
    return row;
  }

  function renderTeamCharacters(detail) {
    const latestBlock = element('section', 'operations-team-block');
    latestBlock.append(element('h4', '', text('ops.teamLineupTitle', '最近阵容')));
    const latest = detail.characters?.latest;
    if (!latest || !latest.lineup?.length) {
      latestBlock.append(emptyState(text('ops.noLineup', '暂无阵容记录'), text('ops.noLineupDesc', '该战队完成 BP 后这里会展示最近一局的出场阵容。')));
    } else {
      const matchup = element('div', 'operations-team-lineup-match');
      matchup.append(element('strong', '', text('ops.matchupLine', '{home} vs {away}', {
        home: latest.matchupHome, away: latest.matchupAway
      })));
      matchup.append(statusChip(
        latest.side === 'escape' ? text('ops.lineupEscapeSide', '逃生方') : text('ops.lineupHunterSide', '追捕方'),
        latest.side === 'escape' ? 'blue' : 'danger'
      ));
      const chips = element('div', 'operations-team-lineup-chips');
      latest.lineup.forEach(item => {
        if (item.portrait) {
          const frame = element('span', 'operations-team-lineup-avatar');
          const image = document.createElement('img');
          image.src = item.portrait;
          image.alt = '';
          image.loading = 'lazy';
          image.title = item.nickname;
          image.addEventListener('error', () => {
            frame.replaceWith(element('span', 'operations-team-lineup-chip', item.nickname));
          }, { once: true });
          frame.append(image);
          chips.append(frame);
        } else chips.append(element('span', 'operations-team-lineup-chip', item.nickname));
      });
      latestBlock.append(matchup, chips);
    }

    const commonBlock = element('section', 'operations-team-block');
    commonBlock.append(element('h4', '', text('ops.teamCharactersTitle', '常用角色')));
    const common = detail.characters?.common || [];
    if (!common.length) {
      commonBlock.append(emptyState(text('ops.noCharacterRecords', '暂无角色记录'), text('ops.noCharacterRecordsDesc', '该战队完成 BP 后这里会统计常用角色、使用率与胜率。')));
    } else {
      const head = element('div', 'operations-character-row is-head');
      head.append(element('span'), element('span', '', text('ops.colGames', '局数')),
        element('span', '', text('ops.colUsage', '使用')), element('span', '', text('ops.statWinRate', '胜率')));
      commonBlock.append(head);
      common.forEach(character => {
        const row = element('div', 'operations-character-row');
        row.append(element('strong', '', character.nickname));
        row.append(element('span', '', formatNumber(character.uses)));
        row.append(element('span', '', character.usageRate === null || character.usageRate === undefined ? text('ops.noneShort', '') : percentage(character.usageRate)));
        row.append(element('span', '', character.winRate === null || character.winRate === undefined ? text('ops.noneShort', '') : percentage(character.winRate)));
        commonBlock.append(row);
      });
    }
    return [latestBlock, commonBlock];
  }

  function renderTeamStatsSkeleton(target) {
    if (!target) return;
    target.className = 'operations-team-stats is-loading';
    target.replaceChildren();
    for (let index = 0; index < 6; index += 1) {
      const fact = element('div');
      fact.append(element('dt'), element('dd'));
      target.append(fact);
    }
  }

  function renderTeamStats(target, item, detail) {
    if (!target) return;
    target.className = 'operations-team-stats';
    const winRate = detail.totals.winRate;
    target.replaceChildren();
    [[text('ops.statEvents', ''), formatNumber(item.eventCount)],
      [text('ops.colRoster', ''), formatNumber(item.playerCount)],
      [text('ops.escape', ''), formatNumber(item.escapeCount)],
      [text('ops.hunter', ''), formatNumber(item.hunterCount)],
      [text('ops.statPlayed', ''), formatNumber(detail.totals.played)],
      [text('ops.statWinRate', ''),
        winRate === null || winRate === undefined ? text('ops.noneShort', '') : percentage(winRate)]]
      .forEach(([label, value]) => {
        const fact = element('div');
        fact.append(element('dt', '', label), element('dd', '', value));
        target.append(fact);
      });
  }

  function renderTeamDialogContent(item, detail) {
    const fragment = document.createDocumentFragment();

    const rosterCol = element('section', 'operations-team-block operations-team-roster-col');
    rosterCol.append(element('h4', '', text('ops.rosterTitle', '选手名单')));
    if (!detail.roster.length) {
      rosterCol.append(emptyState(text('ops.teamNoRoster', '暂无选手记录'), text('ops.teamNoRosterDesc', '选手导入后这里会显示完整名单。')));
    } else {
      const ordered = [
        ...detail.roster.filter(player => !player.substitute && player.role === 'escape'),
        ...detail.roster.filter(player => !player.substitute && player.role === 'hunter'),
        ...detail.roster.filter(player => player.substitute)
      ];
      const list = element('div', 'operations-roster-list');
      ordered.forEach(player => list.append(rosterRow(player)));
      rosterCol.append(list);
    }
    fragment.append(rosterCol);

    const side = element('div', 'operations-team-side');
    const [latestBlock, commonBlock] = renderTeamCharacters(detail);

    const eventsBlock = element('section', 'operations-team-block');
    eventsBlock.append(element('h4', '', text('ops.teamEventsTitle', '参赛赛事')));
    if (!detail.events.length) eventsBlock.append(emptyState(text('ops.teamNoEvents', '暂无参赛赛事'), text('ops.teamNoEventsDesc', '该战队被加入赛程后会显示在这里。')));
    else {
      const list = element('div', 'operations-team-event-list');
      detail.events.forEach(event => {
        const row = element('div', 'operations-team-event-row');
        row.append(element('strong', '', event.name));
        row.append(element('span', '', [formatDate(event.date), event.stage, event.mode, event.format]
          .filter(Boolean).join(' · ')));
        list.append(row);
      });
      eventsBlock.append(list);
    }

    const recordsBlock = element('section', 'operations-team-block');
    recordsBlock.append(element('h4', '', text('ops.teamRecordsTitle', '最近战绩')));
    if (!detail.records.length) recordsBlock.append(emptyState(text('ops.teamNoRecords', '暂无比赛记录'), text('ops.teamNoRecordsDesc', '该战队完成 BP 结算后会显示近期战绩。')));
    else {
      const list = element('div', 'operations-team-record-list');
      detail.records.forEach(record => {
        const row = element('div', 'operations-team-record-row');
        row.append(statusChip(
          record.decided ? (record.won ? text('ops.resultWin', '胜') : text('ops.resultLoss', '负')) : text('ops.pendingResult', '待结算'),
          record.decided ? (record.won ? 'success' : 'danger') : 'neutral'
        ));
        const matchup = element('div', 'operations-match-cell');
        matchup.append(element('strong', '', text('ops.matchupLine', '{home} vs {away}', {
          home: record.home.name || text('ops.tbd', '待定'), away: record.away.name || text('ops.tbd', '待定')
        })));
        matchup.append(element('strong', 'operations-score', `${record.score.home} : ${record.score.away}`));
        matchup.append(element('span', '', record.eventName || ''));
        row.append(matchup);
        row.append(element('time', '', record.decidedAt ? formatTimestamp(record.decidedAt) : formatDate(record.date)));
        list.append(row);
      });
      recordsBlock.append(list);
    }
    side.append(latestBlock, commonBlock, eventsBlock, recordsBlock);
    fragment.append(side);
    return fragment;
  }

  function fillTeamDialog(item) {
    renderTeamStatsSkeleton(teamDialog.stats);
    teamDialog.footer?.replaceChildren();
    teamDialog.body.replaceChildren(teamDialogLoading());
    loadTeamDetail(item.id).then(detail => {
      if (openTeamItemId !== item.id) return;
      teamDialog.aliases.textContent = detail.team.aliases?.length
        ? detail.team.aliases.join('、')
        : text('ops.noRecord', '');
      teamDialog.division.textContent = detail.team.division === 'pc' ? text('ops.pcSide', 'PC 端')
        : detail.team.division === 'mobile' ? text('ops.peSide', 'PE 端') : text('ops.noneShort', '');
      renderTeamStats(teamDialog.stats, item, detail);
      teamDialog.body.replaceChildren(renderTeamDialogContent(item, detail));
      teamDialog.footer?.replaceChildren(button(text('ops.viewPlayers', '查看选手'), () => {
        teamDialog.dialog.close();
        window.dispatchEvent(new CustomEvent('stella:operations-filter', { detail: { view: 'players', teamId: item.id } }));
        navigate('players');
      }, 'operations-action'));
    }).catch(error => {
      if (openTeamItemId !== item.id) return;
      const failed = emptyState(text('ops.teamDetailFailed', '明细加载失败'), error.message);
      failed.append(button(text('ops.reload', '重新加载'), () => fillTeamDialog(item), 'operations-text-action'));
      teamDialog.body.replaceChildren(failed);
    });
  }

  function openTeamDetail(item) {
    if (!teamDialog.dialog) return;
    openTeamItemId = item.id;
    setTeamLogo(teamDialog.logo, item.logos.escape || item.logos.hunter, item.name);
    teamDialog.title.textContent = item.name || text('ops.unknownTeam', '未知战队');
    teamDialog.aliases.textContent = '';
    teamDialog.division.textContent = '';
    const watermark = item.logos.escape || item.logos.hunter;
    teamDialog.dialog.style.setProperty('--operations-team-watermark', watermark ? `url("${watermark}")` : 'none');
    fillTeamDialog(item);
    if (!teamDialog.dialog.open) teamDialog.dialog.showModal();
  }

  teamDialog.close?.addEventListener('click', () => teamDialog.dialog.close());
  teamDialog.dialog?.addEventListener('click', event => {
    if (event.target === teamDialog.dialog) teamDialog.dialog.close();
  });

  function renderTeams(data) {
    const teamPanel = panel(text('ops.teamsTitle', ''), text('ops.teamsDesc', '', { count: data.total }));
    if (!data.items.length) {
      teamPanel.section.append(emptyState(text('ops.noTeams', ''), text('ops.noTeamsDesc', '')));
      return teamPanel.section;
    }
    const grid = element('div', 'operations-team-grid');
    data.items.forEach(item => {
      const card = element('article', 'operations-team-card');
      const heading = element('header');
      heading.append(teamIdentity(item.name, item.logos.escape || item.logos.hunter));
      heading.append(statusChip(text('ops.eventChip', '', { count: item.eventCount }), 'blue'));
      const stats = element('dl');
      [[text('ops.colRoster', ''), item.playerCount], [text('ops.escape', ''), item.escapeCount], [text('ops.hunter', ''), item.hunterCount], [text('ops.colWins', ''), item.matchWins]].forEach(([label, value]) => {
        const fact = element('div');
        fact.append(element('dt', '', label), element('dd', '', value));
        stats.append(fact);
      });
      card.append(heading, stats);
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-haspopup', 'dialog');
      card.setAttribute('aria-label', text('ops.openTeamDetailAria', '', { name: item.name }));
      card.addEventListener('click', () => openTeamDetail(item));
      card.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openTeamDetail(item);
      });
      grid.append(card);
    });
    teamPanel.section.append(grid);
    return teamPanel.section;
  }

  function renderPlayers(data) {
    const role = item => statusChip(item.role === 'escape' ? text('ops.escape', '逃生') : text('ops.hunter', '追捕'), item.role === 'escape' ? 'blue' : 'danger');
    const identity = item => teamIdentity(item.team.name, item.team.logo);
    const playerPanel = panel(text('ops.playersTitle', '选手档案'), text('ops.playersDesc', '共 {count} 名选手，当前已读取 {loaded} 名。', { count: data.total, loaded: data.items.length }));
    playerPanel.section.append(data.items.length ? table([text('ops.colPlayer', '选手'), text('ops.colTeam', '所属战队'), text('ops.colRole', '岗位'), text('ops.colOfficialId', '官方 ID'), text('ops.colRegister', '注册信息')], data.items.map(item => [
      element('strong', '', item.nickname || item.registeredNickname || text('ops.unnamed', '未命名')),
      identity(item),
      role(item),
      element('code', 'operations-code', item.officialId || text('ops.unregistered', '未登记')),
      text('ops.registerInfo', '{nick} · {id}', { nick: item.registeredNickname || text('ops.unregistered', '未登记'), id: item.registeredOfficialId || text('ops.noId', '无 ID') }),
    ])) : emptyState(text('ops.noPlayers', '没有匹配的选手'), text('ops.noPlayersDesc', '调整搜索、岗位或战队筛选后重试。')));
    return playerPanel.section;
  }

  function renderResources(data) {
    const fragment = document.createDocumentFragment();
    fragment.append(metrics([
      { label: text('ops.metricMaterials', '素材索引'), value: formatNumber(data.metrics.materials), detail: text('ops.dbRecordsNote', '数据库记录总数') },
      { label: text('ops.metricFiles', '文件'), value: formatNumber(data.metrics.files), detail: text('ops.outputReadyNote', '可直接用于赛事输出') },
      { label: text('ops.metricFolders', '监听目录'), value: formatNumber(data.metrics.watchedFolders), detail: text('ops.folderIndexNote', '{count} 个目录索引', { count: data.metrics.folders }) }
    ]));
    const validation = panel(text('ops.validationTitle', '路径校验'), text('ops.validationDesc', '展示最近一次 OBS 资源路径校验结果。'));
    if (!data.validation) validation.section.append(emptyState(text('ops.noValidation', '尚未执行路径校验'), text('ops.noValidationDesc', '前往素材中心执行校验后，这里会持续展示最新结果。')));
    else {
      const callout = element('div', `operations-health-callout ${data.validation.valid ? 'is-success' : 'is-danger'}`);
      callout.append(statusChip(data.validation.valid ? text('ops.pathValid', '路径有效') : text('ops.pathMissing', '发现缺失'), data.validation.valid ? 'success' : 'danger'));
      callout.append(element('strong', '', text('ops.validationCounts', '{objects} 个 OBS 对象 · {refs} 条引用', { objects: data.validation.objectCount, refs: data.validation.referenceCount })));
      callout.append(element('span', '', text('ops.missingWithTime', '{count} 条缺失 · {time}', { count: data.validation.missingCount, time: formatTimestamp(data.validation.checkedAt) })));
      validation.section.append(callout);
    }
    validation.header.append(button(text('ops.openMaterials', '打开素材中心'), () => navigate('materials')));
    fragment.append(validation.section);
    const recent = panel(text('ops.recentIndexTitle', '最近索引'), text('ops.recentIndexDesc', '仅显示文件名和类型，不在页面暴露完整本机路径。'));
    recent.section.append(data.recent.length ? table([text('ops.colName', '名称'), text('ops.colType', '类型'), text('ops.colFormat', '格式'), text('ops.colAddedAt', '加入时间')], data.recent.map(item => [
      element('strong', '', item.name), item.kind === 'folder' ? text('ops.kindFolder', '目录') : text('ops.kindFile', '文件'), item.extension.toUpperCase(), formatTimestamp(item.addedAt)
    ])) : emptyState(text('ops.noMaterials', '暂无素材索引'), text('ops.noMaterialsDesc', '导入素材目录后会自动显示。')));
    fragment.append(recent.section);
    return fragment;
  }

  function renderMatches(data) {
    const matchPanel = panel(text('ops.matchesTitle', '有效比赛记录'), text('ops.matchesDesc', '共 {count} 场；同一比赛、局数和房间只统计最高 attempt。', { count: data.total }));
    matchPanel.section.append(data.items.length ? table([text('ops.colDecidedAt', '结算时间'), text('ops.colEventMatchup', '赛事 / 对阵'), text('ops.colScore', '局分'), text('ops.colWinner', '胜者'), text('ops.colEffective', '有效局'), text('ops.colReplay', '重赛')], data.items.map(item => {
      const match = element('div', 'operations-match-cell');
      match.append(element('strong', '', text('ops.matchupLine', '{home} vs {away}', { home: item.homeName || text('ops.tbd', '待定'), away: item.awayName || text('ops.tbd', '待定') })));
      match.append(element('span', '', item.eventName));
      return [
        item.decidedAt ? formatTimestamp(item.decidedAt) : `${formatDate(item.date)} ${formatTime(item.startTime)}`,
        match,
        element('strong', 'operations-score', `${item.score.home} : ${item.score.away}`),
        item.winner ? statusChip(item.winner.name, 'success') : statusChip(text('ops.pendingResult', '待结算'), 'neutral'),
        `${item.completedGameCount}/${item.effectiveGameCount}`,
        item.replayCount ? statusChip(text('ops.highestAttempt', '最高 attempt {count}', { count: item.highestAttempt }), 'warning') : text('ops.noneShort', '无')
      ];
    })) : emptyState(text('ops.noMatchRecords', '没有匹配的比赛记录'), text('ops.noMatchRecordsDesc', '比赛完成 BP 结算后会自动显示。')));
    return matchPanel.section;
  }

  function renderDataConfig(data) {
    const fragment = document.createDocumentFragment();
    fragment.append(metrics([
      { label: text('ops.metricSchemaVersion', '数据库版本'), value: `v${data.schemaVersion}`, detail: text('ops.sqliteNote', 'SQLite schema') },
      { label: text('ops.metricEntities', '数据实体'), value: formatNumber(data.entities.length), detail: text('ops.coreTablesNote', '核心业务表') },
      { label: text('ops.metricSources', '赛事来源'), value: formatNumber(data.sources.length), detail: text('ops.fingerprintNote', '带来源指纹的赛事配置') }
    ]));
    const entities = panel(text('ops.entitiesTitle', '实体状态'), text('ops.entitiesDesc', '用于判断各业务模块是否已有可用数据。'));
    const entityGrid = element('div', 'operations-entity-grid');
    data.entities.forEach(item => {
      const row = element('div', 'operations-entity-row');
      row.append(element('span', '', item.label), element('strong', '', formatNumber(item.count)), element('code', '', item.key));
      entityGrid.append(row);
    });
    entities.section.append(entityGrid);
    fragment.append(entities.section);
    const sources = panel(text('ops.sourcesTitle', '赛事数据来源'), text('ops.sourcesDesc', '仅展示文件名与短指纹，避免暴露本机目录。'));
    sources.section.append(data.sources.length ? table([text('ops.colEvent', '赛事'), text('ops.colDivision', '端别'), text('ops.colSourceFile', '来源文件'), text('ops.colFingerprint', '指纹')], data.sources.map(item => [
      element('strong', '', item.name), item.division === 'pc' ? text('ops.pcSide', 'PC 端') : text('ops.peSide', 'PE 端'), item.sourceName || text('ops.unrecorded', '未记录'),
      element('code', 'operations-code', item.fingerprint || text('ops.noneShort', '无'))
    ])) : emptyState(text('ops.noSources', '暂无来源记录'), text('ops.noSourcesDesc', '赛事数据导入后会显示来源文件指纹。')));
    fragment.append(sources.section);
    return fragment;
  }

  function renderTerminal(data) {
    const memory = data.process.memory || {};
    const fragment = document.createDocumentFragment();
    fragment.append(metrics([
      { label: text('ops.metricProcess', '服务进程'), value: `PID ${data.process.pid}`, detail: text('ops.processDetail', '{node} · {uptime}', { node: data.process.node, uptime: formatDuration(data.process.uptimeSeconds) }), mode: 'success' },
      { label: text('ops.metricSessions', '活跃会话'), value: formatNumber(data.connections.activeSessions), detail: text('ops.dutySessionsNote', '{count} 个值守会话', { count: data.connections.dutySessions }) },
      { label: text('ops.metricDatabase', '数据库'), value: data.database.healthy ? text('ops.healthy', '正常') : text('ops.unhealthy', '异常'), detail: text('ops.schemaVersionLabel', 'Schema v{version}', { version: data.database.schemaVersion }), mode: data.database.healthy ? 'success' : 'danger' },
      { label: text('ops.metricMemory', '内存占用'), value: formatBytes(memory.rss), detail: text('ops.heapDetail', 'Heap {value}', { value: formatBytes(memory.heapUsed) }) }
    ]));
    const connections = panel(text('ops.connectionsTitle', '实时链路'), text('ops.connectionsDesc', '页面打开时每 10 秒刷新一次，不建立额外长连接。'));
    connections.section.append(table([text('ops.colLink', '链路'), text('ops.colConnections', '连接数'), text('ops.colPurpose', '用途')], [
      [text('ops.linkCommunications', '通讯频道 SSE'), data.connections.communicationStreams, text('ops.purposeMessaging', '即时消息')],
      [text('ops.linkNotifications', '通知中心 SSE'), data.connections.notificationStreams, text('ops.purposeNotify', '通知与加急')],
      [text('ops.linkPresentation', 'BP 呈现 SSE'), data.connections.presentationStreams, text('ops.purposeBp', '动态 BP 画面')]
    ]));
    fragment.append(connections.section);
    const processPanel = panel(text('ops.envTitle', '运行环境'), text('ops.envDesc', '正式服务当前进程信息。'));
    processPanel.section.append(table([text('ops.colItem', '项目'), text('ops.colValue', '当前值')], [
      [text('ops.colStartedAt', '启动时间'), formatTimestamp(data.process.startedAt)],
      [text('ops.colPlatform', '运行平台'), data.process.platform],
      [text('ops.colDbActivity', '最近数据库活动'), formatTimestamp(data.database.lastActivityAt)],
      ['Node.js', data.process.node]
    ]));
    fragment.append(processPanel.section);
    return fragment;
  }

  function renderSettings(data) {
    const fragment = document.createDocumentFragment();
    const laboratory = panel(text('ops.labTitle', '实验室功能'), text('ops.labDesc', '实验功能默认关闭，可随时回退到现有稳定界面。'));
    laboratory.section.classList.add('laboratory-settings-panel');
    const row = element('div', 'laboratory-setting-row');
    const copy = element('div', 'laboratory-setting-copy');
    copy.append(element('strong', '', text('ops.labNewBp', '启用新版 BP 界面')));
    copy.append(element('span', '', text('ops.labNewBpDesc', '切换 BP 控制台的操作布局，不影响 OBS 输出、比赛记录或既有 BP 数据。')));
    const control = element('label', 'switch-control laboratory-setting-switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.role = 'switch';
    input.checked = Boolean(data.laboratory?.newBpInterface);
    input.setAttribute('aria-label', text('ops.labNewBp', '启用新版 BP 界面'));
    const track = element('span', 'switch-track');
    track.setAttribute('aria-hidden', 'true');
    track.append(element('span'));
    const state = element('strong', '', input.checked ? text('ops.enabled', '已启用') : text('ops.disabled', '已关闭'));
    control.append(input, track, state);
    const feedback = element('div', 'laboratory-setting-feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    input.addEventListener('change', async () => {
      const previous = !input.checked;
      input.disabled = true;
      state.textContent = text('ops.saving', '正在保存');
      feedback.textContent = '';
      feedback.classList.remove('is-error');
      try {
        const saved = await api('/api/admin/laboratory-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newBpInterface: input.checked })
        });
        input.checked = Boolean(saved.newBpInterface);
        state.textContent = input.checked ? text('ops.enabled', '已启用') : text('ops.disabled', '已关闭');
        data.laboratory = saved;
        window.StellaDataCache?.invalidate('/api/operations/settings');
        window.dispatchEvent(new CustomEvent('stella:lab-settings-change', { detail: saved }));
        feedback.textContent = text('ops.savedFeedback', '设置已保存');
        feedback.classList.remove('is-error');
      } catch (error) {
        input.checked = previous;
        state.textContent = previous ? text('ops.enabled', '已启用') : text('ops.disabled', '已关闭');
        feedback.textContent = error.message;
        feedback.classList.add('is-error');
      } finally {
        input.disabled = false;
      }
    });
    row.append(copy, control);
    laboratory.section.append(row, feedback);
    fragment.append(laboratory.section);
    return fragment;
  }

  function renderAlerts(data) {
    const fragment = document.createDocumentFragment();
    fragment.append(metrics([
      { label: text('ops.metricSensitive', '敏感操作'), value: formatNumber(data.metrics.sensitive), detail: text('ops.windowNote', '当前聚合窗口'), mode: data.metrics.sensitive ? 'warning' : '' },
      { label: text('ops.metricFailed', '失败请求'), value: formatNumber(data.metrics.failed), detail: text('ops.accountSystemNote', '账号与系统操作'), mode: data.metrics.failed ? 'danger' : '' },
      { label: text('ops.metricObsFailed', 'OBS 异常'), value: formatNumber(data.metrics.obsFailed), detail: text('ops.outputLinkNote', '输出链路'), mode: data.metrics.obsFailed ? 'danger' : '' },
      { label: text('ops.metricAttention', '待关注'), value: formatNumber(data.metrics.unresolved), detail: text('ops.failedNote', '失败或带错误记录'), mode: data.metrics.unresolved ? 'danger' : 'success' }
    ]));
    const alertPanel = panel(text('ops.alertsTitle', '高危操作流'), text('ops.alertsDesc', '保留身份、IP、地区和设备信息，便于定位风险来源。'));
    if (!data.items.length) alertPanel.section.append(emptyState(text('ops.noAlerts', '暂无高危记录'), text('ops.noAlertsDesc', '当前聚合窗口内没有敏感或失败操作。')));
    else {
      const list = element('div', 'operations-alert-list');
      data.items.forEach(item => {
        const row = element('article', `operations-alert-row ${item.success ? 'is-sensitive' : 'is-failed'}`);
        const main = element('div');
        main.append(element('strong', '', item.action));
        main.append(element('span', '', text('ops.alertActor', '{actor} · {identity} · {time}', { actor: item.actor, identity: IDENTITY_LABELS[item.identityKey] || item.identityKey, time: formatTimestamp(item.timestamp) })));
        const context = element('div', 'operations-alert-context');
        context.append(statusChip(item.success ? text('ops.sensitiveAction', '敏感操作') : text('ops.actionFailed', '执行失败'), item.success ? 'warning' : 'danger'));
        context.append(element('code', '', item.ipAddress), element('span', '', item.region), element('span', '', item.deviceName));
        if (item.error) context.append(element('strong', 'operations-error-text', item.error));
        row.append(main, context);
        list.append(row);
      });
      alertPanel.section.append(list);
    }
    fragment.append(alertPanel.section);
    return fragment;
  }

  function render(view, data) {
    if (view === 'personal') return renderPersonal(data);
    if (view === 'events') return renderEvents(data);
    if (view === 'teams') return renderTeams(data);
    if (view === 'players') return renderPlayers(data);
    if (view === 'resources') return renderResources(data);
    if (view === 'matches') return renderMatches(data);
    if (view === 'dataConfig') return renderDataConfig(data);
    if (view === 'terminal') return renderTerminal(data);
    if (view === 'settings') return renderSettings(data);
    return renderAlerts(data);
  }

  function buildUrl(state, append) {
    const url = new URL(`/api/operations/${state.view}`, window.location.origin);
    if (PAGED_VIEWS.has(state.view)) {
      url.searchParams.set('limit', '60');
      url.searchParams.set('offset', String(append ? state.data?.items?.length || 0 : 0));
    }
    if (state.query) url.searchParams.set('query', state.query);
    if (state.division) url.searchParams.set('division', state.division);
    if (state.role) url.searchParams.set('role', state.role);
    if (state.teamId) url.searchParams.set('teamId', state.teamId);
    if (state.eventId) url.searchParams.set('eventId', state.eventId);
    return `${url.pathname}${url.search}`;
  }

  function updateCount(state) {
    const root = rootFor(state.view);
    const count = root?.querySelector('[data-operations-count]');
    if (!count) return;
    const total = state.data?.total;
    count.textContent = total === undefined ? text('ops.updatedAt', '更新于 {time}', { time: formatTimestamp(state.data?.generatedAt || Date.now()) })
      : (state.teamId || state.eventId ? text('ops.filteredPrefix', '已应用关联筛选 · ') : '') + text('ops.totalCount', '共 {count} 条', { count: formatNumber(total) });
    const clear = root?.querySelector('[data-operations-clear-filter]');
    if (clear) clear.hidden = !state.teamId && !state.eventId;
  }

  function bindSentinel(state) {
    state.observer?.disconnect();
    if (!state.hasMore) return;
    const content = contentFor(state.view);
    const sentinel = element('div', 'operations-sentinel');
    sentinel.setAttribute('aria-label', text('ops.loadMoreAria', '继续加载'));
    content.append(sentinel);
    state.observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) load(state.view, { append: true });
    }, { root: content, rootMargin: '240px 0px' });
    state.observer.observe(sentinel);
  }

  async function load(view, options = {}) {
    const state = stateFor(view);
    if (state.loading) return;
    const content = contentFor(view);
    if (!content) return;
    const append = Boolean(options.append && state.hasMore && state.data?.items);
    state.loading = true;
    const version = ++state.requestVersion;
    rootFor(view).setAttribute('aria-busy', 'true');
    if (!append && !state.initialized) content.replaceChildren(loadingState());
    try {
      const payload = await api(buildUrl(state, append), { force: Boolean(options.force) });
      if (version !== state.requestVersion) return;
      const incoming = payload.data;
      if (append) {
        const known = new Set(state.data.items.map(item => item.id));
        state.data = { ...incoming, items: [...state.data.items, ...incoming.items.filter(item => !known.has(item.id))] };
      } else state.data = incoming;
      state.data.generatedAt = payload.generatedAt;
      state.hasMore = Boolean(incoming.hasMore);
      state.initialized = true;
      content.replaceChildren(render(view, state.data));
    if (!append && window.PageFX) PageFX.stagger(content.querySelectorAll('tbody tr, .operations-team-card'), { step: 18, cap: 16 });
      updateCount(state);
      bindSentinel(state);
    } catch (error) {
      if (version !== state.requestVersion) return;
      if (!append) {
        const failed = emptyState(text('ops.loadFailed', '数据读取失败'), error.message);
        failed.append(button(text('ops.reload', '重新加载'), () => load(view, { force: true })));
        content.replaceChildren(failed);
      }
    } finally {
      state.loading = false;
      rootFor(view)?.setAttribute('aria-busy', 'false');
    }
  }

  function refreshFromFilters(state) {
    state.offset = 0;
    state.hasMore = false;
    state.initialized = false;
    load(state.view, { force: true });
  }

  function setupToolbar(root, view) {
    const config = VIEW_CONFIG[view];
    const toolbar = root.querySelector('[data-operations-toolbar]');
    if (!toolbar || toolbar.childElementCount) return;
    const state = stateFor(view);
    const controls = element('div', 'operations-toolbar-controls');
    if (config.search) {
      const search = element('label', 'operations-search');
      search.append(element('span', 'visually-hidden', text('ops.searchLabel', '搜索')));
      const input = document.createElement('input');
      input.type = 'search';
      input.placeholder = config.placeholder;
      let timer = 0;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = window.setTimeout(() => {
          state.query = input.value.trim();
          refreshFromFilters(state);
        }, 280);
      });
      search.append(input);
      controls.append(search);
    }
    if (config.division) {
      const select = document.createElement('select');
      select.setAttribute('aria-label', text('ops.divisionFilterAria', '端别筛选'));
      [['', text('ops.allSides', '全部端别')], ['pc', text('ops.pcSide', 'PC 端')], ['mobile', text('ops.peSide', 'PE 端')]].forEach(([value, label]) => {
        const option = element('option', '', label);
        option.value = value;
        select.append(option);
      });
      select.addEventListener('change', () => {
        state.division = select.value;
        refreshFromFilters(state);
      });
      controls.append(select);
    }
    if (config.role) {
      const select = document.createElement('select');
      select.setAttribute('aria-label', text('ops.roleFilterAria', '岗位筛选'));
      [['', text('ops.allRoles', '全部岗位')], ['escape', text('ops.escape', '逃生')], ['hunter', text('ops.hunter', '追捕')]].forEach(([value, label]) => {
        const option = element('option', '', label);
        option.value = value;
        select.append(option);
      });
      select.addEventListener('change', () => {
        state.role = select.value;
        refreshFromFilters(state);
      });
      controls.append(select);
    }
    const meta = element('div', 'operations-toolbar-meta');
    const count = element('span');
    count.dataset.operationsCount = '';
    const clear = button(text('ops.clearFilters', '清除关联筛选'), () => {
      state.teamId = '';
      state.eventId = '';
      refreshFromFilters(state);
    }, 'operations-text-action');
    clear.dataset.operationsClearFilter = '';
    clear.hidden = true;
    meta.append(count, clear, button(text('ops.refresh', '刷新'), () => load(view, { force: true }), 'operations-refresh'));
    toolbar.append(controls, meta);
  }

  function activate(page) {
    const view = PAGE_TO_VIEW[page];
    if (!view) return;
    clearInterval(liveTimer);
    liveTimer = 0;
    load(view);
    if (view === 'terminal' || view === 'alerts') {
      const interval = view === 'terminal' ? 10000 : 15000;
      liveTimer = window.setInterval(() => {
        const panel = rootFor(view)?.closest('[data-page-panel]');
        if (!panel?.hidden && document.visibilityState === 'visible') load(view, { force: true });
      }, interval);
    }
  }

  document.querySelectorAll('[data-operations-root]').forEach(root => setupToolbar(root, root.dataset.operationsRoot));
  window.addEventListener('stella:page-change', event => activate(event.detail?.page));
  window.addEventListener('stella:operations-filter', event => {
    const view = event.detail?.view;
    if (!view || !states.has(view)) return;
    const state = stateFor(view);
    if (event.detail.teamId) state.teamId = event.detail.teamId;
    if (event.detail.eventId) state.eventId = event.detail.eventId;
    const panel = rootFor(view)?.closest('[data-page-panel]');
    if (panel && !panel.hidden) refreshFromFilters(state);
  });
  window.addEventListener('stella:identity-change', () => {
    window.StellaDataCache?.invalidate('/api/operations');
    MANAGEMENT_VIEWS.forEach(view => {
      const state = stateFor(view);
      state.requestVersion += 1;
      state.initialized = false;
      state.data = null;
      state.hasMore = false;
      state.observer?.disconnect();
      contentFor(view)?.replaceChildren();
    });
    const active = document.querySelector('[data-page].active')?.dataset.page;
    activate(active);
  });

  const activePage = document.querySelector('[data-page].active')?.dataset.page || 'personalCenter';
  activate(activePage);
})();
