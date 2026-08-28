(function () {
  const elements = {
    page: document.getElementById('consolePage'),
    sceneButtons: document.getElementById('consoleSceneButtons'),
    currentScene: document.getElementById('currentObsScene'),
    obsSummary: document.getElementById('consoleObsSummary'),
    refreshScenes: document.getElementById('refreshScenes'),
    sceneMessage: document.getElementById('sceneConsoleMessage'),
    title: document.getElementById('musicTitle'),
    artist: document.getElementById('musicArtist'),
    state: document.getElementById('musicState'),
    progress: document.getElementById('musicProgress'),
    position: document.getElementById('musicPosition'),
    duration: document.getElementById('musicDuration'),
    previous: document.getElementById('musicPrevious'),
    toggle: document.getElementById('musicToggle'),
    next: document.getElementById('musicNext'),
    volume: document.getElementById('musicVolume'),
    volumeValue: document.getElementById('musicVolumeValue'),
    musicMessage: document.getElementById('musicConsoleMessage')
  };

  let musicState = null;
  let pollTimer = null;
  let obsState = null;
  let switchingScene = false;

  async function request(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
    return payload;
  }

  function post(url, body) {
    return request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function setMessage(element, message = '', error = false) {
    element.textContent = message;
    element.classList.toggle('error', error);
  }

  function renderObs(obs) {
    obsState = obs;
    const connected = Boolean(obs.connected);
    elements.currentScene.textContent = obs.currentScene || '-';
    elements.obsSummary.textContent = connected
      ? `${obs.scenes?.length || 0} 个可推送场景`
      : 'OBS 未连接';
    elements.sceneButtons.replaceChildren(...[...(obs.scenes || [])].reverse().map(sceneName => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `scene-button${sceneName === obs.currentScene ? ' current' : ''}`;
      button.textContent = sceneName;
      button.disabled = !connected || switchingScene;
      button.addEventListener('click', () => switchToScene(sceneName));
      return button;
    }));
    setMessage(elements.sceneMessage, obs.error || '', Boolean(obs.error));
  }

  function formatTime(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  function renderMusic(state) {
    musicState = state;
    const available = Boolean(state.available);
    elements.title.textContent = available ? state.title || '未知曲目' : '等待网易云播放';
    elements.artist.textContent = available
      ? [state.artist, state.album].filter(Boolean).join(' · ') || '未知歌手'
      : '未检测到媒体会话';
    elements.state.textContent = state.playing ? '播放中' : available ? '已暂停' : '未播放';
    elements.state.classList.toggle('playing', Boolean(state.playing));
    elements.toggle.textContent = state.playing ? 'Ⅱ' : '▶';
    elements.toggle.title = state.playing ? '暂停' : '播放';
    elements.toggle.setAttribute('aria-label', elements.toggle.title);
    elements.position.textContent = formatTime(state.positionSeconds);
    elements.duration.textContent = formatTime(state.durationSeconds);
    const progress = state.durationSeconds > 0 ? Math.min(100, state.positionSeconds / state.durationSeconds * 100) : 0;
    elements.progress.style.width = `${progress}%`;
    [elements.previous, elements.toggle, elements.next].forEach(button => { button.disabled = !available; });
    const hasVolume = Number.isFinite(state.volume);
    elements.volume.disabled = !hasVolume;
    if (hasVolume) elements.volume.value = String(state.volume);
    elements.volumeValue.textContent = hasVolume ? `${state.volume}%` : '--';
    setMessage(elements.musicMessage, state.error || '', Boolean(state.error));
  }

  async function refreshConsole() {
    elements.refreshScenes.disabled = true;
    try {
      const payload = await request('/api/console/bootstrap');
      renderObs(payload.obs);
      renderMusic(payload.music);
    } catch (error) {
      setMessage(elements.sceneMessage, error.message, true);
    } finally {
      elements.refreshScenes.disabled = false;
    }
  }

  async function switchToScene(sceneName) {
    if (switchingScene) return;
    switchingScene = true;
    renderObs(obsState);
    setMessage(elements.sceneMessage, `正在切换到 ${sceneName}...`);
    try {
      const state = await post('/api/console/scene', { sceneName });
      renderObs({ ...state, connected: true });
      setMessage(elements.sceneMessage, `已切换到 ${state.currentScene}`);
    } catch (error) {
      setMessage(elements.sceneMessage, error.message, true);
    } finally {
      switchingScene = false;
      elements.sceneButtons.querySelectorAll('button').forEach(button => {
        button.disabled = !obsState?.connected;
      });
    }
  }

  async function refreshMusic(force = false) {
    if (elements.page.hidden) return;
    try {
      renderMusic(await request(`/api/music/status${force ? '?force=1' : ''}`));
    } catch (error) {
      setMessage(elements.musicMessage, error.message, true);
    }
  }

  async function musicAction(type, value) {
    [elements.previous, elements.toggle, elements.next, elements.volume].forEach(control => { control.disabled = true; });
    try {
      renderMusic(await post('/api/music/actions', { type, value }));
      if (type === 'previous' || type === 'next') {
        setTimeout(() => refreshMusic(true), 700);
      }
    } catch (error) {
      setMessage(elements.musicMessage, error.message, true);
      if (musicState) renderMusic(musicState);
    }
  }

  elements.refreshScenes.addEventListener('click', refreshConsole);
  elements.previous.addEventListener('click', () => musicAction('previous'));
  elements.toggle.addEventListener('click', () => musicAction('toggle'));
  elements.next.addEventListener('click', () => musicAction('next'));
  elements.volume.addEventListener('input', () => { elements.volumeValue.textContent = `${elements.volume.value}%`; });
  elements.volume.addEventListener('change', () => musicAction('set-volume', Number(elements.volume.value)));

  document.querySelector('[data-page="console"]').addEventListener('click', refreshConsole);
  pollTimer = setInterval(refreshMusic, 5000);
  window.addEventListener('beforeunload', () => clearInterval(pollTimer));
  refreshConsole();
})();
