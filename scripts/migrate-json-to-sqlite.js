// 一次性/手动工具：将 data 目录下的旧 JSON 数据导入 SQLite（data/app.db）。
// 服务启动时会自动执行同样的迁移；本脚本用于显式运行与核对结果。
const { migrateLegacyData } = require('../server/db-migrate');
const { db } = require('../server/db');

const result = migrateLegacyData();
console.log(JSON.stringify(result, null, 2));

const counts = {};
for (const table of ['events', 'teams', 'players', 'matches', 'characters', 'bp_slots', 'bp_phases',
  'bp_sessions', 'bp_session_slots', 'bp_session_results', 'bp_session_history',
  'bp_forfeits', 'material_entries', 'app_settings', 'obs_operation_logs']) {
  counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}
console.log('--- 当前库内计数 ---');
console.log(JSON.stringify(counts, null, 2));
