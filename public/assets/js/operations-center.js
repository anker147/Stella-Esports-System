(function () {
  'use strict';

  const PAGE_TO_VIEW = {
    personalCenter: 'personal',
    events: 'events',
    schedule: 'schedule',
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
  const PAGED_VIEWS = new Set(['schedule', 'teams', 'players', 'matches']);
  const VIEW_CONFIG = {
    events: { search: false },
    schedule: { search: true, division: true, placeholder: '搜索赛事、战队或比赛编号' },
    teams: { search: true, placeholder: '搜索战队名称或编号' },
    players: { search: true, role: true, placeholder: '搜索选手、官方 ID 或战队' },
    resources: {},
    matches: { search: true, division: true, placeholder: '搜索赛事、战队或比赛编号' },
    dataConfig: {},
    terminal: {},
    settings: {},
    alerts: {}
  };
  const IDENTITY_LABELS = {
    developer: '开发者', administrator: '管理员', director: '赛事导演', commentator: '解说',
    referee: '裁判', scorer: '记分员', guest: '访客', operator: '管理员',
    technical: '技术支持（历史身份）', analyst: '赛事分析（历史身份）'
  };
  const STATUS_LABELS = {
    completed: '已结束', upcoming: '待开始', live: '今日进行', incomplete: '待补录', planned: '规划中'
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
      if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
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
    if (!value) return '日期待定';
    const date = new Date(`${value}T00:00:00`);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function formatTime(value) {
    return value || '--:--';
  }

  function formatTimestamp(value) {
    if (value === undefined || value === null || value === '') return '暂无记录';
    const date = new Date(Number(value) || value);
    if (!Number.isFinite(date.getTime())) return '暂无记录';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(date);
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours) return `${hours} 小时 ${minutes} 分`;
    return `${minutes} 分钟`;
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 ** 2).toFixed(1)} MB`;
  }

  function statusChip(label, mode = 'neutral') {
    return element('span', `operations-chip is-${mode}`, label);
  }

  function metrics(items) {
    const grid = element('section', 'operations-metrics');
    grid.setAttribute('aria-label', '关键指标');
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
    loading.setAttribute('aria-label', '正在读取数据');
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
        else td.textContent = cell === undefined || cell === null || cell === '' ? '暂无' : String(cell);
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
    wrap.append(mark, element('strong', '', team || '未知战队'));
    return wrap;
  }

  function renderPersonal(data) {
    const fragment = document.createDocumentFragment();
    const heading = element('section', 'operations-personal-heading');
    const copy = element('div');
    copy.append(element('span', 'operations-eyebrow', '今日工作'));
    copy.append(element('h2', '', `${data.user?.displayName || '当前用户'}，值守信息已同步`));
    copy.append(element('p', '', data.scheduleMode === 'today'
      ? `今天共有 ${data.matches.length} 场赛事安排，请按时间确认控制台与通讯频道。`
      : '今天暂无赛事，以下显示数据库中距离今天最近的赛程，便于提前核对。'));
    heading.append(copy, statusChip(data.scheduleMode === 'today' ? '今日赛程' : '最近赛程', data.scheduleMode === 'today' ? 'live' : 'neutral'));
    fragment.append(heading);
    fragment.append(metrics([
      { label: '今日值守', value: formatDuration(data.duty.seconds), detail: `${data.duty.sessions} 个登录会话` },
      { label: data.scheduleMode === 'today' ? '今日比赛' : '参考赛程', value: formatNumber(data.matches.length), detail: '已关联赛事数据库' },
      { label: '最近操作', value: formatNumber(data.recentActions.length), detail: '当前账号审计记录' }
    ]));

    const schedulePanel = panel(data.scheduleMode === 'today' ? '今日赛程' : '最近赛程', '时间、对阵和端别来自赛事数据库。');
    schedulePanel.header.append(button('查看全部赛程', () => navigate('schedule')));
    if (!data.matches.length) schedulePanel.section.append(emptyState('暂无可用赛程', '赛事数据录入后会自动出现在这里。'));
    else {
      const list = element('div', 'operations-personal-schedule');
      data.matches.forEach(match => {
        const row = element('article', 'operations-agenda-row');
        const when = element('time');
        when.append(element('strong', '', formatTime(match.start_time)), element('span', '', formatDate(match.date)));
        const matchup = element('div');
        matchup.append(element('strong', '', `${match.matchup_home || '待定'} vs ${match.matchup_away || '待定'}`));
        matchup.append(element('span', '', match.event_name));
        row.append(when, matchup, statusChip(match.division === 'pc' ? 'PC 端' : 'PE 端', 'blue'));
        list.append(row);
      });
      schedulePanel.section.append(list);
    }
    fragment.append(schedulePanel.section);

    const actionPanel = panel('账号近期操作', '用于交接班时快速确认当前账号最近执行的动作。');
    if (!data.recentActions.length) actionPanel.section.append(emptyState('暂无近期操作', '开始使用赛事工具后会自动记录。'));
    else actionPanel.section.append(table(['时间', '动作', '身份', '结果'], data.recentActions.map(item => [
      formatTimestamp(item.timestamp), item.action, IDENTITY_LABELS[item.identityKey] || item.identityKey,
      statusChip(item.success ? '成功' : '失败', item.success ? 'success' : 'danger')
    ])));
    fragment.append(actionPanel.section);
    return fragment;
  }

  function renderEvents(data) {
    const fragment = document.createDocumentFragment();
    fragment.append(metrics([
      { label: '赛事总数', value: formatNumber(data.metrics.events), detail: `${data.metrics.upcoming} 项待进行` },
      { label: '赛程总数', value: formatNumber(data.metrics.matches), detail: '关联比赛表' },
      { label: '参赛战队', value: formatNumber(data.metrics.teams), detail: '去重战队' }
    ]));
    const eventPanel = panel('赛事目录', '按赛事日期与原始配置顺序展示。');
    const list = element('div', 'operations-event-list');
    data.items.forEach(item => {
      const record = element('article', 'operations-event-record');
      const main = element('div', 'operations-event-main');
      const title = element('div', 'operations-record-title');
      title.append(element('h3', '', item.name), statusChip(item.division === 'pc' ? 'PC 端' : 'PE 端', 'blue'),
        statusChip(STATUS_LABELS[item.status] || item.status, item.status));
      main.append(title, element('p', '', `${item.stage || '阶段待定'} · ${item.mode || '赛制待定'} · ${item.format || '格式待定'}`));
      const facts = element('div', 'operations-record-facts');
      facts.append(element('span', '', formatDate(item.date)), element('span', '', `${item.teamCount} 支战队`),
        element('span', '', `${item.playerCount} 名选手`), element('span', '', item.sourceName || '无来源文件'));
      main.append(facts);
      const progress = element('div', 'operations-progress');
      const progressValue = item.matchCount ? Math.round(item.completedMatchCount / item.matchCount * 100) : 0;
      progress.append(element('div', 'operations-progress-copy', `${item.completedMatchCount} / ${item.matchCount} 场完成`));
      const track = element('span', 'operations-progress-track');
      const fill = element('span', 'operations-progress-fill');
      fill.style.width = `${progressValue}%`;
      track.append(fill);
      progress.append(track, element('strong', '', `${progressValue}%`));
      record.append(main, progress);
      list.append(record);
    });
    eventPanel.section.append(data.items.length ? list : emptyState('暂无赛事', '导入赛事数据后会显示赛事目录。'));
    fragment.append(eventPanel.section);
    return fragment;
  }

  function renderSchedule(data) {
    const matchCell = item => {
      const cell = element('div', 'operations-match-cell');
      cell.append(element('strong', '', `${item.home.name || '待定'} vs ${item.away.name || '待定'}`));
      cell.append(element('span', '', item.stage || item.format || '赛事阶段'));
      return cell;
    };
    const status = item => {
      if (item.winner) return statusChip(`胜者 ${item.winner.name}`, 'success');
      if (item.completedGameCount) return statusChip(`${item.completedGameCount} 局已结算`, 'live');
      return statusChip('待开始', 'neutral');
    };
    const schedulePanel = panel('赛程列表', `当前条件共 ${data.total} 场比赛，滚动时自动读取后续数据。`);
    schedulePanel.section.append(data.items.length ? table(['日期 / 时间', '赛事', '对阵', '房间 / 有效局', '状态'], data.items.map(item => [
      `${formatDate(item.date)}  ${formatTime(item.startTime)}`,
      element('strong', '', item.eventName),
      matchCell(item),
      `${item.roomCount || 0} 房 · ${item.completedGameCount}/${item.gameCount || 0} 局`,
      status(item)
    ])) : emptyState('没有匹配的赛程', '调整搜索或端别筛选后重试。'));
    return schedulePanel.section;
  }

  function renderTeams(data) {
    const teamPanel = panel('战队档案', `共 ${data.total} 支战队，阵容与赛事数据已关联。`);
    if (!data.items.length) {
      teamPanel.section.append(emptyState('没有匹配的战队', '调整搜索条件后重试。'));
      return teamPanel.section;
    }
    const grid = element('div', 'operations-team-grid');
    data.items.forEach(item => {
      const card = element('article', 'operations-team-card');
      const heading = element('header');
      heading.append(teamIdentity(item.name, item.logos.escape || item.logos.hunter));
      heading.append(statusChip(`${item.eventCount} 项赛事`, 'blue'));
      const stats = element('dl');
      [['阵容', item.playerCount], ['逃生', item.escapeCount], ['追捕', item.hunterCount], ['胜场', item.matchWins]].forEach(([label, value]) => {
        const fact = element('div');
        fact.append(element('dt', '', label), element('dd', '', value));
        stats.append(fact);
      });
      card.append(heading, stats, button('查看选手', () => {
        window.dispatchEvent(new CustomEvent('stella:operations-filter', { detail: { view: 'players', teamId: item.id } }));
        navigate('players');
      }, 'operations-text-action'));
      grid.append(card);
    });
    teamPanel.section.append(grid);
    return teamPanel.section;
  }

  function renderPlayers(data) {
    const role = item => statusChip(item.role === 'escape' ? '逃生' : '追捕', item.role === 'escape' ? 'blue' : 'danger');
    const identity = item => teamIdentity(item.team.name, item.team.logo);
    const playerPanel = panel('选手档案', `共 ${data.total} 名选手，当前已读取 ${data.items.length} 名。`);
    playerPanel.section.append(data.items.length ? table(['选手', '所属战队', '岗位', '官方 ID', '注册信息', '阵容'], data.items.map(item => [
      element('strong', '', item.nickname || item.registeredNickname || '未命名'),
      identity(item),
      role(item),
      element('code', 'operations-code', item.officialId || '未登记'),
      `${item.registeredNickname || '未登记'} · ${item.registeredOfficialId || '无 ID'}`,
      statusChip(item.substitute ? '替补' : `第 ${item.slot || '-'} 顺位`, item.substitute ? 'warning' : 'neutral')
    ])) : emptyState('没有匹配的选手', '调整搜索、岗位或战队筛选后重试。'));
    return playerPanel.section;
  }

  function renderResources(data) {
    const fragment = document.createDocumentFragment();
    fragment.append(metrics([
      { label: '素材索引', value: formatNumber(data.metrics.materials), detail: '数据库记录总数' },
      { label: '文件', value: formatNumber(data.metrics.files), detail: '可直接用于赛事输出' },
      { label: '监听目录', value: formatNumber(data.metrics.watchedFolders), detail: `${data.metrics.folders} 个目录索引` }
    ]));
    const validation = panel('路径校验', '展示最近一次 OBS 资源路径校验结果。');
    if (!data.validation) validation.section.append(emptyState('尚未执行路径校验', '前往素材中心执行校验后，这里会持续展示最新结果。'));
    else {
      const callout = element('div', `operations-health-callout ${data.validation.valid ? 'is-success' : 'is-danger'}`);
      callout.append(statusChip(data.validation.valid ? '路径有效' : '发现缺失', data.validation.valid ? 'success' : 'danger'));
      callout.append(element('strong', '', `${data.validation.objectCount} 个 OBS 对象 · ${data.validation.referenceCount} 条引用`));
      callout.append(element('span', '', `${data.validation.missingCount} 条缺失 · ${formatTimestamp(data.validation.checkedAt)}`));
      validation.section.append(callout);
    }
    validation.header.append(button('打开素材中心', () => navigate('materials')));
    fragment.append(validation.section);
    const recent = panel('最近索引', '仅显示文件名和类型，不在页面暴露完整本机路径。');
    recent.section.append(data.recent.length ? table(['名称', '类型', '格式', '加入时间'], data.recent.map(item => [
      element('strong', '', item.name), item.kind === 'folder' ? '目录' : '文件', item.extension.toUpperCase(), formatTimestamp(item.addedAt)
    ])) : emptyState('暂无素材索引', '导入素材目录后会自动显示。'));
    fragment.append(recent.section);
    return fragment;
  }

  function renderMatches(data) {
    const matchPanel = panel('有效比赛记录', `共 ${data.total} 场；同一比赛、局数和房间只统计最高 attempt。`);
    matchPanel.section.append(data.items.length ? table(['结算时间', '赛事 / 对阵', '局分', '胜者', '有效局', '重赛'], data.items.map(item => {
      const match = element('div', 'operations-match-cell');
      match.append(element('strong', '', `${item.homeName || '待定'} vs ${item.awayName || '待定'}`));
      match.append(element('span', '', item.eventName));
      return [
        item.decidedAt ? formatTimestamp(item.decidedAt) : `${formatDate(item.date)} ${formatTime(item.startTime)}`,
        match,
        element('strong', 'operations-score', `${item.score.home} : ${item.score.away}`),
        item.winner ? statusChip(item.winner.name, 'success') : statusChip('待结算', 'neutral'),
        `${item.completedGameCount}/${item.effectiveGameCount}`,
        item.replayCount ? statusChip(`最高 attempt ${item.highestAttempt}`, 'warning') : '无'
      ];
    })) : emptyState('没有匹配的比赛记录', '比赛完成 BP 结算后会自动显示。'));
    return matchPanel.section;
  }

  function renderDataConfig(data) {
    const fragment = document.createDocumentFragment();
    fragment.append(metrics([
      { label: '数据库版本', value: `v${data.schemaVersion}`, detail: 'SQLite schema' },
      { label: '数据实体', value: formatNumber(data.entities.length), detail: '核心业务表' },
      { label: '赛事来源', value: formatNumber(data.sources.length), detail: '带来源指纹的赛事配置' }
    ]));
    const entities = panel('实体状态', '用于判断各业务模块是否已有可用数据。');
    const entityGrid = element('div', 'operations-entity-grid');
    data.entities.forEach(item => {
      const row = element('div', 'operations-entity-row');
      row.append(element('span', '', item.label), element('strong', '', formatNumber(item.count)), element('code', '', item.key));
      entityGrid.append(row);
    });
    entities.section.append(entityGrid);
    fragment.append(entities.section);
    const sources = panel('赛事数据来源', '仅展示文件名与短指纹，避免暴露本机目录。');
    sources.section.append(data.sources.length ? table(['赛事', '端别', '来源文件', '指纹'], data.sources.map(item => [
      element('strong', '', item.name), item.division === 'pc' ? 'PC 端' : 'PE 端', item.sourceName || '未记录',
      element('code', 'operations-code', item.fingerprint || '无')
    ])) : emptyState('暂无来源记录', '赛事数据导入后会显示来源文件指纹。'));
    fragment.append(sources.section);
    return fragment;
  }

  function renderTerminal(data) {
    const memory = data.process.memory || {};
    const fragment = document.createDocumentFragment();
    fragment.append(metrics([
      { label: '服务进程', value: `PID ${data.process.pid}`, detail: `${data.process.node} · ${formatDuration(data.process.uptimeSeconds)}`, mode: 'success' },
      { label: '活跃会话', value: formatNumber(data.connections.activeSessions), detail: `${data.connections.dutySessions} 个值守会话` },
      { label: '数据库', value: data.database.healthy ? '正常' : '异常', detail: `Schema v${data.database.schemaVersion}`, mode: data.database.healthy ? 'success' : 'danger' },
      { label: '内存占用', value: formatBytes(memory.rss), detail: `Heap ${formatBytes(memory.heapUsed)}` }
    ]));
    const connections = panel('实时链路', '页面打开时每 10 秒刷新一次，不建立额外长连接。');
    connections.section.append(table(['链路', '连接数', '用途'], [
      ['通讯频道 SSE', data.connections.communicationStreams, '即时消息'],
      ['通知中心 SSE', data.connections.notificationStreams, '通知与加急'],
      ['BP 呈现 SSE', data.connections.presentationStreams, '动态 BP 画面']
    ]));
    fragment.append(connections.section);
    const processPanel = panel('运行环境', '正式服务当前进程信息。');
    processPanel.section.append(table(['项目', '当前值'], [
      ['启动时间', formatTimestamp(data.process.startedAt)],
      ['运行平台', data.process.platform],
      ['最近数据库活动', formatTimestamp(data.database.lastActivityAt)],
      ['Node.js', data.process.node]
    ]));
    fragment.append(processPanel.section);
    return fragment;
  }

  function renderSettings(data) {
    const fragment = document.createDocumentFragment();
    const laboratory = panel('实验室功能', '实验功能默认关闭，可随时回退到现有稳定界面。');
    laboratory.section.classList.add('laboratory-settings-panel');
    const row = element('div', 'laboratory-setting-row');
    const copy = element('div', 'laboratory-setting-copy');
    copy.append(element('strong', '', '启用新版 BP 界面'));
    copy.append(element('span', '', '切换 BP 控制台的操作布局，不影响 OBS 输出、比赛记录或既有 BP 数据。'));
    const control = element('label', 'switch-control laboratory-setting-switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.role = 'switch';
    input.checked = Boolean(data.laboratory?.newBpInterface);
    input.setAttribute('aria-label', '启用新版 BP 界面');
    const track = element('span', 'switch-track');
    track.setAttribute('aria-hidden', 'true');
    track.append(element('span'));
    const state = element('strong', '', input.checked ? '已启用' : '已关闭');
    control.append(input, track, state);
    const feedback = element('div', 'laboratory-setting-feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    input.addEventListener('change', async () => {
      const previous = !input.checked;
      input.disabled = true;
      state.textContent = '正在保存';
      feedback.textContent = '';
      feedback.classList.remove('is-error');
      try {
        const saved = await api('/api/admin/laboratory-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newBpInterface: input.checked })
        });
        input.checked = Boolean(saved.newBpInterface);
        state.textContent = input.checked ? '已启用' : '已关闭';
        data.laboratory = saved;
        window.StellaDataCache?.invalidate('/api/operations/settings');
        window.dispatchEvent(new CustomEvent('stella:lab-settings-change', { detail: saved }));
        feedback.textContent = '设置已保存';
        feedback.classList.remove('is-error');
      } catch (error) {
        input.checked = previous;
        state.textContent = previous ? '已启用' : '已关闭';
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
      { label: '敏感操作', value: formatNumber(data.metrics.sensitive), detail: '当前聚合窗口', mode: data.metrics.sensitive ? 'warning' : '' },
      { label: '失败请求', value: formatNumber(data.metrics.failed), detail: '账号与系统操作', mode: data.metrics.failed ? 'danger' : '' },
      { label: 'OBS 异常', value: formatNumber(data.metrics.obsFailed), detail: '输出链路', mode: data.metrics.obsFailed ? 'danger' : '' },
      { label: '待关注', value: formatNumber(data.metrics.unresolved), detail: '失败或带错误记录', mode: data.metrics.unresolved ? 'danger' : 'success' }
    ]));
    const alertPanel = panel('高危操作流', '保留身份、IP、地区和设备信息，便于定位风险来源。');
    if (!data.items.length) alertPanel.section.append(emptyState('暂无高危记录', '当前聚合窗口内没有敏感或失败操作。'));
    else {
      const list = element('div', 'operations-alert-list');
      data.items.forEach(item => {
        const row = element('article', `operations-alert-row ${item.success ? 'is-sensitive' : 'is-failed'}`);
        const main = element('div');
        main.append(element('strong', '', item.action));
        main.append(element('span', '', `${item.actor} · ${IDENTITY_LABELS[item.identityKey] || item.identityKey} · ${formatTimestamp(item.timestamp)}`));
        const context = element('div', 'operations-alert-context');
        context.append(statusChip(item.success ? '敏感操作' : '执行失败', item.success ? 'warning' : 'danger'));
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
    if (view === 'schedule') return renderSchedule(data);
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
    count.textContent = total === undefined ? `更新于 ${formatTimestamp(state.data?.generatedAt || Date.now())}`
      : `${state.teamId || state.eventId ? '已应用关联筛选 · ' : ''}共 ${formatNumber(total)} 条`;
    const clear = root?.querySelector('[data-operations-clear-filter]');
    if (clear) clear.hidden = !state.teamId && !state.eventId;
  }

  function bindSentinel(state) {
    state.observer?.disconnect();
    if (!state.hasMore) return;
    const content = contentFor(state.view);
    const sentinel = element('div', 'operations-sentinel');
    sentinel.setAttribute('aria-label', '继续加载');
    content.append(sentinel);
    state.observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) load(state.view, { append: true });
    }, { rootMargin: '240px 0px' });
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
      updateCount(state);
      bindSentinel(state);
    } catch (error) {
      if (version !== state.requestVersion) return;
      if (!append) {
        const failed = emptyState('数据读取失败', error.message);
        failed.append(button('重新加载', () => load(view, { force: true })));
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
      search.append(element('span', 'visually-hidden', '搜索'));
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
      select.setAttribute('aria-label', '端别筛选');
      [['', '全部端别'], ['pc', 'PC 端'], ['mobile', 'PE 端']].forEach(([value, label]) => {
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
      select.setAttribute('aria-label', '岗位筛选');
      [['', '全部岗位'], ['escape', '逃生'], ['hunter', '追捕']].forEach(([value, label]) => {
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
    const clear = button('清除关联筛选', () => {
      state.teamId = '';
      state.eventId = '';
      refreshFromFilters(state);
    }, 'operations-text-action');
    clear.dataset.operationsClearFilter = '';
    clear.hidden = true;
    meta.append(count, clear, button('刷新', () => load(view, { force: true }), 'operations-refresh'));
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
    refreshFromFilters(state);
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
