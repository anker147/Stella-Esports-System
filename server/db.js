const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { DATA_ROOT } = require('./data-paths');

const SCHEMA_VERSION = 1;
const DB_PATH = process.env.STELLA_DB_PATH || path.join(DATA_ROOT, 'app.db');
const IN_MEMORY = DB_PATH === ':memory:';

if (!IN_MEMORY) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
if (!IN_MEMORY) db.exec('PRAGMA journal_mode = WAL');

const SCHEMA_OBJECTS = [
  'v_team_candidates',
  'obs_operation_logs', 'hub_states', 'bp_presentation_state', 'asset_path_validation',
  'asset_path_sync_records', 'asset_path_syncs', 'material_excluded_paths', 'material_watched_folders',
  'material_entries', 'bp_forfeit_events', 'bp_forfeits', 'bp_session_history', 'bp_session_results',
  'bp_session_slots', 'bp_sessions', 'bp_ui_sections', 'bp_phase_slots', 'bp_phases', 'bp_slots',
  'characters', 'match_rooms', 'match_participants', 'matches', 'players', 'team_logos', 'event_teams',
  'teams', 'events', 'app_settings', 'users'
];

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  division TEXT NOT NULL,
  stage TEXT NOT NULL,
  stage_label TEXT,
  date TEXT,
  mode TEXT,
  format TEXT,
  schedule_image TEXT,
  stage_image TEXT,
  schedule_table_image TEXT,
  source_workbook TEXT,
  source_workbook_sha256 TEXT,
  role_rules_json TEXT,
  integrity_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  source_rows TEXT,
  aliases_json TEXT
);

CREATE TABLE IF NOT EXISTS event_teams (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, team_id)
);

CREATE TABLE IF NOT EXISTS team_logos (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('escape', 'hunter')),
  obs_file TEXT,
  web_file TEXT,
  sha256 TEXT,
  PRIMARY KEY (team_id, kind)
);

CREATE TABLE IF NOT EXISTS players (
  player_id TEXT NOT NULL PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('escape', 'hunter')),
  slot TEXT NOT NULL,
  nickname TEXT,
  official_id TEXT UNIQUE,
  registered_nickname TEXT,
  registered_official_id TEXT,
  is_substitute INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_row INTEGER,
  date TEXT,
  start_time TEXT,
  end_time TEXT,
  mode TEXT,
  format TEXT,
  matchup_home TEXT,
  matchup_away TEXT,
  winner_team_id TEXT REFERENCES teams(id),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_matches_event ON matches(event_id);

CREATE TABLE IF NOT EXISTS match_participants (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  ref_type TEXT NOT NULL CHECK (ref_type IN ('team', 'winner_of', 'loser_of')),
  team_id TEXT REFERENCES teams(id),
  from_match_id TEXT REFERENCES matches(id),
  outcome TEXT CHECK (outcome IN ('winner', 'loser')),
  PRIMARY KEY (match_id, slot)
);

