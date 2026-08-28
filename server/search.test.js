const assert = require('node:assert/strict');
const test = require('node:test');

globalThis.pinyinPro = require('../public/assets/vendor/pinyin-pro.js');
const { matches } = require('../public/assets/js/search.js');

test('search supports Chinese, full pinyin, initials and fuzzy substrings', () => {
  assert.equal(matches('失忆者', '失忆'), true);
  assert.equal(matches('失忆者', 'shiyizhe'), true);
  assert.equal(matches('失忆者', 'syz'), true);
  assert.equal(matches('失忆者', 'yiz'), true);
  assert.equal(matches('失忆者', 'moshi'), false);
});

test('search keeps mixed player nicknames and numeric IDs searchable', () => {
  assert.equal(matches('JM丶暴君 21522348', 'baojun'), true);
  assert.equal(matches('JM丶暴君 21522348', 'jmbj'), true);
  assert.equal(matches('JM丶暴君 21522348', '21522348'), true);
});
