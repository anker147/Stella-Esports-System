const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('node:child_process');
const { BpService } = require('./bp-service');
const { BpPresentationService } = require('./bp-presentation');
const { CONFIG, ESCAPE_CHARACTERS, HUNTER_CHARACTERS, PHASES, SLOT_CONFIG, phaseDurations, animationStyle, updateBpTimerConfig, commentatorImageId, updateCommentatorImageId, commentatorLogoImageId, updateCommentatorLogoImageId } = require('./bp-config');
const { ObsController } = require('./obs-controller');
const { ObsWebSocketClient } = require('./obs-websocket');
const { MusicController } = require('./music-controller');
const { SceneMusicController } = require('./scene-music-controller');
const { MaterialLibrary } = require('./material-library');
const { ObsPathMigration } = require('./obs-path-migration');
const { readReleaseData } = require('./release-service');
const { createTournamentResolver, readAllData } = require('./tournament-data');
const { beijingTimestamp, selectSchedulePresentation } = require('./schedule-service');
const { DATA_ROOT, mutableDataPath, parseJsonFile } = require('./data-paths');
const { assertAssetDirectory, relativeAssetPath, resolveAssetPath } = require('./asset-paths');
const { createAssetResolver, indexedCommentatorImages } = require('./asset-fallback');

const PORT = Number(process.env.PORT || 3788);
const ROOT = path.resolve(__dirname, '..', 'public');
const COUNTDOWN_HUB_ID = 'countdown';
const BP_OVERLAY_URL = `http://127.0.0.1:${PORT}/bp-overlay.html`;
const WINDOW_CONTROL_SCRIPT = path.join(__dirname, 'window-control.ps1');
const MATERIAL_PICKER_SCRIPT = path.join(__dirname, 'material-picker.ps1');
const MATERIAL_OPEN_SCRIPT = path.join(__dirname, 'material-open.ps1');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon'
};
const IMAGE_TYPES = new Map([
  ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp']
]);
const MATERIAL_CONTENT_TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.bmp', 'image/bmp'],
  ['.svg', 'image/svg+xml'], ['.ico', 'image/x-icon'], ['.avif', 'image/avif'],
  ['.mp4', 'video/mp4'], ['.webm', 'video/webm'], ['.ogv', 'video/ogg'],
  ['.mov', 'video/quicktime'], ['.m4v', 'video/x-m4v'],
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.ogg', 'audio/ogg'],
  ['.m4a', 'audio/mp4'], ['.aac', 'audio/aac'], ['.flac', 'audio/flac']
]);
const COMMENTATOR_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const STARTED_AT = new Date().toISOString();
const CONTROL_TOKEN = String(process.env.STELLA_CONTROL_TOKEN || '');

const hubs = new Map();
const bpClients = new Set();
const bpPresentationClients = new Set();
const obsOperations = [];
const tournamentResolver = createTournamentResolver(readAllData());
const runtimeConfigPath = mutableDataPath('runtime-config.json', '{}\n');
const runtimeConfig = (() => {
  try {
    return parseJsonFile(runtimeConfigPath);
  } catch {
    return {};
  }
})();
const localObsConfig = (() => {
  try {
    const configPath = path.join(process.env.APPDATA, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.server_enabled) return {};
    return {
      url: `ws://127.0.0.1:${config.server_port || 4455}`,
      password: config.auth_required ? config.server_password || '' : ''
    };
  } catch {
    return {};
  }
})();
const obsClient = new ObsWebSocketClient({
  url: process.env.OBS_WS_URL || runtimeConfig.obs?.url || localObsConfig.url || 'ws://127.0.0.1:4455',
  password: process.env.OBS_WS_PASSWORD || runtimeConfig.obs?.password || localObsConfig.password || ''
});
const materialLibrary = new MaterialLibrary();
const assetResolver = createAssetResolver(materialLibrary);
const obsController = new ObsController({ client: obsClient, resolver: tournamentResolver, assetPath: assetResolver });
const musicController = new MusicController();
const sceneMusicController = new SceneMusicController({ musicController });
let activeCommentatorImage = commentatorImages().find(image => image.id === commentatorImageId()) || null;
let activeCommentatorLogoImage = commentatorLogoImages().find(image => image.id === commentatorLogoImageId()) || commentatorLogoImages()[0] || null;
const bpService = new BpService({ resolver: tournamentResolver, commentatorImage: activeCommentatorImage });
tournamentResolver.setOutcomeResolver(matchId => bpService.matchWinner(matchId));
const bpPresentation = new BpPresentationService({
  resolver: tournamentResolver,
  getSession: id => bpService.serialize(bpService.getSession(id))
});
const obsPathMigration = new ObsPathMigration({ client: obsClient, obsController, materialLibrary });
ensureHub(COUNTDOWN_HUB_ID);