CREATE TABLE IF NOT EXISTS match_rooms (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  room TEXT NOT NULL CHECK (room IN ('A', 'B')),
  escape_team_id TEXT NOT NULL REFERENCES teams(id),
  hunter_team_id TEXT NOT NULL REFERENCES teams(id),
  PRIMARY KEY (match_id, room)
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('escape', 'hunter')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bp_slots (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ban', 'pick')),
  role TEXT NOT NULL CHECK (role IN ('escape', 'hunter')),
  image_source TEXT,
  text_source TEXT,
  image_group TEXT,
  text_group TEXT,
  group_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bp_phases (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER
);

CREATE TABLE IF NOT EXISTS bp_phase_slots (
  phase_id TEXT NOT NULL REFERENCES bp_phases(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL REFERENCES bp_slots(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (phase_id, slot_id)
);

CREATE TABLE IF NOT EXISTS bp_ui_sections (
  kind TEXT NOT NULL,
  slot_id TEXT NOT NULL REFERENCES bp_slots(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, slot_id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'developer', 'operator', 'user')),
  permissions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bp_sessions (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id),
  game_number INTEGER NOT NULL,
  room TEXT NOT NULL CHECK (room IN ('A', 'B')),
  attempt INTEGER NOT NULL DEFAULT 1,
  replay_of TEXT REFERENCES bp_sessions(id),
  output_mode TEXT NOT NULL DEFAULT 'nickname' CHECK (output_mode IN ('nickname', 'character')),
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'active', 'completed', 'replay', 'forfeited')),
  current_phase_index INTEGER NOT NULL DEFAULT -1,
  commentator_image_id TEXT,
  commentator_image_name TEXT,
  timer_duration_seconds INTEGER NOT NULL DEFAULT 30,
  timer_remaining_seconds INTEGER NOT NULL DEFAULT 30,
  timer_running INTEGER NOT NULL DEFAULT 0,
  timer_deadline_ms INTEGER,
  timer_transition_pending INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE (match_id, game_number, room, attempt)
);
CREATE INDEX IF NOT EXISTS idx_bp_sessions_match ON bp_sessions(match_id);
CREATE INDEX IF NOT EXISTS idx_bp_sessions_status ON bp_sessions(status);

CREATE TABLE IF NOT EXISTS bp_session_slots (
  session_id TEXT NOT NULL REFERENCES bp_sessions(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL REFERENCES bp_slots(id),
  character_id TEXT REFERENCES characters(id),
  player_id TEXT REFERENCES players(player_id),
  player_text TEXT,
  PRIMARY KEY (session_id, slot_id)
);

CREATE TABLE IF NOT EXISTS bp_session_results (
  session_id TEXT PRIMARY KEY REFERENCES bp_sessions(id) ON DELETE CASCADE,
  winner_role TEXT NOT NULL CHECK (winner_role IN ('escape', 'hunter')),
  winner_team_id TEXT NOT NULL REFERENCES teams(id),
  decided_at INTEGER NOT NULL,
  image_file_name TEXT,
  image_file_path TEXT,
  image_uploaded_at INTEGER
);

CREATE TABLE IF NOT EXISTS bp_session_history (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES bp_sessions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  snapshot_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_bp_history_session ON bp_session_history(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_bp_history_time ON bp_session_history(timestamp_ms);

CREATE TABLE IF NOT EXISTS bp_forfeits (
  match_id TEXT NOT NULL REFERENCES matches(id),
  room TEXT NOT NULL CHECK (room IN ('A', 'B')),
  forfeiting_team_id TEXT NOT NULL REFERENCES teams(id),
  winner_team_id TEXT NOT NULL REFERENCES teams(id),
  active INTEGER NOT NULL DEFAULT 1,
  declared_at INTEGER NOT NULL,
  revoked_at INTEGER,
  session_states_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (match_id, room)
);

CREATE TABLE IF NOT EXISTS bp_forfeit_events (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  room TEXT NOT NULL,
  seq INTEGER NOT NULL,
  action TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  forfeiting_team_id TEXT,
  winner_team_id TEXT,
  PRIMARY KEY (match_id, room, seq)
);

CREATE TABLE IF NOT EXISTS material_entries (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'directory')),
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_material_entries_kind ON material_entries(kind);

CREATE TABLE IF NOT EXISTS material_watched_folders (
  path TEXT PRIMARY KEY,
  added_at INTEGER
);

CREATE TABLE IF NOT EXISTS material_excluded_paths (
  path TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS asset_path_syncs (
  id TEXT PRIMARY KEY,
  folder_id TEXT,
  target_root TEXT NOT NULL,
  canonical_root TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  rolled_back_at TEXT
);

CREATE TABLE IF NOT EXISTS asset_path_sync_records (
  sync_id TEXT NOT NULL REFERENCES asset_path_syncs(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  filter_name TEXT,
  setting_path TEXT NOT NULL,
  setting_tokens_json TEXT NOT NULL DEFAULT '[]',
  before TEXT,
  after TEXT
);

CREATE TABLE IF NOT EXISTS asset_path_validation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  valid INTEGER NOT NULL,
  folder_id TEXT,
  target_root TEXT,
  canonical_root TEXT,
  reference_count INTEGER,
  object_count INTEGER,
  missing_count INTEGER,
  records_json TEXT NOT NULL DEFAULT '[]',
  missing_json TEXT NOT NULL DEFAULT '[]',
  checked_at TEXT
);

CREATE TABLE IF NOT EXISTS bp_presentation_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  dynamic_enabled INTEGER NOT NULL DEFAULT 0,
  active_session_id TEXT,
  sequence INTEGER NOT NULL DEFAULT 0,
  intro_epoch INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'hidden',
  play_at INTEGER,
  command_expires_at INTEGER,
  reason TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS hub_states (
  hub_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'duration',
  duration_seconds INTEGER,
  target_at TEXT,
  remaining_seconds INTEGER NOT NULL DEFAULT 0,
  running INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  deadline_ms INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS obs_operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp_ms INTEGER NOT NULL,
  label TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  category TEXT NOT NULL DEFAULT 'obs'
);
CREATE INDEX IF NOT EXISTS idx_obs_logs_time ON obs_operation_logs(timestamp_ms);

CREATE VIEW IF NOT EXISTS v_team_candidates AS
SELECT team_id, role, player_id, nickname, official_id, slot
FROM players
ORDER BY team_id, role, slot;
`;

const currentVersion = db.prepare('PRAGMA user_version').get().user_version;
if (currentVersion > SCHEMA_VERSION) {
  throw new Error(`数据库版本 ${currentVersion} 高于当前程序支持的 ${SCHEMA_VERSION}，已拒绝启动以保护数据`);
}
if (currentVersion === 0) {
  db.exec(SCHEMA_DDL);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
} else {
  // 同版本内新增对象必须保持 IF NOT EXISTS；绝不删除现有用户数据。
  db.exec(SCHEMA_DDL);
}

// users 表为 SCHEMA_VERSION=1 之后的同版本增量新增，对既有库直接补建。
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'developer', 'operator', 'user')),
  permissions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`);

function withTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  SCHEMA_VERSION,
  DB_PATH,
  IN_MEMORY,
  db,
  withTransaction
};
