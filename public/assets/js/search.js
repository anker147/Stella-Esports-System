(function (root, factory) {
  const api = factory(root.pinyinPro);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZfbSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (pinyinPro) {
  function normalize(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, '');
  }

  function forms(value) {
    const text = String(value || '');
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
    return Boolean(pinyinPro?.match?.(String(value || ''), normalizedQuery, {
      precision: 'any',
      continuous: false,
      insensitive: true
    }));
  }

  return { normalize, forms, matches };
});