function pickMaterialPaths(mode) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', MATERIAL_PICKER_SCRIPT, '-Mode', mode
    ], { windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(new Error(`文件选择器打开失败: ${error.message}`));
        return;
      }
      try {
        const parsed = JSON.parse(String(stdout || '[]').trim() || '[]');
        resolve(Array.isArray(parsed) ? parsed : [parsed]);
      } catch (parseError) {
        reject(new Error(`文件选择器结果无效: ${parseError.message}`));
      }
    });
  });
}

function openMaterialPath(targetPath) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', MATERIAL_OPEN_SCRIPT, '-Path', targetPath
    ], { windowsHide: true, timeout: 15000 }, error => {
      if (error) reject(new Error(`无法使用系统关联程序打开文件: ${error.message}`));
      else resolve();
    });
  });
}

function currentSchedulePresentation(now = Date.now()) {
  return selectSchedulePresentation(
    tournamentResolver.schedules,
    matchId => Boolean(bpService.matchWinner(matchId)),
    now
  );
}

async function syncCurrentScheduleImage(now = Date.now()) {
  const presentation = currentSchedulePresentation(now);
  if (presentation?.image) await obsController.syncScheduleImage(presentation.image);
  if (presentation?.tableImage) await obsController.syncScheduleTableImage(presentation.tableImage);
  return presentation;
}

function commentatorImages() {
  const images = [];
  let root;
  try { root = resolveAssetPath(CONFIG.assets.commentatorRoot); } catch {}
  if (root && fs.existsSync(root)) {
    images.push(...fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.includes('组合') && COMMENTATOR_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase('en-US')))
      .map(entry => ({
        id: entry.name,
        name: path.basename(entry.name, path.extname(entry.name)),
        filePath: path.posix.join(CONFIG.assets.commentatorRoot.replaceAll('\\', '/'), entry.name),
        absolutePath: path.join(root, entry.name)
      })));
  }
  const seen = new Set(images.map(image => path.resolve(image.absolutePath).toLocaleLowerCase('en-US')));
  for (const image of indexedCommentatorImages(materialLibrary)) {
    const key = path.resolve(image.absolutePath).toLocaleLowerCase('en-US');
    if (!seen.has(key)) images.push(image);
    seen.add(key);
  }
  return images.map(({ absolutePath, indexed, ...image }) => image)
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }));
}

function commentatorImage(imageId) {
  const image = commentatorImages().find(item => item.id === imageId);
  if (!image) throw new Error('所选解说组图不存在');
  return image;
}

function commentatorLogoImages() {
  const images = [{
    id: 'logo',
    name: '解说席 LOGO',
    filePath: CONFIG.assets.commentatorLogo
  }];
  let root;
  try { root = resolveAssetPath(CONFIG.assets.commentatorCodeRoot); } catch {}
  if (root && fs.existsSync(root)) {
    images.push(...fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isFile() && COMMENTATOR_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase('en-US')))
      .map(entry => ({
        id: `code:${entry.name}`,
        name: path.basename(entry.name, path.extname(entry.name)),
        filePath: path.posix.join(CONFIG.assets.commentatorCodeRoot.replaceAll('\\', '/'), entry.name)
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true })));
  }
  return images;
}

function commentatorLogoImage(imageId) {
  const image = commentatorLogoImages().find(item => item.id === imageId);
  if (!image) throw new Error('所选解说 LOGO 或兑换码不存在');
  return image;
}

function sessionForObs(session) {
  if (!session?.commentatorImage?.id) return session;
  const image = commentatorImages().find(item => item.id === session.commentatorImage.id);
  return image ? { ...session, commentatorImage: image } : session;
}

