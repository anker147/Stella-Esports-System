(function () {
  const elements = {
    sidebarVersion: document.getElementById('systemVersion'),
    currentVersion: document.getElementById('releaseCurrentVersion'),
    updatedAt: document.getElementById('releaseUpdatedAt'),
    count: document.getElementById('releaseCount'),
    list: document.getElementById('releaseList'),
    locator: document.getElementById('releaseLocator'),
    top: document.getElementById('releaseTop')
  };

  let releaseEntries = [];
  let releaseMeta = [];
  let pointerClientY = null;
  let pointerOverList = false;
  let expandedSeen = false;
  let expandedAt = -1;
  let locatorStrip = null;
  let locatorLines = [];
  // 视窗节距 = 3px 线高 + 8px 间距，与 .release-locator-strip 的 gap/线高保持一致
  const LOCATOR_PITCH = 11;

  const locatorWindow = document.createElement('div');
  locatorWindow.className = 'release-locator-window';
  locatorStrip = document.createElement('div');
  locatorStrip.className = 'release-locator-strip';
  locatorWindow.appendChild(locatorStrip);
  elements.locator.replaceChildren(locatorWindow);

  function renderLocator(active) {
    const total = releaseEntries.length;
    if (!total || !locatorStrip) return;
    const offset = Math.max(0, Math.min(active - 4, total - 9));
    locatorStrip.style.transform = `translateY(${-offset * LOCATOR_PITCH}px)`;
    locatorLines.forEach((line, index) => {
      const dist = Math.min(Math.abs(index - active), 5);
      if (line.dataset.dist !== String(dist)) line.dataset.dist = String(dist);
    });
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function smoothScrollTo(top) {
    elements.list.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  // 实时计算指针压在哪条日志上：滚动时浏览器不触发 enter/leave，须按几何位置推算
  function findEntryIndexAt(clientY) {
    const rect = elements.list.getBoundingClientRect();
    const y = clientY - rect.top + elements.list.scrollTop;
    let best = -1;
    let bestDistance = Infinity;
    releaseEntries.forEach((entry, index) => {
      const top = entry.offsetTop;
      const bottom = top + entry.offsetHeight;
      const distance = y < top ? top - y : y > bottom ? y - bottom : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  function updateLocatorState() {
    if (!releaseEntries.length) return;
    const scrollTop = elements.list.scrollTop;
    // 已展开的版本滚动出可视区后自动折叠；刚展开的（scrollIntoView 未完成前）不折叠
    let expandedIndex = releaseEntries.findIndex(entry => entry.classList.contains('is-expanded'));
    if (expandedIndex >= 0) {
      const entry = releaseEntries[expandedIndex];
      const entryBottom = entry.offsetTop + entry.offsetHeight;
      const inView = entryBottom > scrollTop + 1
        && entry.offsetTop < scrollTop + elements.list.clientHeight - 1;
      if (inView) {
        expandedSeen = true;
      } else if (expandedSeen || expandedAt < 0 || performance.now() - expandedAt > 600) {
        entry.classList.remove('is-expanded');
        entry.querySelector('.release-card-toggle').setAttribute('aria-expanded', 'false');
        expandedIndex = -1;
        expandedSeen = false;
        expandedAt = -1;
      }
    }
    let scrollActive = 0;
    releaseEntries.forEach((entry, index) => {
      if (entry.offsetTop - 48 <= scrollTop) scrollActive = index;
    });
    if (elements.list.scrollHeight - elements.list.clientHeight - scrollTop <= 2) {
      scrollActive = releaseEntries.length - 1;
    }
    // 中心线定位优先级：已展开 > 指针所在日志 > 视口最顶部日志
    const hoverIndex = pointerOverList && pointerClientY != null
      ? findEntryIndexAt(pointerClientY)
      : -1;
    const active = expandedIndex >= 0
      ? expandedIndex
      : (hoverIndex >= 0 ? hoverIndex : scrollActive);
    elements.top.classList.toggle('is-visible', scrollTop > 160);
    renderLocator(active);
  }

  function formatDate(value) {
    if (!value) return t('up.noDate');
    const date = new Date(`${value}T00:00:00+08:00`);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
  }

  function makeChangeGroup(label, items) {
    const group = document.createElement('section');
    group.className = 'release-change-group';
    const title = document.createElement('h3');
    title.textContent = label;
    title.dataset.type = label;
    const list = document.createElement('ul');
    for (const item of items) {
      const row = document.createElement('li');
      row.textContent = item;
      list.appendChild(row);
    }
    group.append(title, list);
    return group;
  }

  function makeRelease(release, latest) {
    const article = document.createElement('article');
    article.className = `release-entry${latest ? ' is-current is-expanded' : ''}`;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'release-card-toggle';
    toggle.setAttribute('aria-expanded', latest ? 'true' : 'false');

    const rail = document.createElement('div');
    rail.className = 'release-rail';
    const version = document.createElement('strong');
    version.textContent = `v${release.version}`;
    const date = document.createElement('time');
    date.textContent = formatDate(release.releasedAt);
    if (release.releasedAt) date.dateTime = release.releasedAt;
    rail.append(version, date);
    if (latest) {
      const badge = document.createElement('span');
      badge.textContent = t('up.currentBadge');
      rail.appendChild(badge);
    }

    const content = document.createElement('div');
    content.className = 'release-heading';
    const title = document.createElement('h2');
    title.textContent = release.title;
    const summary = document.createElement('p');
    summary.textContent = release.summary || '';
    const chevron = document.createElement('span');
    chevron.className = 'release-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    toggle.append(rail, content, chevron);

    const details = document.createElement('div');
    details.className = 'release-details';
    const groups = document.createElement('div');
    groups.className = 'release-change-groups';
    for (const [label, items] of Object.entries(release.changes)) {
      groups.appendChild(makeChangeGroup(label, items));
    }
    content.append(title, summary);
    details.appendChild(groups);
    article.append(toggle, details);
    toggle.addEventListener('click', () => {
      const expand = !article.classList.contains('is-expanded');
      if (expand) {
        expandedSeen = false;
        expandedAt = performance.now();
        elements.list.querySelectorAll('.release-entry.is-expanded').forEach(entry => {
          if (entry === article) return;
          entry.classList.remove('is-expanded');
          entry.querySelector('.release-card-toggle').setAttribute('aria-expanded', 'false');
        });
      }
      article.classList.toggle('is-expanded', expand);
      toggle.setAttribute('aria-expanded', expand ? 'true' : 'false');
      updateLocatorState();
      if (expand) article.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return article;
  }

  async function load() {
    try {
      const response = await fetch('/api/update-log');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('up.loadFailed', { status: response.status }));
      elements.sidebarVersion.textContent = `v${data.currentVersion}`;
      elements.currentVersion.textContent = `v${data.currentVersion}`;
      elements.updatedAt.textContent = t('up.updatedAt', { date: formatDate(data.updatedAt) });
      elements.count.textContent = t('up.versionCount', { count: data.releases.length });
      elements.list.replaceChildren(...data.releases.map((release, index) => makeRelease(release, index === 0)));
      releaseEntries = [...elements.list.children];
      pointerOverList = false;
      pointerClientY = null;
      releaseMeta = data.releases.map(release => ({ version: release.version, title: release.title }));
      locatorStrip.replaceChildren(...data.releases.map((release, index) => {
        const line = document.createElement('button');
        line.type = 'button';
        line.className = 'release-locator-item';
        line.title = `v${release.version} ${release.title}`;
        line.setAttribute('aria-label', t('up.locateAria', { version: release.version, title: release.title }));
        line.addEventListener('click', () => {
          smoothScrollTo(releaseEntries[index].offsetTop - 8);
        });
        return line;
      }));
      locatorLines = [...locatorStrip.children];
      window.PageFX.stagger(elements.list.children, { step: 45, cap: 16 });
      elements.list.scrollTop = 0;
      updateLocatorState();
    } catch (error) {
      elements.list.replaceChildren();
      releaseEntries = [];
      releaseMeta = [];
      locatorStrip.replaceChildren();
      locatorLines = [];
      elements.top.classList.remove('is-visible');
      const message = document.createElement('div');
      message.className = 'release-loading error';
      message.textContent = error.message;
      elements.list.appendChild(message);
    }
  }

  elements.list.addEventListener('mouseenter', event => {
    pointerClientY = event.clientY;
    pointerOverList = true;
    updateLocatorState();
  });
  elements.list.addEventListener('mousemove', event => {
    pointerClientY = event.clientY;
    pointerOverList = true;
    updateLocatorState();
  });
  elements.list.addEventListener('mouseleave', () => {
    pointerOverList = false;
    updateLocatorState();
  });
  elements.list.addEventListener('scroll', () => updateLocatorState(), { passive: true });
  elements.top.addEventListener('click', () => smoothScrollTo(0));
  elements.locator.addEventListener('wheel', event => {
    event.preventDefault();
    elements.list.scrollTop += event.deltaY;
  }, { passive: false });

  document.querySelector('[data-page="updates"]').addEventListener('click', load);
  load();
})();
