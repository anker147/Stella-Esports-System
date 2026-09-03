const assert = require('node:assert/strict');
const test = require('node:test');
const { formatGeoRegion, needsLocalizedLookup, normalizeStoredRegion, providerGeoRegion } = require('./location-service');

test('Chinese regions use compact province and city names', () => {
  assert.equal(formatGeoRegion({ country: 'CN', region: '上海市', city: '上海' }), '上海市');
  assert.equal(formatGeoRegion({ country: '中国', region: '四川', city: '绵阳' }), '四川省绵阳市');
  assert.equal(formatGeoRegion({ country: 'China', region: 'Sichuan Sheng', city: 'Mianyang' }), '四川省绵阳市');
});

test('PCOnline provider fields are normalized without exposing carrier text', () => {
  assert.equal(providerGeoRegion({ pro: '四川省', proCode: '510000', city: '资阳市', addr: '四川省资阳市 电信' }), '四川省资阳市');
  assert.equal(providerGeoRegion({ pro: '', proCode: '999999', city: '', addr: '美国' }), '美国');
});

test('foreign regions retain explicit administrative separators', () => {
  assert.equal(formatGeoRegion({ country: 'United States', region: 'California', city: 'San Jose' }),
    'United States · California · San Jose');
  assert.equal(formatGeoRegion({ country: '美国', region: '加利福尼亚州', city: '圣何塞' }),
    '美国 · 加利福尼亚州 · 圣何塞');
});

test('English Chinese proxy data requests a localized lookup', () => {
  assert.equal(needsLocalizedLookup({ region: 'China · Sichuan Sheng · Chengdu' }), true);
  assert.equal(needsLocalizedLookup({ region: '四川省成都市' }), false);
  assert.equal(needsLocalizedLookup({ region: '未知地区' }), true);
});

test('stored English Chinese regions are repaired only when the translation is reliable', () => {
  assert.equal(normalizeStoredRegion('China · Sichuan Sheng · Mianyang'), '四川省绵阳市');
  assert.equal(normalizeStoredRegion('CN · 上海市 · 上海'), '上海市');
  assert.equal(normalizeStoredRegion('China · Sichuan Sheng · Unknown City'),
    'China · Sichuan Sheng · Unknown City');
});