function defaultCountdownState() {
  return {
    module: 'countdown',
    mode: 'duration',
    durationSeconds: 48,
    targetAt: null,
    remainingSeconds: 48,
    running: false,
    startedAt: null,
    deadline: null,
    updatedAt: Date.now()
  };
}

function ensureHub(id) {
  const normalizedId = id === COUNTDOWN_HUB_ID ? id : COUNTDOWN_HUB_ID;
  if (!hubs.has(normalizedId)) {
    hubs.set(normalizedId, {
      id: normalizedId,
      state: defaultCountdownState(),
      clients: new Set()
    });
  }
  return hubs.get(normalizedId);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function readBuffer(req, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('图片不能超过20MB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function imageExtension(contentType) {
  const extension = IMAGE_TYPES.get(String(contentType || '').split(';')[0].toLowerCase());
  if (!extension) throw new Error('仅支持PNG、JPG和WebP图片');
  return extension;
}

function writeImage(root, baseName, extension, buffer) {
  if (!buffer.length) throw new Error('图片内容为空');
  const relativeRoot = relativeAssetPath(root);
  root = assertAssetDirectory(relativeRoot);
  const fileName = `${baseName}${extension}`;
  const filePath = path.join(root, fileName);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, filePath);
  return { fileName, filePath: path.posix.join(relativeRoot, fileName) };
}

function chineseRound(matchId) {
  const tournament = tournamentResolver.getTournamentByMatch(matchId);
  const index = tournament.matches.findIndex(match => match.id === matchId) + 1;
  return `第${['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'][index]}轮`;
}

function divisionLabel(matchId) {
  return tournamentResolver.getTournamentByMatch(matchId).event.division === 'pc' ? '端游赛区' : '手游赛区';
}

function broadcast(hub) {
  const payload = `event: state\ndata: ${JSON.stringify(hub.state)}\n\n`;
  for (const client of hub.clients) {
    client.write(payload);
  }
}

function broadcastBp(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of bpClients) client.write(message);
}

function presentationStatus(reason) {
  return {
    ...bpPresentation.payload(reason),
    clientCount: bpPresentationClients.size,
    overlayUrl: BP_OVERLAY_URL
  };
}

function broadcastPresentation(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of bpPresentationClients) client.write(message);
  if (event === 'presentation') broadcastBp('bp-presentation', {
    ...payload,
    clientCount: bpPresentationClients.size,
    overlayUrl: BP_OVERLAY_URL
  });
}

bpPresentation.on('presentation', payload => broadcastPresentation('presentation', payload));
const bpPresentationHeartbeat = setInterval(() => {
  if (bpPresentationClients.size) broadcastPresentation('heartbeat', bpPresentation.heartbeat());
}, 1000);
bpPresentationHeartbeat.unref?.();
bpService.on('session', payload => {
  broadcastBp('session', payload);
  bpPresentation.publishSession(payload.session, payload.reason);
});
bpService.on('push-slot', ({ session, slotId }) => {
  obsController.pushSlot(session, slotId).catch(() => {});
});
bpService.on('clear-slot', ({ session, slotId }) => {
  obsController.clearSlot(session, slotId).catch(() => {});
});
bpService.on('timer', ({ seconds }) => {
  obsController.setTimer(seconds).catch(() => {});
});
bpService.on('sync-session', ({ session }) => {
  obsController.syncSession(sessionForObs(session)).catch(() => {});
});
bpService.on('score', ({ score }) => {
  obsController.syncScore(score).catch(() => {});
});
obsClient.on('status', status => broadcastBp('obs-status', obsController.status(status)));
obsClient.on('CurrentProgramSceneChanged', event => {
  sceneMusicController.setScene(event.sceneName).catch(() => {});
  if (event.sceneName !== CONFIG.obsScenes.bp && bpPresentation.state.visibility !== 'hidden') {
    bpPresentation.hide('scene-left-bp');
  }
});
obsController.on('operation', operation => broadcastBp('obs-operation', operation));
obsController.on('operation', operation => {
  obsOperations.push({ ...operation, category: 'obs' });
  while (obsOperations.length > 500) obsOperations.shift();
});

