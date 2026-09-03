const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

function runImport(directory, dbPath) {
  return spawnSync(process.execPath, ['-e', `
    require('./server/db-migrate').importCharacterProfiles();
    require('./server/db').db.close();
  `], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      STELLA_DATA_DIR: directory,
      STELLA_DB_PATH: dbPath
    },
    encoding: 'utf8',
    windowsHide: true
  });
}

function runChangeImport(directory, dbPath) {
  return spawnSync(process.execPath, ['-e', `
    require('./server/db-migrate').importCharacterProfiles();
    require('./server/db-migrate').importCharacterChangeHistory();
    require('./server/db').db.close();
  `], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      STELLA_DATA_DIR: directory,
      STELLA_DB_PATH: dbPath
    },
    encoding: 'utf8',
    windowsHide: true
  });
}

test('character profile seed imports once into normalized database tables', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-character-profile-'));
  const dbPath = path.join(directory, 'app.db');
  const seedPath = path.join(directory, 'character-profile-data.json');
  let database = null;
  try {
    fs.writeFileSync(seedPath, JSON.stringify({
      schemaVersion: 1,
      source: 'test.xlsx',
      characters: [{
        id: '测试角色',
        role: 'escape',
        name: '数据库姓名',
        releaseDate: 45112,
        skills: [{ name: '测试技能', description: '测试描述' }]
      }]
    }), 'utf8');

    const first = runImport(directory, dbPath);
    assert.equal(first.status, 0, first.stderr || first.stdout);

    database = new DatabaseSync(dbPath);
    assert.deepEqual({
      ...database.prepare(`SELECT display_name, release_date_text, portrait_url
        FROM characters WHERE id = '测试角色'`).get()
    }, {
      display_name: '数据库姓名',
      release_date_text: '2023年7月5日',
      portrait_url: '/assets/characters/ban/%E6%B5%8B%E8%AF%95%E8%A7%92%E8%89%B2.png?v=2'
    });
    assert.deepEqual({
      ...database.prepare(`SELECT slot, name, description, icon_url
        FROM character_skills WHERE character_id = '测试角色'`).get()
    }, {
      slot: 1,
      name: '测试技能',
      description: '测试描述',
      icon_url: null
    });
    assert(database.prepare(
      "SELECT 1 FROM app_settings WHERE key = 'migration.characterProfiles.v1'"
    ).get());
    database.prepare("UPDATE characters SET display_name = '人工维护姓名' WHERE id = '测试角色'").run();
    database.close();
    database = null;

    const second = runImport(directory, dbPath);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    database = new DatabaseSync(dbPath);
    assert.equal(
      database.prepare("SELECT display_name FROM characters WHERE id = '测试角色'").get().display_name,
      '人工维护姓名'
    );
  } finally {
    database?.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('character change history seed imports every dated adjustment once', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zfb-character-history-'));
  const dbPath = path.join(directory, 'app.db');
  let database = null;
  try {
    fs.writeFileSync(path.join(directory, 'character-profile-data.json'), JSON.stringify({
      schemaVersion: 1,
      characters: [{ id: '测试角色', role: 'hunter', name: '测试姓名', skills: [] }]
    }), 'utf8');
    fs.writeFileSync(path.join(directory, 'character-change-history.json'), JSON.stringify({
      schemaVersion: 1,
      source: 'test.xlsx',
      characters: [{
        id: '测试角色',
        changes: [
          { date: '2025-06-26', title: '最近调整', content: '最近内容' },
          { date: '2025-01-16', title: '较早调整', content: '较早内容' }
        ]
      }]
    }), 'utf8');

    const first = runChangeImport(directory, dbPath);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const second = runChangeImport(directory, dbPath);
    assert.equal(second.status, 0, second.stderr || second.stdout);

    database = new DatabaseSync(dbPath);
    assert.deepEqual(database.prepare(`SELECT changed_on, title, content
      FROM character_change_history ORDER BY changed_on DESC`).all().map(row => ({ ...row })), [
      { changed_on: '2025-06-26', title: '最近调整', content: '最近内容' },
      { changed_on: '2025-01-16', title: '较早调整', content: '较早内容' }
    ]);
    assert(database.prepare(
      "SELECT 1 FROM app_settings WHERE key = 'migration.characterChangeHistory.v1'"
    ).get());
  } finally {
    database?.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
