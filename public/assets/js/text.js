// 界面文案加载器：所有可修改文字集中在 assets/data/ui-text.json。
// 同步加载以保证后续脚本的 t() 立即可用（本地文件，体积小）。
(function () {
  let data = null;
  try {
    const request = new XMLHttpRequest();
    request.open('GET', `/assets/data/ui-text.json?t=${Date.now()}`, false);
    request.send(null);
    if (request.status === 200 || request.status === 0) {
      data = JSON.parse(request.responseText);
    }
  } catch (error) {
    data = null;
  }
  window.UI_TEXT = data && typeof data === 'object' ? data : {};

  // t('key') / t('key', {name: value})，占位符写作 {name}
  window.t = function (key, params) {
    let text = window.UI_TEXT[key];
    if (text === undefined) return key;
    if (params) {
      for (const name of Object.keys(params)) {
        text = text.split(`{${name}}`).join(String(params[name]));
      }
    }
    return text;
  };

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-text]').forEach(el => {
      const value = window.UI_TEXT[el.dataset.text];
      if (value !== undefined) el.textContent = value;
    });
    scope.querySelectorAll('[data-text-placeholder]').forEach(el => {
      const value = window.UI_TEXT[el.dataset.textPlaceholder];
      if (value !== undefined) el.setAttribute('placeholder', value);
    });
    scope.querySelectorAll('[data-text-title]').forEach(el => {
      const value = window.UI_TEXT[el.dataset.textTitle];
      if (value !== undefined) {
        el.setAttribute('title', value);
        el.setAttribute('aria-label', value);
      }
    });
    scope.querySelectorAll('[data-text-aria]').forEach(el => {
      const value = window.UI_TEXT[el.dataset.textAria];
      if (value !== undefined) el.setAttribute('aria-label', value);
    });
  }

  window.PageText = { apply };
  apply(document);
})();
