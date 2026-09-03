(function () {
  const $ = id => document.getElementById(id);
  const elements = {
    page: $('materialsPage'), search: $('materialSearch'), summary: $('materialSummary'), status: $('materialStatus'),
    grid: $('materialGrid'), browser: $('materialBrowser'), empty: $('materialEmpty'), breadcrumbs: $('materialBreadcrumbs'),
    loadSentinel: $('materialLoadSentinel'),
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
  let currentDirectoryEntry = null;
  let breadcrumbs = [];
  let totalEntries = 0;
  let totalFiles = 0;
  let totalFolders = 0;
  let hasMoreEntries = false;
  let materialLoading = false;
  let materialInitialized = false;
  let searchTimer = null;
  let loadGeneration = 0;
  let materialLoadController = null;
  let selectedIds = new Set();
  let selectionAnchorId = null;
  let renameTarget = null;
  let deleteTargetIds = [];
  let busy = false;
  let dragSelection = null;
  let migrationStatus = null;
  let selectedPathFolderId = null;
  let pendingOperation = null;

  async function request(url, options) {
    return window.StellaDataCache.json(url, options);
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
      ? t('mt.obsNotConnected')
      : (validation?.valid ? t('mt.syncWillUpdate', { count: validation.referenceCount }) : t('mt.validateFirst'));
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
    elements.selectedRoot.textContent = selected?.path || t('mt.noRootSelected');
    elements.validatePaths.disabled = !selected;
    if (!folders.length) {
      const empty = document.createElement('div');
      empty.className = 'material-folder-picker-empty';
      empty.textContent = t('mt.noFolders');
      elements.pathFolderList.replaceChildren(empty);
      return;
    }
    elements.pathFolderList.replaceChildren(...folders.map(makeFolderOption));
  }

  function renderPathReport(validation) {
    elements.pathReport.hidden = false;
    elements.pathReport.classList.toggle('is-error', !validation.valid);
    if (!validation.referenceCount) {
      elements.pathReportSummary.textContent = t('mt.pathNoneFound', { root: validation.canonicalRoot });
    } else if (validation.missingCount) {
      elements.pathReportSummary.textContent = t('mt.pathInvalid', { total: validation.referenceCount, missing: validation.missingCount });
    } else {
      elements.pathReportSummary.textContent = t('mt.pathValid', { objects: validation.objectCount, total: validation.referenceCount });
    }
    const ordered = [...validation.records].sort((left, right) => Number(left.exists) - Number(right.exists));
    const rows = ordered.slice(0, 200).map(record => {
      const row = document.createElement('div');
      row.className = `material-path-mapping${record.exists ? '' : ' is-missing'}`;
      const title = document.createElement('strong');
      title.textContent = `${record.sourceName}${record.filterName ? ` / ${record.filterName}` : ''} · ${record.settingPath}`;
      const mapping = document.createElement('span');
      mapping.textContent = t('mt.mappingLine', { before: record.before, after: record.after }) + (record.exists ? '' : t('mt.mappingMissing'));
      row.append(title, mapping);
      return row;
    });
    if (ordered.length > 200) {
      const more = document.createElement('div');
      more.className = 'material-path-mapping';
      more.textContent = t('mt.mappingMore', { count: ordered.length - 200 });
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
    elements.validatePaths.textContent = t('mt.readingObs');
    try {
      const validation = await post('/api/material-paths/validate', { folderId: selectedPathFolderId });
      migrationStatus.lastValidation = validation;
      migrationStatus.selectedFolderId = selectedPathFolderId;
      renderPathReport(validation);
      syncMigrationControls();
      setStatus(validation.valid ? t('mt.validateOk') : t('mt.validateFail', { count: validation.missingCount }), !validation.valid);
    } catch (error) {
      migrationStatus.lastValidation = null;
      syncMigrationControls();
      setStatus(error.message, true);
    } finally {
      setBusy(false);
      elements.validatePaths.disabled = false;
      elements.validatePaths.textContent = t('mt.revalidate');
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
      title: t('mt.syncConfirmTitle'),
      text: t('mt.syncConfirmText', { objects: validation.objectCount, total: validation.referenceCount }),
      warning: t('mt.syncConfirmWarning'),
      confirmText: t('mt.syncConfirmOk')
    });
    if (!confirmed) return;
    setBusy(true);
    syncMigrationControls();
    setStatus(t('mt.syncing'));
    try {
      const result = await post('/api/material-paths/sync', { folderId: validation.folderId });
      await loadMigrationStatus({ quiet: true });
      setStatus(t('mt.syncDone', { count: result.changedCount }));
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
      title: t('mt.rollbackConfirmTitle'),
      text: t('mt.rollbackConfirmText', { count: migrationStatus.rollback.changedCount }),
      warning: t('mt.rollbackConfirmWarning'),
      confirmText: t('mt.rollbackConfirmOk')
    });
    if (!confirmed) return;
    setBusy(true);
    syncMigrationControls();
    setStatus(t('mt.rollbacking'));
    try {
      const result = await post('/api/material-paths/rollback');
      await loadMigrationStatus({ quiet: true });
      setStatus(t('mt.rollbackDone', { count: result.changedCount }));
    } catch (error) {
      await loadMigrationStatus({ quiet: true });
      setStatus(error.message, true);
    } finally {
      setBusy(false);
      syncMigrationControls();
    }
  }

  function currentDirectory() {
    return currentDirectoryEntry;
  }

  function visibleEntries() {
    return entries;
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
    return directory.childCount || 0;
  }

  // 内置 iconfont 风格线性图标（离线可用）；换图标只需改这里的 path
  const GLYPH_ICONS = {
    folder: '<path d="M5 10a3 3 0 0 1 3-3h10l4.5 5H40a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V10z"/>',
    audio: '<path d="M17 33V12l20-5v22"/><circle cx="12" cy="33" r="5"/><circle cx="32" cy="29" r="5"/>',
    file: '<path d="M11 5h16l10 10v26a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M27 5v10h10"/>'
  };

  function makeGlyph(kind, label = '') {
    const glyph = document.createElement('span');
    glyph.className = `material-glyph is-${kind}`;
    glyph.innerHTML = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH_ICONS[kind]}</svg>`;
    if (label) {
      const text = document.createElement('span');
      text.className = 'material-glyph-label';
      text.textContent = label;
      glyph.appendChild(text);
    }
    return glyph;
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
      thumb.appendChild(makeGlyph('folder'));
      return thumb;
    }
    if (isImage(entry)) {
      const image = document.createElement('img');
      image.src = contentUrl(entry);
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
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
      badge.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor"/></svg>';
      thumb.appendChild(badge);
      return thumb;
    }
    const mark = makeGlyph(
      isAudio(entry) ? 'audio' : 'file',
      isAudio(entry) ? '' : (entry.extension || 'FILE').slice(0, 5).toLocaleUpperCase()
    );
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
      ? t('mt.itemCount', { count: immediateChildCount(entry) })
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
    root.textContent = t('mt.rootName');
    root.addEventListener('click', () => navigateTo(null));
    const crumbs = [root];
    for (const entry of breadcrumbs) {
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
    selectedIds = new Set([...selectedIds].filter(id => entries.some(entry => entry.id === id)));
    const visible = visibleEntries();
    const searching = Boolean(elements.search.value.trim());
    const locationText = searching ? t('mt.searchedCount', { count: totalEntries }) : t('mt.currentDirCount', { count: totalEntries });
    elements.summary.textContent = t('mt.summaryLine', { location: locationText, files: totalFiles, folders: totalFolders });
    elements.empty.textContent = !totalEntries && !currentDirectory() && !searching ? t('mt.empty') : (searching ? t('mt.noMatch') : t('mt.folderEmpty'));
    elements.empty.hidden = visible.length > 0;
    elements.grid.replaceChildren(...visible.map(makeCard));
    elements.loadSentinel.hidden = !hasMoreEntries;
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
    elements.selectionCount.textContent = t('mt.selectedCount', { count: selected.length });
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

  async function navigateTo(id) {
    currentDirectoryId = id;
    elements.search.value = '';
    clearSelection();
    await load('', { reset: true });
  }

  function navigateUp() {
    if (!currentDirectory()) return;
    navigateTo(breadcrumbs.at(-2)?.id || null);
  }

  function openEntry(entry) {
    if (entry.kind === 'directory') navigateTo(entry.id);
    else if (isPreviewable(entry) && entry.exists) preview(entry);
    else if (entry.exists) openInSystem(entry);
  }

  async function load(message = '', { quiet = false, forceSync = false, reset = true } = {}) {
    if (!reset && materialLoading) return;
    const generation = reset ? ++loadGeneration : loadGeneration;
    if (reset) materialLoadController?.abort();
    const controller = new AbortController();
    materialLoadController = controller;
    materialLoading = true;
    try {
      const params = new URLSearchParams({
        offset: reset ? '0' : String(entries.length),
        limit: '80'
      });
      if (currentDirectoryId) params.set('directory', currentDirectoryId);
      const query = elements.search.value.trim();
      if (query) params.set('q', query);
      if (forceSync) params.set('sync', '1');
      const payload = await request(`/api/materials?${params}`, { signal: controller.signal });
      if (generation !== loadGeneration) return;
      entries = reset ? payload.entries : [...entries, ...payload.entries];
      currentDirectoryEntry = payload.directory;
      breadcrumbs = payload.breadcrumbs;
      totalEntries = payload.total;
      totalFiles = payload.fileTotal;
      totalFolders = payload.folderTotal;
      hasMoreEntries = payload.hasMore;
      materialInitialized = true;
      render();
      if (message) setStatus(message);
    } catch (error) {
      if (error.name !== 'AbortError' && !quiet) setStatus(error.message, true);
    } finally {
      if (generation === loadGeneration) {
        materialLoading = false;
        if (materialLoadController === controller) materialLoadController = null;
      }
    }
  }

  async function openInSystem(entry) {
    try {
      setStatus(t('mt.openingWith', { name: entry.name }));
      await post(`/api/materials/${encodeURIComponent(entry.id)}/open`);
      setStatus(t('mt.openedWith', { name: entry.name }));
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function importItems(kind) {
    if (busy) return;
    setBusy(true);
    setStatus(t(kind === 'folder' ? 'mt.waitingFolder' : 'mt.waitingFile'));
    try {
      const payload = await post('/api/materials/import', { kind });
      if (!payload.cancelled) await load('', { reset: true });
      setStatus(payload.cancelled ? t('mt.pickCancelled') : t('mt.imported', { added: payload.added, skipped: payload.skipped }));
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
    elements.deleteTitle.textContent = selected.length === 1 ? t('mt.deleteTitle') : t('mt.deleteTitleN', { count: selected.length });
    elements.deleteText.textContent = selected.length === 1 ? t('mt.deleteTextOne', { name: selected[0].name }) : t('mt.deleteTextN', { count: selected.length, folders });
    elements.deleteWarning.textContent = folders
      ? t('mt.deleteFolderWarning')
      : t('mt.deleteFileWarning');
    elements.deleteDialog.showModal();
  }

  async function remove(mode) {
    if (!deleteTargetIds.length) return;
    try {
      const payload = await post('/api/materials/bulk-delete', { ids: deleteTargetIds, mode });
      elements.deleteDialog.close();
      deleteTargetIds = [];
      selectedIds.clear();
      await load('', { reset: true });
      setStatus(mode === 'index'
        ? t('mt.removedIndexOnly', { count: payload.removed })
        : t('mt.removedWithFiles', { count: payload.removed }));
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
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => load('', { reset: true }), 250);
  });
  elements.up.addEventListener('click', navigateUp);
  elements.refresh.addEventListener('click', () => load(t('mt.refreshedLog'), { forceSync: true }));
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
      elements.renameDialog.close();
      selectedIds = new Set([payload.entry.id]);
      await load('', { reset: true });
      setStatus(t('mt.renamed', { name: payload.entry.name }));
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
    elements.documentName.value = t('mt.newDocDefaultName');
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
      elements.documentDialog.close();
      selectedIds = new Set([payload.entry.id]);
      await load('', { reset: true });
      setStatus(t('mt.docCreated', { name: payload.entry.name }));
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
  function ensureInitialized() {
    if (materialInitialized || materialLoading) return;
    load();
    loadMigrationStatus({ quiet: true });
  }

  const loadObserver = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting) && hasMoreEntries && !materialLoading) {
      load('', { reset: false });
    }
  }, { root: elements.browser, rootMargin: '520px 0px' });
  loadObserver.observe(elements.loadSentinel);

  window.addEventListener('stella:page-change', event => {
    if (event.detail?.page === 'materials') ensureInitialized();
  });

  if (!elements.page.hidden) {
    ensureInitialized();
  }
})();
