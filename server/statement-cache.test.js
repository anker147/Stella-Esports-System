const assert = require('node:assert/strict');
const test = require('node:test');

process.env.STELLA_DB_PATH = ':memory:';
const { cachedStatement, db } = require('./db');

test('cachedStatement reuses one compiled statement per unique SQL', () => {
  const first = cachedStatement('SELECT 1 AS one');
  const second = cachedStatement('SELECT 1 AS one');
  assert.equal(second, first);
  assert.equal(first.get().one, 1);
});

test('cachedStatement returns distinct statements for distinct SQL', () => {
  const a = cachedStatement('SELECT 1 AS cache_value');
  const b = cachedStatement('SELECT 2 AS cache_value');
  assert.notEqual(a, b);
  assert.equal(b.get().cache_value, 2);
});

test('cached statements execute against the shared database', () => {
  db.exec('CREATE TABLE IF NOT EXISTS cache_probe (id INTEGER PRIMARY KEY, label TEXT)');
  const insert = cachedStatement('INSERT INTO cache_probe (label) VALUES (?)');
  const inserted = insert.run('alpha');
  const select = cachedStatement('SELECT label FROM cache_probe WHERE id = ?');
  assert.equal(select.get(inserted.lastInsertRowid).label, 'alpha');
});
