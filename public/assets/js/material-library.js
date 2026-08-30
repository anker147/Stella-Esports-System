(function () {
  const $ = id => document.getElementById(id);
  const elements = {
    page: $('materialsPage'), search: $('materialSearch'), summary: $('materialSummary'), status: $('materialStatus'),
    grid: $('materialGrid'), browser: $('materialBrowser'), empty: $('materialEmpty'), breadcrumbs: $('materialBreadcrumbs'),
    up: $('materialUp'), selectionRect: $('materialSelectionRect'), selectionBar: $('materialSelectionBar'),
    selectionCount: $('materialSelectionCount'), openSelected: $('openSelectedMaterial'), previewSelected: $('previewSelectedMaterial'),
    renameSelected: $('renameSelectedMaterial'), deleteSelected: $('deleteSelectedMaterials'),
    clearSelection: $('clearMaterialSelection'), importFiles: $('importMaterialFiles'),
    importFolder: $('importMaterialFolder'), createDocument: $('createMaterialDocument'), refresh: $('refreshMaterials'),
    confirmPaths: $('confirmMaterialPaths'), syncPaths: $('syncMaterialPaths'), rollbackPaths: $('rollbackMaterialPaths'),
    previewDialog: $('materialPreviewDialog'), previewTitle: $('materialPreviewTitle'), previewPath: $('materialPreviewPath'),
    previewStage: $('materialPreviewStage'), closePreview: $('closeMaterialPreview'),
    renameDialog: $('materialRenameDialog'), renamePath: $('materialRenamePath'), renameInput: $('materialRenameInput'),
    cancelRename: $('cancelMaterialRename'), confirmRename: $('confirmMaterialRename'),
    deleteDialog: $('materialDeleteDialog'), deleteTitle: $('materialDeleteTitle'), deleteText: $('materialDeleteText'),
    deleteWarning: $('materialDeleteWarning'), cancelDelete: $('cancelMaterialDelete'),
    removeIndex: $('removeMaterialIndex'), deleteFile: $('deleteMaterialFile'),
    documentDialog: $('materialDocumentDialog'), documentDirectory: $('materialDocumentDirectory'),
    documentName: $('materialDocumentName'), chooseDirectory: $('chooseMaterialDirectory'),
    cancelDocument: $('cancelMaterialDocument'), confirmDocument: $('confirmMaterialDocument'),
    pathDialog: $('materialPathDialog'), closePathDialog: $('closeMaterialPathDialog'), cancelPathDialog: $('cancelMaterialPathDialog'),
    canonicalRoot: $('materialCanonicalRoot'), selectedRoot: $('materialSelectedRoot'),
    pathFolderList: $('materialPathFolderList'), validatePaths: $('validateMaterialPaths'),
    pathReport: $('materialPathReport'), pathReportSummary: $('materialPathReportSummary'), pathMappings: $('materialPathMappings'),
    operationDialog: $('materialPathOperationDialog'), operationTitle: $('materialPathOperationTitle'),
    operationText: $('materialPathOperationText'), operationWarning: $('materialPathOperationWarning'),
    cancelOperation: $('cancelMaterialPathOperation'), confirmOperation: $('confirmMaterialPathOperation')
  };

  const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico', 'avif']);
  const videoExtensions = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v']);
  const audioExtensions = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
  let entries = [];
  let currentDirectoryId = null;
  let selectedIds = new Set();
  let selectionAnchorId = null;
  let renameTarget = null;
  let deleteTargetIds = [];
  let busy = false;
  let dragSelection = null;
  let lastEntriesSignature = '';
  let migrationStatus = null;
  let selectedPathFolderId = null;
  let pendingOperation = null;

  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
    return payload;
  }

  function post(url, body = {}) {
    return request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function setStatus(message, error = false) {
    elements.status.textContent = message;
    elements.status.classList.toggle('error', error);
  }

  function setBusy(next) {
    busy = next;
    elements.importFiles.disabled = next;
    elements.importFolder.disabled = next;
    elements.createDocument.disabled = next;
    elements.refresh.disabled = next;
    elements.confirmPaths.disabled = next;
    syncMigrationControls();
  }

  function syncMigrationControls() {
    const validation = migrationStatus?.lastValidation;
    elements.syncPaths.disabled = busy || !migrationStatus?.obsConnected || !validation?.valid;
    elements.rollbackPaths.disabled = busy || !migrationStatus?.rollback?.available;
    elements.syncPaths.title = !migrationStatus?.obsConnected
      ? 'OBS 尚未连接'
      : (validation?.valid ? `将 ${validation.referenceCount} 个路径字段同步至 OBS` : '请先完成文件路径校验');
    elements.rollbackPaths.title = migrationStatus?.rollback?.reason || '';
  }

  function makeFolderOption(folder) {
    const label = document.createElement('label');
    label.className = 'material-folder-option';
    label.title = folder.path;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'materialPathRoot';
    radio.value = folder.id;
    radio.checked = folder.id === selectedPathFolderId;
    const text = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = folder.name;
    const folderPath = document.createElement('span');
    folderPath.textContent = folder.path;
    text.append(name, folderPath);
    label.append(radio, text);
    radio.addEventListener('change', () => {
      selectedPathFolderId = folder.id;
      elements.selectedRoot.textContent = folder.path;
      elements.validatePaths.disabled = false;
      elements.pathReport.hidden = true;
    });
    return label;
  }

  function renderPathFolders() {
    const folders = migrationStatus?.folders || [];
    elements.canonicalRoot.textContent = migrationStatus?.canonicalRoot || '--';
    const selected = folders.find(folder => folder.id === selectedPathFolderId);
    elements.selectedRoot.textContent = selected?.path || '尚未选择';
    elements.validatePaths.disabled = !selected;
    if (!folders.length) {
      const empty = document.createElement('div');
      empty.className = 'material-folder-picker-empty';
      empty.textContent = '素材库中没有可用文件夹，请先导入完整素材包';
      elements.pathFolderList.replaceChildren(empty);
      return;
    }
    elements.pathFolderList.replaceChildren(...folders.map(makeFolderOption));
  }

  function renderPathReport(validation) {
    elements.pathReport.hidden = false;
    elements.pathReport.classList.toggle('is-error', !validation.valid);
    if (!validation.referenceCount) {
      elements.pathReportSummary.textContent = `OBS 中没有发现位于 ${validation.canonicalRoot} 下的素材路径`;
    } else if (validation.missingCount) {
      elements.pathReportSummary.textContent = `校验未通过：${validation.referenceCount} 个路径字段中有 ${validation.missingCount} 个目标文件缺失`;
    } else {
      elements.pathReportSummary.textContent = `校验通过：${validation.objectCount} 个 OBS 对象，共 ${validation.referenceCount} 个路径字段`;
    }
    const ordered = [...validation.records].sort((left, right) => Number(left.exists) - Number(right.exists));
    const rows = ordered.slice(0, 200).map(record => {
      const row = document.createElement('div');
      row.className = `material-path-mapping${record.exists ? '' : ' is-missing'}`;
      const title = document.createElement('strong');
      title.textContent = `${record.sourceName}${record.filterName ? ` / ${record.filterName}` : ''} · ${record.settingPath}`;
      const mapping = document.createElement('span');
      mapping.textContent = `${record.before}  →  ${record.after}${record.exists ? '' : '（缺失）'}`;
      row.append(title, mapping);
      return row;
    });
    if (ordered.length > 200) {
      const more = document.createElement('div');
      more.className = 'material-path-mapping';
      more.textContent = `另有 ${ordered.length - 200} 条映射未在预览中展开`;
      rows.push(more);
    }
    elements.pathMappings.replaceChildren(...rows);
  }

  async function loadMigrationStatus({ quiet = false } = {}) {
    try {
      migrationStatus = await request('/api/material-paths/status');
      selectedPathFolderId = migrationStatus.selectedFolderId || selectedPathFolderId;
      syncMigrationControls();
      return migrationStatus;
    } catch (error) {
      elements.syncPaths.disabled = true;
      elements.rollbackPaths.disabled = true;
      if (!quiet) setStatus(error.message, true);
      return null;
    }
  }

  async function openPathDialog() {
    if (!await loadMigrationStatus()) return;
    selectedPathFolderId = migrationStatus.selectedFolderId;
    renderPathFolders();
    if (migrationStatus.lastValidation) renderPathReport(migrationStatus.lastValidation);
    else elements.pathReport.hidden = true;
    elements.pathDialog.showModal();
  }

  async function validatePaths() {
    if (!selectedPathFolderId || busy) return;
    setBusy(true);
    elements.validatePaths.disabled = true;
    elements.validatePaths.textContent = '正在读取 OBS...';
    try {
      const validation = await post('/api/material-paths/validate', { folderId: selectedPathFolderId });
      migrationStatus.lastValidation = validation;
      migrationStatus.selectedFolderId = selectedPathFolderId;
      renderPathReport(validation);
      syncMigrationControls();
      setStatus(validation.valid ? '素材路径校验通过，OBS 同步已可用' : `路径校验未通过，缺少 ${validation.missingCount} 个文件`, !validation.valid);
    } catch (error) {
      migrationStatus.lastValidation = null;
      syncMigrationControls();
      setStatus(error.message, true);
    } finally {
      setBusy(false);
      elements.validatePaths.disabled = false;
      elements.validatePaths.textContent = '重新校验文件路径';
      syncMigrationControls();
    }
  }

  function askOperation({ title, text, warning, confirmText }) {
    if (pendingOperation) pendingOperation(false);
    elements.operationTitle.textContent = title;
    elements.operationText.textContent = text;
    elements.operationWarning.textContent = warning;
    elements.confirmOperation.textContent = confirmText;
    elements.operationDialog.showModal();
    return new Promise(resolve => { pendingOperation = resolve; });
  }

  function finishOperation(confirmed) {
    const resolve = pendingOperation;
    pendingOperation = null;
    if (elements.operationDialog.open) elements.operationDialog.close();
    resolve?.(confirmed);
  }

  async function syncPathsToObs() {
    const validation = migrationStatus?.lastValidation;
    if (!validation?.valid || busy) return;
    const confirmed = await askOperation({
      title: '同步 OBS 素材路径',
      text: `将 ${validation.objectCount} 个 OBS 对象中的 ${validation.referenceCount} 个路径字段改为所选素材包。`,
      warning: '同步前会再次校验全部文件。发生写入或回读错误时，本次已修改内容会自动恢复。',
      confirmText: '确认同步'
    });
    if (!confirmed) return;
    setBusy(true);
    syncMigrationControls();
    setStatus('正在同步并回读校验 OBS 素材路径...');
    try {
      const result = await post('/api/material-paths/sync', { folderId: validation.folderId });
      await loadMigrationStatus({ quiet: true });
      setStatus(`OBS 路径同步完成，共修改 ${result.changedCount} 个字段`);
    } catch (error) {
      await loadMigrationStatus({ quiet: true });
      setStatus(error.message, true);
    } finally {
      setBusy(false);
      syncMigrationControls();
    }
  }

  async function rollbackObsPaths() {
    if (!migrationStatus?.rollback?.available || busy) return;
    const confirmed = await askOperation({
      title: '撤销上次 OBS 同步',
      text: `将上次同步修改的 ${migrationStatus.rollback.changedCount} 个路径字段恢复为同步前的值。`,
      warning: '系统会先确认这些字段没有被其他操作改动，并检查原素材仍然存在。撤销也会进行写入后回读校验。',
      confirmText: '确认撤销'
    });
    if (!confirmed) return;
    setBusy(true);
    syncMigrationControls();
    setStatus('正在撤销上次 OBS 路径同步...');
    try {
      const result = await post('/api/material-paths/rollback');
      await loadMigrationStatus({ quiet: true });
      setStatus(`已恢复 ${result.changedCount} 个 OBS 路径字段`);
    } catch (error) {
      await loadMigrationStatus({ quiet: true });
      setStatus(error.message, true);
    } finally {
      setBusy(false);
      syncMigrationControls();
    }
  }

  function normalizePath(value) {
    const normalized = String(value || '').replace(/\//g, '\\');
    return normalized.length > 3 ? normalized.replace(/\\+$/, '') : normalized;
  }

  function pathKey(value) {
    return normalizePath(value).toLocaleLowerCase('en-US');
  }

  function parentPath(value) {
    const normalized = normalizePath(value);
    if (/^[a-z]:\\$/i.test(normalized)) return '';
    const index = normalized.lastIndexOf('\\');
    if (index < 0) return '';
    if (index === 2 && normalized[1] === ':') return normalized.slice(0, 3);
    return normalized.slice(0, index);
  }

  function entryMap() {
    return new Map(entries.map(entry => [pathKey(entry.path), entry]));
  }

  function currentDirectory() {
    return entries.find(entry => entry.id === currentDirectoryId && entry.kind === 'directory') || null;
  }

  function sortEntries(items) {
    return [...items].sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
      return left.name.localeCompare(right.name, 'zh-CN', { numeric: true });
    });
  }

  function visibleEntries() {
    const query = elements.search.value.trim().toLocaleLowerCase();
    if (query) {
      return sortEntries(entries.filter(entry => (
        `${entry.name} ${entry.extension} ${entry.path}`.toLocaleLowerCase().includes(query)
      )));
    }
    const map = entryMap();
    const directory = currentDirectory();
    if (directory) {
      const directoryKey = pathKey(directory.path);
      return sortEntries(entries.filter(entry => entry.id !== directory.id && pathKey(parentPath(entry.path)) === directoryKey));
    }
    return sortEntries(entries.filter(entry => !map.has(pathKey(parentPath(entry.path)))));
  }

  function formatSize(size) {
    if (!Number.isFinite(size)) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
    return `${(size / 1024 ** 3).toFixed(2)} GB`;
  }

  function isImage(entry) {
    return entry.kind === 'file' && imageExtensions.has(entry.extension);
  }

  function isVideo(entry) {
    return entry.kind === 'file' && videoExtensions.has(entry.extension);
  }

  function isAudio(entry) {
    return entry.kind === 'file' && audioExtensions.has(entry.extension);
  }

  function isPreviewable(entry) {
    return isImage(entry) || isVideo(entry) || isAudio(entry);
  }

  function contentUrl(entry) {
    return `/api/materials/${encodeURIComponent(entry.id)}/content?t=${entry.modifiedAt || 0}`;
  }

  function immediateChildCount(directory) {
    const key = pathKey(directory.path);
    return entries.filter(entry => entry.id !== directory.id && pathKey(parentPath(entry.path)) === key).length;
  }

  function makeThumbnail(entry) {
    const thumb = document.createElement('div');
    thumb.className = 'material-thumbnail';
    if (!entry.exists) {
      thumb.classList.add('is-missing');
      thumb.textContent = '!';
      return thumb;
    }
    if (entry.kind === 'directory') {
      const folder = document.createElement('span');
      folder.className = 'material-folder-glyph';
      thumb.appendChild(folder);
      return thumb;
    }
    if (isImage(entry)) {
      const image = document.createElement('img');
      image.src = contentUrl(entry);
      image.alt = '';
      image.loading = 'lazy';
      image.draggable = false;
      thumb.appendChild(image);
      return thumb;
    }
    if (isVideo(entry)) {
      const video = document.createElement('video');
      video.src = `${contentUrl(entry)}#t=0.1`;
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.addEventListener('loadeddata', () => video.pause(), { once: true });
      thumb.appendChild(video);
      const badge = document.createElement('span');
      badge.className = 'material-media-badge';
      badge.textContent = 'VIDEO';
      thumb.appendChild(badge);
      return thumb;
    }
    const mark = document.createElement('span');
    mark.className = isAudio(entry) ? 'material-audio-glyph' : 'material-file-glyph';
    mark.textContent = isAudio(entry) ? '\u266b' : (entry.extension || 'FILE').slice(0, 5).toLocaleUpperCase();
    thumb.appendChild(mark);
    return thumb;
  }

  function makeCard(entry) {
    const card = document.createElement('div');
    card.className = 'material-card';
    card.dataset.id = entry.id;
    card.setAttribute('role', 'gridcell');
    card.setAttribute('aria-selected', selectedIds.has(entry.id) ? 'true' : 'false');
    card.title = entry.path;
    if (selectedIds.has(entry.id)) card.classList.add('is-selected');
    if (!entry.exists) card.classList.add('material-missing');

    const thumb = makeThumbnail(entry);
    const name = document.createElement('strong');
    name.className = 'material-card-name';
    name.textContent = entry.name;
    const meta = document.createElement('span');
    meta.className = 'material-card-meta';
    meta.textContent = entry.kind === 'directory'
      ? `${immediateChildCount(entry)} 项`
      : [entry.extension?.toLocaleUpperCase(), formatSize(entry.size)].filter(Boolean).join(' · ');
    card.append(thumb, name, meta);

    card.addEventListener('click', event => selectFromClick(entry, event));
    card.addEventListener('dblclick', () => openEntry(entry));
    card.addEventListener('contextmenu', event => {
      event.preventDefault();
      if (!selectedIds.has(entry.id)) {
        selectedIds = new Set([entry.id]);
        selectionAnchorId = entry.id;
        syncSelection();
      }
    });
    return card;
  }

  function renderBreadcrumbs() {
    const root = document.createElement('button');
    root.type = 'button';
    root.textContent = '素材库';
    root.addEventListener('click', () => navigateTo(null));
    const crumbs = [root];
    const map = entryMap();
    let cursor = currentDirectory();
    const chain = [];
    while (cursor) {
      chain.unshift(cursor);
      cursor = map.get(pathKey(parentPath(cursor.path)));
    }
    for (const entry of chain) {
      const separator = document.createElement('span');
      separator.textContent = '/';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = entry.name;
      button.title = entry.path;
      button.addEventListener('click', () => navigateTo(entry.id));
      crumbs.push(separator, button);
    }
    elements.breadcrumbs.replaceChildren(...crumbs);
    elements.up.disabled = !currentDirectory();
  }

  function render() {
    if (currentDirectoryId && !currentDirectory()) currentDirectoryId = null;
    selectedIds = new Set([...selectedIds].filter(id => entries.some(entry => entry.id === id)));
    const visible = visibleEntries();
    const files = entries.filter(entry => entry.kind === 'file').length;
    const directories = entries.length - files;
    const searching = Boolean(elements.search.value.trim());
    const locationText = searching ? `搜索到 ${visible.length} 项` : `当前目录 ${visible.length} 项`;
    elements.summary.textContent = `${locationText} · 索引共 ${files} 个文件、${directories} 个文件夹`;
    elements.empty.textContent = entries.length === 0 ? '素材库为空' : (searching ? '没有匹配的素材' : '此文件夹为空');
    elements.empty.hidden = visible.length > 0;
    elements.grid.replaceChildren(...visible.map(makeCard));
    window.PageFX.stagger(elements.grid.children, { step: 30, cap: 12 });
    renderBreadcrumbs();
    syncSelection();
  }

  function syncSelection() {
    document.querySelectorAll('.material-card').forEach(card => {
      const selected = selectedIds.has(card.dataset.id);
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    const selected = entries.filter(entry => selectedIds.has(entry.id));
    elements.selectionBar.classList.toggle('is-visible', selected.length > 0);
    elements.selectionCount.textContent = `已选择 ${selected.length} 项`;
    elements.openSelected.disabled = selected.length !== 1 || !selected[0].exists;
    elements.previewSelected.disabled = selected.length !== 1 || !isPreviewable(selected[0]) || !selected[0].exists;
    elements.renameSelected.disabled = selected.length !== 1 || !selected[0].exists;
    elements.deleteSelected.disabled = selected.length === 0;
  }

  function clearSelection() {
    selectedIds.clear();
    selectionAnchorId = null;
    syncSelection();
  }

  function selectFromClick(entry, event) {
    const visible = visibleEntries();
    const additive = event.ctrlKey || event.metaKey;
    if (event.shiftKey && selectionAnchorId) {
      const anchorIndex = visible.findIndex(item => item.id === selectionAnchorId);
      const targetIndex = visible.findIndex(item => item.id === entry.id);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        if (!additive) selectedIds.clear();
        const [start, end] = [anchorIndex, targetIndex].sort((a, b) => a - b);
        visible.slice(start, end + 1).forEach(item => selectedIds.add(item.id));
      }
    } else if (additive) {
      if (selectedIds.has(entry.id)) selectedIds.delete(entry.id);
      else selectedIds.add(entry.id);
      selectionAnchorId = entry.id;
    } else {
      selectedIds = new Set([entry.id]);
      selectionAnchorId = entry.id;
    }
    syncSelection();
  }

  function navigateTo(id) {
    currentDirectoryId = id;
    elements.search.value = '';
    clearSelection();
    render();
  }

  function navigateUp() {
    const directory = currentDirectory();
    if (!directory) return;
    const parent = entryMap().get(pathKey(parentPath(directory.path)));
    navigateTo(parent?.kind === 'directory' ? parent.id : null);
  }

  function openEntry(entry) {
    if (entry.kind === 'directory') navigateTo(entry.id);
    else if (isPreviewable(entry) && entry.exists) preview(entry);
    else if (entry.exists) openInSystem(entry);
  }

  function entriesSignature(items) {
    return items.map(entry => `${entry.id}|${entry.path}|${entry.kind}|${entry.exists}|${entry.size}|${entry.modifiedAt}`).join('\n');
  }

  async function load(message = '', { quiet = false, forceSync = false } = {}) {
    try {
      const payload = await request(forceSync ? '/api/materials?sync=1' : '/api/materials');
      const signature = entriesSignature(payload.entries);
      entries = payload.entries;
      if (signature !== lastEntriesSignature) {
        lastEntriesSignature = signature;
        render();
      }
      if (message) setStatus(message);
    } catch (error) {
      if (!quiet) setStatus(error.message, true);
    }
  }

  async function openInSystem(entry) {
    try {
      setStatus(`正在使用系统程序打开：${entry.name}`);
      await post(`/api/materials/${encodeURIComponent(entry.id)}/open`);
      setStatus(`已交给系统程序打开：${entry.name}`);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function importItems(kind) {
    if (busy) return;
    setBusy(true);
    setStatus(kind === 'folder' ? '等待选择文件夹...' : '等待选择文件...');
    try {
      const payload = await post('/api/materials/import', { kind });
      entries = payload.entries;
      render();
      setStatus(payload.cancelled ? '已取消选择' : `已加入 ${payload.added} 项，跳过 ${payload.skipped} 个重复索引`);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  function preview(entry) {
    elements.previewTitle.textContent = entry.name;
    elements.previewPath.textContent = entry.path;
    elements.previewPath.title = entry.path;
    let media;
    if (isImage(entry)) {
      media = document.createElement('img');
      media.alt = entry.name;
    } else if (isVideo(entry)) {
      media = document.createElement('video');
      media.controls = true;
      media.autoplay = true;
    } else {
      media = document.createElement('audio');
      media.controls = true;
      media.autoplay = true;
    }
    media.src = contentUrl(entry);
    elements.previewStage.replaceChildren(media);
    elements.previewDialog.showModal();
  }

  function closePreview() {
    elements.previewStage.querySelectorAll('video, audio').forEach(media => media.pause());
    elements.previewStage.replaceChildren();
    elements.previewDialog.close();
  }

  function openRename(entry) {
    renameTarget = entry;
    elements.renamePath.textContent = entry.path;
    elements.renamePath.title = entry.path;
    elements.renameInput.value = entry.name;
    elements.renameDialog.showModal();
    elements.renameInput.focus();
    elements.renameInput.select();
  }

  function openDelete() {
    const selected = entries.filter(entry => selectedIds.has(entry.id));
    if (!selected.length) return;
    deleteTargetIds = selected.map(entry => entry.id);
    const folders = selected.filter(entry => entry.kind === 'directory').length;
    elements.deleteTitle.textContent = selected.length === 1 ? '删除素材' : `删除 ${selected.length} 项素材`;
    elements.deleteText.textContent = selected.length === 1 ? `“${selected[0].name}”` : `已选择 ${selected.length} 项，其中 ${folders} 个文件夹`;
    elements.deleteWarning.textContent = folders
      ? '从文件系统删除会递归删除所选文件夹及其全部内容，且不可撤销。仅移除索引不会改动任何源文件。'
      : '从文件系统删除会永久删除所选源文件，且不可撤销。仅移除索引不会改动任何源文件。';
    elements.deleteDialog.showModal();
  }

  async function remove(mode) {
    if (!deleteTargetIds.length) return;
    try {
      const payload = await post('/api/materials/bulk-delete', { ids: deleteTargetIds, mode });
      entries = payload.entries;
      elements.deleteDialog.close();
      deleteTargetIds = [];
      selectedIds.clear();
      render();
      setStatus(mode === 'index'
        ? `已移除 ${payload.removed} 条索引，源文件未删除`
        : `已从文件系统删除，并移除 ${payload.removed} 条索引`);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function selectedSingle() {
    if (selectedIds.size !== 1) return null;
    return entries.find(entry => selectedIds.has(entry.id)) || null;
  }

  function rectangleFromPoints(startX, startY, endX, endY) {
    return {
      left: Math.min(startX, endX), top: Math.min(startY, endY),
      right: Math.max(startX, endX), bottom: Math.max(startY, endY)
    };
  }

  function updateDragSelection(event) {
    if (!dragSelection) return;
    const dx = event.clientX - dragSelection.startClientX;
    const dy = event.clientY - dragSelection.startClientY;
    if (!dragSelection.moved && Math.hypot(dx, dy) < 4) return;
    dragSelection.moved = true;
    const browserRect = elements.browser.getBoundingClientRect();
    const currentX = event.clientX - browserRect.left + elements.browser.scrollLeft;
    const currentY = event.clientY - browserRect.top + elements.browser.scrollTop;
    const box = rectangleFromPoints(dragSelection.startX, dragSelection.startY, currentX, currentY);
    Object.assign(elements.selectionRect.style, {
      left: `${box.left}px`, top: `${box.top}px`,
      width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px`
    });
    elements.selectionRect.hidden = false;
    selectedIds = new Set(dragSelection.baseSelection);
    document.querySelectorAll('.material-card').forEach(card => {
      const rect = card.getBoundingClientRect();
      const cardBox = {
        left: rect.left - browserRect.left + elements.browser.scrollLeft,
        right: rect.right - browserRect.left + elements.browser.scrollLeft,
        top: rect.top - browserRect.top + elements.browser.scrollTop,
        bottom: rect.bottom - browserRect.top + elements.browser.scrollTop
      };
      if (box.left <= cardBox.right && box.right >= cardBox.left && box.top <= cardBox.bottom && box.bottom >= cardBox.top) {
        selectedIds.add(card.dataset.id);
      }
    });
    syncSelection();
  }

  elements.browser.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.material-card')) return;
    const rect = elements.browser.getBoundingClientRect();
    dragSelection = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: event.clientX - rect.left + elements.browser.scrollLeft,
      startY: event.clientY - rect.top + elements.browser.scrollTop,
      baseSelection: (event.ctrlKey || event.metaKey) ? new Set(selectedIds) : new Set(),
      moved: false
    };
    elements.browser.setPointerCapture(event.pointerId);
  });
  elements.browser.addEventListener('pointermove', updateDragSelection);
  elements.browser.addEventListener('pointerup', event => {
    if (!dragSelection || dragSelection.pointerId !== event.pointerId) return;
    if (!dragSelection.moved && !(event.ctrlKey || event.metaKey)) clearSelection();
    elements.selectionRect.hidden = true;
    dragSelection = null;
  });
  elements.browser.addEventListener('pointercancel', () => {
    elements.selectionRect.hidden = true;
    dragSelection = null;
  });

  elements.grid.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'a') {
      event.preventDefault();
      visibleEntries().forEach(entry => selectedIds.add(entry.id));
      syncSelection();
    } else if (event.key === 'Delete') {
      event.preventDefault();
      openDelete();
    } else if (event.key === 'Escape') {
      clearSelection();
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      navigateUp();
    } else if (event.key === 'Enter') {
      const entry = selectedSingle();
      if (entry) openEntry(entry);
    }
  });

  elements.search.addEventListener('input', () => {
    clearSelection();
    render();
  });
  elements.up.addEventListener('click', navigateUp);
  elements.refresh.addEventListener('click', () => load('素材库已刷新', { forceSync: true }));
  elements.importFiles.addEventListener('click', () => importItems('files'));
  elements.importFolder.addEventListener('click', () => importItems('folder'));
  elements.openSelected.addEventListener('click', () => {
    const entry = selectedSingle();
    if (entry) openInSystem(entry);
  });
  elements.previewSelected.addEventListener('click', () => {
    const entry = selectedSingle();
    if (entry) preview(entry);
  });
  elements.renameSelected.addEventListener('click', () => {
    const entry = selectedSingle();
    if (entry) openRename(entry);
  });
  elements.deleteSelected.addEventListener('click', openDelete);
  elements.clearSelection.addEventListener('click', clearSelection);
  elements.closePreview.addEventListener('click', closePreview);
  elements.previewDialog.addEventListener('close', () => elements.previewStage.replaceChildren());
  elements.cancelRename.addEventListener('click', () => elements.renameDialog.close());
  elements.confirmRename.addEventListener('click', async () => {
    if (!renameTarget) return;
    try {
      const payload = await post(`/api/materials/${encodeURIComponent(renameTarget.id)}/rename`, { name: elements.renameInput.value });
      entries = payload.entries;
      elements.renameDialog.close();
      selectedIds = new Set([payload.entry.id]);
      render();
      setStatus(`已重命名为 ${payload.entry.name}`);
      renameTarget = null;
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  elements.renameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') elements.confirmRename.click();
  });
  elements.cancelDelete.addEventListener('click', () => elements.deleteDialog.close());
  elements.removeIndex.addEventListener('click', () => remove('index'));
  elements.deleteFile.addEventListener('click', () => remove('filesystem'));
  elements.createDocument.addEventListener('click', () => {
    const directory = currentDirectory();
    elements.documentDirectory.value = directory?.path || localStorage.getItem('zfb.materialDirectory') || '';
    elements.documentName.value = '新建文档.txt';
    elements.documentDialog.showModal();
  });
  elements.chooseDirectory.addEventListener('click', async () => {
    try {
      const payload = await post('/api/materials/select-folder');
      if (payload.path) {
        elements.documentDirectory.value = payload.path;
        localStorage.setItem('zfb.materialDirectory', payload.path);
      }
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  elements.cancelDocument.addEventListener('click', () => elements.documentDialog.close());
  elements.confirmDocument.addEventListener('click', async () => {
    try {
      const payload = await post('/api/materials/documents', {
        directoryPath: elements.documentDirectory.value,
        name: elements.documentName.value
      });
      entries = payload.entries;
      elements.documentDialog.close();
      selectedIds = new Set([payload.entry.id]);
      render();
      setStatus(`已创建并加入索引：${payload.entry.name}`);
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  elements.documentName.addEventListener('keydown', event => {
    if (event.key === 'Enter') elements.confirmDocument.click();
  });
  elements.confirmPaths.addEventListener('click', openPathDialog);
  elements.syncPaths.addEventListener('click', syncPathsToObs);
  elements.rollbackPaths.addEventListener('click', rollbackObsPaths);
  elements.closePathDialog.addEventListener('click', () => elements.pathDialog.close());
  elements.cancelPathDialog.addEventListener('click', () => elements.pathDialog.close());
  elements.validatePaths.addEventListener('click', validatePaths);
  elements.cancelOperation.addEventListener('click', () => finishOperation(false));
  elements.confirmOperation.addEventListener('click', () => finishOperation(true));
  elements.operationDialog.addEventListener('cancel', event => {
    event.preventDefault();
    finishOperation(false);
  });
  document.querySelector('[data-page="materials"]').addEventListener('click', () => {
    load();
    loadMigrationStatus({ quiet: true });
  });

  window.setInterval(() => {
    if (document.visibilityState !== 'visible' || elements.page.hidden || busy) return;
    if (document.querySelector('dialog[open]')) return;
    load('', { quiet: true });
  }, 4000);

  load();
  loadMigrationStatus({ quiet: true });
})();
