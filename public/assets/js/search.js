(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZfbSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  let pinyinRequested = false;

  // 拼音库按需加载：首次搜索时注入脚本；注入后不再重复尝试，失败则保持纯归一化匹配
  function ensurePinyinLoaded() {
    if (pinyinRequested || root.pinyinPro || typeof document === 'undefined') return;
    pinyinRequested = true;
    const script = document.createElement('script');
    script.src = '/assets/vendor/pinyin-pro.js?v=3.28.2';
    script.defer = true;
    document.head.appendChild(script);
  }

  function normalize(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  function forms(value) {
    ensurePinyinLoaded();
    const text = String(value || '');
    const pinyinPro = root.pinyinPro;
    const result = new Set([normalize(text)]);
    if (!pinyinPro?.pinyin) return [...result];
    result.add(normalize(pinyinPro.pinyin(text, {
      toneType: 'none',
      pattern: 'pinyin',
      separator: '',
      nonZh: 'consecutive'
    })));
    result.add(normalize(pinyinPro.pinyin(text, {
      toneType: 'none',
      pattern: 'first',
      separator: '',
      nonZh: 'consecutive'
    })));
    return [...result].filter(Boolean);
  }

  function matches(value, query) {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return true;
    if (forms(value).some(form => form.includes(normalizedQuery))) return true;
    return Boolean(root.pinyinPro?.match?.(String(value || ''), normalizedQuery, {
      precision: 'any',
      continuous: false,
      insensitive: true
    }));
  }

  return { normalize, forms, matches };
});
