function isGameScene(sceneName) {
  const normalized = String(sceneName || '').trim();
  return normalized === '游戏内' || normalized.startsWith('游戏内.');
}

class SceneMusicController {
  constructor({ musicController }) {
    this.musicController = musicController;
    this.lastScene = null;
    this.queue = Promise.resolve();
  }

  setScene(sceneName) {
    const normalizedScene = String(sceneName || '').trim();
    if (!normalizedScene || normalizedScene === this.lastScene) return this.queue;
    this.lastScene = normalizedScene;
    const shouldPlay = isGameScene(normalizedScene);
    this.queue = this.queue.catch(() => {}).then(() => (
      this.musicController.action(shouldPlay ? 'play' : 'pause')
    ));
    return this.queue;
  }
}

module.exports = { isGameScene, SceneMusicController };
