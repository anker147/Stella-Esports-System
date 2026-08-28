(function () {
  const elements = {
    sidebarVersion: document.getElementById('systemVersion'),
    currentVersion: document.getElementById('releaseCurrentVersion'),
    updatedAt: document.getElementById('releaseUpdatedAt'),
    count: document.getElementById('releaseCount'),
    list: document.getElementById('releaseList')
  };

  function formatDate(value) {
    if (!value) return '历史版本';
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
      badge.textContent = '当前版本';
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
    details.hidden = !latest;
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
        elements.list.querySelectorAll('.release-entry.is-expanded').forEach(entry => {
          if (entry === article) return;
          entry.classList.remove('is-expanded');
          entry.querySelector('.release-card-toggle').setAttribute('aria-expanded', 'false');
          entry.querySelector('.release-details').hidden = true;
        });
      }
      article.classList.toggle('is-expanded', expand);
      toggle.setAttribute('aria-expanded', expand ? 'true' : 'false');
      details.hidden = !expand;
      if (expand) article.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return article;
  }

  async function load() {
    try {
      const response = await fetch('/api/update-log');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `更新日志读取失败 (${response.status})`);
      elements.sidebarVersion.textContent = `v${data.currentVersion}`;
      elements.currentVersion.textContent = `v${data.currentVersion}`;
      elements.updatedAt.textContent = `更新时间 ${formatDate(data.updatedAt)}`;
      elements.count.textContent = `${data.releases.length} 个版本`;
      elements.list.replaceChildren(...data.releases.map((release, index) => makeRelease(release, index === 0)));
    } catch (error) {
      elements.list.replaceChildren();
      const message = document.createElement('div');
      message.className = 'release-loading error';
      message.textContent = error.message;
      elements.list.appendChild(message);
    }
  }

  document.querySelector('[data-page="updates"]').addEventListener('click', load);
  load();
})();