function persistRuntimeConfig() {
  const tempPath = `${runtimeConfigPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, runtimeConfigPath);
}

function collectedLogs() {
  const bpLogs = bpService.listSessions().flatMap(session => session.history.map(entry => ({
    timestamp: entry.timestamp,
    category: 'bp',
    action: entry.action,
    sessionId: session.id,
    details: entry.details
  })));
  return [...bpLogs, ...obsOperations].sort((left, right) => right.timestamp - left.timestamp);
}

function currentRemaining(state) {
  if (!state.running || !state.deadline) {
    return Math.max(0, Number(state.remainingSeconds) || 0);
  }
  return Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
}

function normalizeSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.floor(number));
}

function applyCountdownAction(state, action) {
  const now = Date.now();
  const next = { ...state, updatedAt: now };

  if (action.type === 'set-duration') {
    const minutes = normalizeSeconds(action.minutes);
    const seconds = Math.min(59, normalizeSeconds(action.seconds));
    const durationSeconds = Math.min(99 * 60 + 59, minutes * 60 + seconds);
    next.mode = 'duration';
    next.durationSeconds = durationSeconds;
    next.targetAt = null;
    next.remainingSeconds = durationSeconds;
    next.running = durationSeconds > 0;
    next.startedAt = now;
    next.deadline = now + durationSeconds * 1000;
    return next;
  }

  if (action.type === 'set-target') {
    const targetMs = Date.parse(action.targetAt);
    if (!Number.isFinite(targetMs)) return next;
    next.mode = 'target';
    next.targetAt = new Date(targetMs).toISOString();
    next.durationSeconds = null;
    next.remainingSeconds = Math.max(0, Math.ceil((targetMs - now) / 1000));
    next.running = next.remainingSeconds > 0;
    next.startedAt = now;
    next.deadline = targetMs;
    return next;
  }

  if (action.type === 'start') {
    const remaining = next.mode === 'target' && next.targetAt
      ? Math.max(0, Math.ceil((Date.parse(next.targetAt) - now) / 1000))
      : currentRemaining(next);
    next.running = remaining > 0;
    next.remainingSeconds = remaining;
    next.startedAt = now;
    next.deadline = next.mode === 'target' && next.targetAt
      ? Date.parse(next.targetAt)
      : now + remaining * 1000;
    return next;
  }

  if (action.type === 'pause') {
    next.remainingSeconds = currentRemaining(next);
    next.running = false;
    next.startedAt = null;
    next.deadline = next.mode === 'target' && next.targetAt ? Date.parse(next.targetAt) : null;
    return next;
  }

  if (action.type === 'reset') {
    next.running = false;
    next.startedAt = null;
    next.deadline = null;
    next.remainingSeconds = 0;
    return next;
  }

  return next;
}

function serveStatic(req, res, pathname) {
  const cleanPath = pathname === '/' ? '/control.html' : pathname;
  const filePath = path.resolve(ROOT, `.${cleanPath}`);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'GET' && pathname === '/api/system/health') {
    let version = 'unknown';
    try { version = readReleaseData().currentVersion; } catch {}
    sendJson(res, 200, {
      product: 'stella-director',
      version,
      status: 'ready',
      pid: process.pid,
      startedAt: STARTED_AT,
      dataDir: DATA_ROOT
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/system/shutdown') {
    if (!CONTROL_TOKEN || req.headers['x-stella-token'] !== CONTROL_TOKEN) {
      sendJson(res, 403, { error: '控制令牌无效' });
      return;
    }
    sendJson(res, 202, { shuttingDown: true });
    setTimeout(() => {
      server.close(() => process.exit(0));
      shutdown();
    }, 50).unref?.();
    return;
  }

  if (req.method === 'POST' && pathname === '/api/hubs') {
    const id = COUNTDOWN_HUB_ID;
    ensureHub(id);
    sendJson(res, 201, {
      id,
      controlUrl: `/control.html?hub=${id}`,
      overlayUrl: `/hub/${id}`
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/materials') {
    sendJson(res, 200, { entries: materialLibrary.list({ forceSync: url.searchParams.get('sync') === '1' }) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/material-paths/status') {
    try {
      sendJson(res, 200, await obsPathMigration.status());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/material-paths/validate') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      sendJson(res, 200, await obsPathMigration.validate(body.folderId));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/material-paths/sync') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      sendJson(res, 200, await obsPathMigration.sync(body.folderId));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/material-paths/rollback') {
    try {
      sendJson(res, 200, await obsPathMigration.rollback());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/update-log') {
    try {
      sendJson(res, 200, readReleaseData());
    } catch (error) {
      sendJson(res, 500, { error: `更新日志读取失败: ${error.message}` });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/materials/import') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const mode = body.kind === 'folder' ? 'folder' : 'files';
      const paths = await pickMaterialPaths(mode);
      if (!paths.length) {
        sendJson(res, 200, { cancelled: true, entries: materialLibrary.list() });
        return;
      }
      sendJson(res, 200, materialLibrary.addPaths(paths));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/materials/select-folder') {
    try {
      const paths = await pickMaterialPaths('folder');
      sendJson(res, 200, { path: paths[0] || null, cancelled: !paths.length });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/materials/documents') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      sendJson(res, 201, materialLibrary.createDocument(body.directoryPath, body.name));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const materialContentMatch = pathname.match(/^\/api\/materials\/([^/]+)\/content$/);
  if (req.method === 'GET' && materialContentMatch) {
    try {
      const entry = materialLibrary.entry(materialContentMatch[1]);
      const stat = fs.statSync(entry.path);
      if (!stat.isFile()) throw new Error('文件夹不能预览');
      const contentType = MATERIAL_CONTENT_TYPES.get(path.extname(entry.path).toLocaleLowerCase('en-US')) || 'application/octet-stream';
      const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      let start = 0;
      let end = stat.size - 1;
      if (range) {
        start = range[1] ? Number(range[1]) : 0;
        end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= stat.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
          res.end();
          return;
        }
      }
      const headers = {
        'Content-Type': contentType,
        'Content-Length': end - start + 1,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(entry.path))}`,
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
        'X-Content-Type-Options': 'nosniff'
      };
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      res.writeHead(range ? 206 : 200, headers);
      fs.createReadStream(entry.path, { start, end }).pipe(res);
    } catch (error) {
      sendJson(res, 404, { error: error.message });
    }
    return;
  }

  const materialActionMatch = pathname.match(/^\/api\/materials\/([^/]+)\/(rename|delete)$/);
  if (req.method === 'POST' && materialActionMatch) {
    try {
      const [, id, action] = materialActionMatch;
      const body = JSON.parse((await readBody(req)) || '{}');
      const result = action === 'rename'
        ? materialLibrary.rename(id, body.name)
        : materialLibrary.remove(id, body.mode);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const materialOpenMatch = pathname.match(/^\/api\/materials\/([^/]+)\/open$/);
  if (req.method === 'POST' && materialOpenMatch) {
    try {
      const entry = materialLibrary.entry(materialOpenMatch[1]);
      if (!fs.existsSync(entry.path)) throw new Error('文件或文件夹已经不存在');
      await openMaterialPath(entry.path);
      sendJson(res, 200, { opened: true, id: entry.id });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/materials/bulk-delete') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      sendJson(res, 200, materialLibrary.removeMany(body.ids, body.mode));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/console/bootstrap') {
    const music = await musicController.status();
    try {
      const scenes = await obsController.sceneCatalog();
      sendJson(res, 200, { obs: { ...obsController.status(), ...scenes }, music });
    } catch (error) {
      sendJson(res, 200, { obs: { ...obsController.status(), scenes: [], transitions: [], error: error.message }, music });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/console/scene') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      await obsController.pushScene(body.sceneName);
      sendJson(res, 200, await obsController.sceneCatalog());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/music/status') {
    sendJson(res, 200, await musicController.status({ force: url.searchParams.get('force') === '1' }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/window/maximize') {
    execFile('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WINDOW_CONTROL_SCRIPT
    ], { windowsHide: true, timeout: 3000 }, error => {
      if (error) sendJson(res, 500, { error: error.message });
      else sendJson(res, 200, { maximized: true });
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/music/actions') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      sendJson(res, 200, await musicController.action(body.type, body.value));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bp/bootstrap') {
    sendJson(res, 200, {
      tournament: tournamentResolver.data,
      schedules: tournamentResolver.schedules,
      characters: { escape: ESCAPE_CHARACTERS, hunter: HUNTER_CHARACTERS },
      phases: PHASES,
      slots: SLOT_CONFIG,
      ui: CONFIG.ui,
      timer: { ...CONFIG.timer, phaseDurations: phaseDurations(), animationStyle: animationStyle() },
      commentatorImages: commentatorImages().map(({ filePath, ...image }) => image),
      commentatorImage: activeCommentatorImage
        ? { id: activeCommentatorImage.id, name: activeCommentatorImage.name }
        : null,
      commentatorLogoImages: commentatorLogoImages().map(({ filePath, ...image }) => image),
      commentatorLogoImage: activeCommentatorLogoImage
        ? { id: activeCommentatorLogoImage.id, name: activeCommentatorLogoImage.name }
        : null,
      sessions: bpService.listSessions(),
      obs: obsController.status(),
      dynamicBp: presentationStatus()
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bp/commentator-image') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const image = commentatorImage(body.imageId);
      await obsController.syncCommentatorImage(image.filePath);
      updateCommentatorImageId(image.id);
      activeCommentatorImage = image;
      bpService.setGlobalCommentatorImage(image);
      sendJson(res, 200, { id: image.id, name: image.name });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bp/commentator-logo-image') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const image = commentatorLogoImage(body.imageId);
      await obsController.syncCommentatorLogo(image.filePath);
      updateCommentatorLogoImageId(image.id);
      activeCommentatorLogoImage = image;
      sendJson(res, 200, { id: image.id, name: image.name });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bp/presentation') {
    sendJson(res, 200, presentationStatus());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bp/presentation/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    });
    bpPresentationClients.add(res);
    res.write(`event: presentation\ndata: ${JSON.stringify(presentationStatus('connected'))}\n\n`);
    broadcastBp('bp-presentation', presentationStatus('client-connected'));
    req.on('close', () => {
      bpPresentationClients.delete(res);
      broadcastBp('bp-presentation', presentationStatus('client-disconnected'));
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bp/presentation/settings') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const enabled = Boolean(body.enabled);
      let obsError = null;
      bpPresentation.setEnabled(enabled);
      await obsController.configureBpOverlay({ url: BP_OVERLAY_URL, enabled })
        .catch(error => { obsError = error.message; });
      sendJson(res, 200, { ...presentationStatus(), obsSynced: !obsError, obsError });
    } catch (error) {
      sendJson(res, 400, { error: error.message, ...presentationStatus() });
    }
    return;
  }

  if (pathname === '/api/bp/timer-config' && req.method === 'GET') {
    sendJson(res, 200, {
      phases: PHASES.map(phase => ({ id: phase.id, label: phase.label })),
      phaseDurations: phaseDurations(),
      animationStyle: animationStyle()
    });
    return;
  }

  if (pathname === '/api/bp/timer-config' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const settings = updateBpTimerConfig(body);
      bpPresentation.commit('animation-style-updated');
      sendJson(res, 200, {
        phases: PHASES.map(phase => ({ id: phase.id, label: phase.label })),
        ...settings
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bracket-image') {
    try {
      const buffer = await readBuffer(req);
      const extension = imageExtension(req.headers['content-type']);
      const stamp = beijingTimestamp();
      const saved = writeImage(CONFIG.assets.bracketUploadRoot, `手游赛区-${stamp}`, extension, buffer);
      const obsSynced = await obsController.syncBracketImage(saved.filePath)
        .then(() => obsController.switchScene('bracket'))
        .then(() => true, () => false);
      sendJson(res, 200, { ...saved, obsSynced });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const resultImageMatch = pathname.match(/^\/api\/bp\/sessions\/([^/]+)\/result-image$/);
  if (req.method === 'POST' && resultImageMatch) {
    try {
      const id = resultImageMatch[1];
      const current = bpService.serialize(bpService.getSession(id));
      if (!current.result?.winnerRole) throw new Error('请先选择本局战果');
      const buffer = await readBuffer(req);
      const extension = imageExtension(req.headers['content-type']);
      const saved = writeImage(
        CONFIG.assets.resultUploadRoot,
        `${divisionLabel(current.matchId)}-${chineseRound(current.matchId)}-MATCH ${current.gameNumber}-${current.room}房`,
        extension,
        buffer
      );
      const session = bpService.setResultImage(id, saved);
      const obsSynced = await obsController.syncResult(session)
        .then(() => obsController.syncResultImage(saved.filePath))
        .then(() => obsController.switchScene('result'))
        .then(() => true, () => false);
      sendJson(res, 200, { session, ...saved, obsSynced });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/logs') {
    sendJson(res, 200, { logs: collectedLogs() });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bp/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    });
    res.write(`event: obs-status\ndata: ${JSON.stringify(obsController.status())}\n\n`);
    bpClients.add(res);
    req.on('close', () => bpClients.delete(res));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bp/sessions') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const session = bpService.ensureSession(body.matchId, Number(body.gameNumber), String(body.room).toUpperCase(), Number(body.attempt || 1));
      sendJson(res, 200, bpService.serialize(session));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const bpSessionMatch = pathname.match(/^\/api\/bp\/sessions\/([^/]+)(?:\/(actions|export))?$/);
  if (bpSessionMatch) {
    const id = bpSessionMatch[1];
    const endpoint = bpSessionMatch[2] || 'state';
    try {
      if (req.method === 'GET' && endpoint === 'state') {
        sendJson(res, 200, bpService.serialize(bpService.getSession(id)));
        return;
      }
      if (req.method === 'GET' && endpoint === 'export') {
        const session = bpService.serialize(bpService.getSession(id));
        const body = JSON.stringify(session, null, 2);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json"`,
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store'
        });
        res.end(body);
        return;
      }
      if (req.method === 'POST' && endpoint === 'actions') {
        const action = JSON.parse((await readBody(req)) || '{}');
        let session;
        if (action.type === 'start') {
          session = bpService.startSession(id);
          obsController.syncMatch(session).catch(() => {});
        } else if (action.type === 'complete') {
          session = bpService.completeSession(id);
        } else if (action.type === 'set-slot') {
          session = bpService.updateSlot(id, action);
        } else if (action.type === 'clear-slot') {
          session = bpService.clearSlot(id, action.slotId);
        } else if (action.type === 'restore-revision') {
          session = bpService.restoreRevision(id, Number(action.revision));
        } else if (action.type === 'create-replay') {
          session = bpService.createReplay(id);
          await syncCurrentScheduleImage().catch(() => {});
        } else if (action.type === 'sync-obs') {
          session = bpService.serialize(bpService.getSession(id));
          await obsController.syncSession(sessionForObs(session));
          if (bpPresentation.state.dynamicEnabled) bpPresentation.prepare(session, 'obs-sync-prepared');
        } else if (action.type === 'sync-match') {
          session = bpService.serialize(bpService.getSession(id));
          await obsController.syncMatch(session);
        } else if (action.type === 'sync-match-and-switch') {
          session = bpService.serialize(bpService.getSession(id));
          await obsController.syncMatch(session);
          await obsController.switchScene('matchup');
        } else if (action.type === 'switch-scene-bp') {
          session = bpService.serialize(bpService.getSession(id));
          let dynamicReady = false;
          if (bpPresentation.state.dynamicEnabled) {
            bpPresentation.prepare(session, 'scene-switch-prepared');
            dynamicReady = await obsController.configureBpOverlay({ url: BP_OVERLAY_URL, enabled: true })
              .then(() => true, () => {
                bpPresentation.hide('overlay-obs-failed');
                return false;
              });
          } else {
            bpPresentation.hide('dynamic-disabled-switch');
            await obsController.configureBpOverlay({ url: BP_OVERLAY_URL, enabled: false }).catch(() => {});
          }
          await obsController.switchScene('bp');
          if (dynamicReady) bpPresentation.armIntro(session, 2000);
        } else if (action.type === 'set-commentator-image') {
          const image = commentatorImage(action.imageId);
          await obsController.syncCommentatorImage(image.filePath);
          updateCommentatorImageId(image.id);
          activeCommentatorImage = image;
          session = bpService.setCommentatorImage(id, image);
        } else if (action.type === 'set-output-mode') {
          session = bpService.setOutputMode(id, action.mode);
        } else if (action.type === 'set-result') {
          session = bpService.setResult(id, action.winnerRole);
          await obsController.syncResult(session).catch(() => {});
          await syncCurrentScheduleImage().catch(() => {});
        } else if (action.type === 'declare-forfeit') {
          session = bpService.declareForfeit(id, action.forfeitingTeamId);
          await obsController.syncScore(session.score).catch(() => {});
          await syncCurrentScheduleImage().catch(() => {});
        } else if (action.type === 'revoke-forfeit') {
          session = bpService.revokeForfeit(id);
          await obsController.syncScore(session.score).catch(() => {});
          await syncCurrentScheduleImage().catch(() => {});
        } else if (action.type === 'reset-session') {
          session = bpService.resetSession(id);
          await syncCurrentScheduleImage().catch(() => {});
        } else {
          throw new Error(`未知BP操作: ${action.type}`);
        }
        sendJson(res, 200, session);
        return;
      }
    } catch (error) {
      sendJson(res, 400, { error: error.message });
      return;
    }
  }

  if (pathname === '/api/obs/status' && req.method === 'GET') {
    sendJson(res, 200, obsController.status());
    return;
  }

  if (pathname === '/api/obs/connect' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const password = typeof body.password === 'string' && body.password.length ? body.password : obsClient.password;
      obsClient.configure({ url: body.url, password });
      runtimeConfig.obs = { url: obsClient.url, password: obsClient.password };
      persistRuntimeConfig();
      const status = await obsController.connect();
      await obsController.syncCountdownUrl(body.countdownUrl);
      await syncCurrentScheduleImage();
      if (activeCommentatorLogoImage) await obsController.syncCommentatorLogo(activeCommentatorLogoImage.filePath);
      const dynamicObs = await obsController.configureBpOverlay({
        url: BP_OVERLAY_URL,
        enabled: bpPresentation.state.dynamicEnabled
      }).then(() => ({ synced: true }), error => ({ synced: false, error: error.message }));
      sendJson(res, 200, { ...status, dynamicBp: dynamicObs });
    } catch (error) {
      sendJson(res, 400, { error: error.message, ...obsController.status() });
    }
    return;
  }

  const hubMatch = pathname.match(/^\/api\/hubs\/([^/]+)(?:\/(events|state|actions))?$/);
  if (hubMatch) {
    const id = hubMatch[1];
    const endpoint = hubMatch[2] || 'state';
    const hub = ensureHub(id);

    if (req.method === 'GET' && endpoint === 'state') {
      hub.state = { ...hub.state, remainingSeconds: currentRemaining(hub.state), updatedAt: Date.now() };
      sendJson(res, 200, hub.state);
      return;
    }

    if (req.method === 'GET' && endpoint === 'events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive'
      });
      res.write(`event: state\ndata: ${JSON.stringify(hub.state)}\n\n`);
      hub.clients.add(res);
      req.on('close', () => hub.clients.delete(res));
      return;
    }

    if (req.method === 'POST' && endpoint === 'actions') {
      try {
        const body = await readBody(req);
        const action = body ? JSON.parse(body) : {};
        hub.state = applyCountdownAction(hub.state, action);
        broadcast(hub);
        sendJson(res, 200, hub.state);
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }
  }

  const overlayMatch = pathname.match(/^\/hub\/([^/]+)$/);
  if (req.method === 'GET' && overlayMatch) {
    serveStatic(req, res, '/overlay.html');
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`ZFB Web HUB running at http://localhost:${PORT}/control.html`);
  obsController.connect()
    .then(async () => {
      await obsController.syncCountdownUrl(process.env.COUNTDOWN_URL || `http://localhost:${PORT}/hub/countdown`);
      await syncCurrentScheduleImage();
      if (activeCommentatorLogoImage) await obsController.syncCommentatorLogo(activeCommentatorLogoImage.filePath);
      await obsController.configureBpOverlay({
        url: BP_OVERLAY_URL,
        enabled: bpPresentation.state.dynamicEnabled
      }).catch(() => {});
      const scenes = await obsController.sceneCatalog();
      await sceneMusicController.setScene(scenes.currentScene);
    })
    .catch(() => {});
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.log(`ZFB Web HUB 已经运行：http://localhost:${PORT}/control.html`);
    process.exitCode = 0;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(bpPresentationHeartbeat);
  bpService.close();
  obsClient.disconnect();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
