// 界面文案加载器：所有可修改文字集中在 assets/data/ui-text.json。
// 异步加载（defer 下不阻塞解析与首绘）：t()/text() 保持同步签名，
// 目录就绪前调用返回键名或兜底文案，就绪后返回目录值；
// 就绪时应用 data-text 并派发 stella:text-ready 事件。
// 目录内容变更时随发版递增 TEXT_DATA_VERSION。
(function () {
  const TEXT_DATA_VERSION = 8;
  let data = null;
  const ready = fetch(`/assets/data/ui-text.json?v=${TEXT_DATA_VERSION}`, { credentials: 'same-origin' })
    .then(response => (response.ok ? response.json() : {}))
    .then(payload => {
      data = payload && typeof payload === 'object' ? payload : {};
    })
    .catch(() => {
      data = {};
    });

  function interpolate(template, params) {
    let text = template;
    if (params) {
      for (const name of Object.keys(params)) {
        text = text.split(`{${name}}`).join(String(params[name]));
      }
    }
    return text;
  }

  window.t = function (key, params) {
    const value = data && data[key];
    if (value === undefined) return key;
    return interpolate(value, params);
  };

  // 兜底取词助手：text(键名, 兜底文案, 插值参数)。
  // 目录命中优先，键缺失回退兜底文案（同样做插值），任意模块可直接复用。
  window.text = function (key, fallback, params) {
    const value = data && data[key];
    if (value === undefined) return interpolate(fallback, params);
    return interpolate(value, params);
  };

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-text]').forEach(el => {
      const value = data && data[el.dataset.text];
      if (value === undefined) return;
      // 宿主必须是纯文本节点：textContent 赋值会清掉全部子元素，
      // 含 svg/img 等图标子元素时跳过替换并告警，防止目录应用吃掉图标
      if (el.children.length > 0) {
        console.warn(`[text] data-text 宿主含子元素，已跳过替换（防图标丢失）: ${el.dataset.text}`);
        return;
      }
      el.textContent = value;
    });
    scope.querySelectorAll('[data-text-placeholder]').forEach(el => {
      const value = data && data[el.dataset.textPlaceholder];
      if (value !== undefined) el.setAttribute('placeholder', value);
    });
    scope.querySelectorAll('[data-text-title]').forEach(el => {
      const value = data && data[el.dataset.textTitle];
      if (value !== undefined) {
        el.setAttribute('title', value);
        el.setAttribute('aria-label', value);
      }
    });
    scope.querySelectorAll('[data-text-aria]').forEach(el => {
      const value = data && data[el.dataset.textAria];
      if (value !== undefined) el.setAttribute('aria-label', value);
    });
  }

  window.PageText = { apply };
  window.Text = {
    ready: ready.then(() => {
      window.UI_TEXT = data || {};
      apply(document);
      document.dispatchEvent(new CustomEvent('stella:text-ready'));
    })
  };
})();
