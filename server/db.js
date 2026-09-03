const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATA_ROOT } = require('./data-paths');

const SCHEMA_VERSION = 23;
const DB_PATH = process.env.STELLA_DB_PATH || path.join(DATA_ROOT, 'app.db');
const IN_MEMORY = DB_PATH === ':memory:';

if (!IN_MEMORY) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA foreign_keys = ON');
if (!IN_MEMORY) db.exec('PRAGMA journal_mode = WAL');

const SCHEMA_OBJECTS = [
  'v_team_candidates',
  'notification_recipients', 'notifications',
  'obs_operation_logs', 'account_operation_logs', 'user_title_requests', 'user_presence',
  'user_permission_overrides', 'identity_permission_policies', 'user_identity_assignments',
  'countdown_event_logs', 'hub_states', 'bp_presentation_state', 'asset_path_validation',
  'asset_path_sync_records', 'asset_path_syncs', 'material_excluded_paths', 'material_watched_folders',
  'material_entries', 'bp_forfeit_events', 'bp_forfeits', 'bp_session_history', 'bp_session_results',
  'bp_session_slots', 'bp_sessions', 'bp_ui_sections', 'bp_phase_slots', 'bp_phases', 'bp_slots',
  'character_change_history', 'character_skill_icons', 'character_portraits', 'character_skills', 'characters', 'match_rooms', 'match_participants', 'matches', 'players', 'team_logos', 'event_teams',
  'event_media', 'event_management_profiles', 'teams', 'events', 'user_game_history', 'user_event_history', 'user_duty_logs',
  'communication_message_plus_ones', 'communication_message_deletions', 'communication_message_edits',
  'communication_messages', 'communication_channel_observers', 'communication_channel_members', 'communication_channels',
  'user_login_history', 'user_relationships', 'user_profile_stat_visibility', 'user_profile_covers',
  'user_profile_quick_links', 'user_avatars', 'user_profiles', 'app_settings', 'users'
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
  exclude_from_character_stats INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS event_management_profiles (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  max_teams INTEGER CHECK (max_teams IS NULL OR max_teams BETWEEN 2 AND 128),
  event_type TEXT NOT NULL DEFAULT 'private' CHECK (event_type IN ('private', 'public')),
  require_real_name INTEGER NOT NULL DEFAULT 0 CHECK (require_real_name IN (0, 1)),
  visibility TEXT NOT NULL DEFAULT 'system' CHECK (visibility IN ('system', 'participants', 'invite_only')),
  registration_method TEXT NOT NULL DEFAULT 'invite' CHECK (registration_method IN ('invite', 'manual', 'closed')),
  team_requirement TEXT NOT NULL DEFAULT 'any' CHECK (team_requirement IN ('any', 'club', 'organization')),
  start_date TEXT,
  end_date TEXT,
  registration_start TEXT,
  registration_end TEXT,
  min_team_members INTEGER CHECK (min_team_members IS NULL OR min_team_members BETWEEN 1 AND 99),
  max_team_members INTEGER CHECK (max_team_members IS NULL OR max_team_members BETWEEN 1 AND 99),
  require_system_login INTEGER NOT NULL DEFAULT 1 CHECK (require_system_login IN (0, 1)),
  organizer_type TEXT NOT NULL DEFAULT 'personal' CHECK (organizer_type IN ('personal', 'organization')),
  organizer_name TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  rules_text TEXT NOT NULL DEFAULT '',
  manual_status TEXT CHECK (manual_status IS NULL OR manual_status IN ('live', 'completed')),
  marked INTEGER NOT NULL DEFAULT 0 CHECK (marked IN (0, 1)),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_media (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('logo', 'cover')),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data BLOB NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 4194304),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, kind)
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
  enabled INTEGER NOT NULL DEFAULT 1,
  nickname TEXT,
  display_name TEXT,
  release_date_text TEXT,
  portrait_url TEXT
);

CREATE TABLE IF NOT EXISTS character_skills (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot > 0),
  name TEXT,
  description TEXT,
  icon_url TEXT,
  PRIMARY KEY (character_id, slot)
);

CREATE TABLE IF NOT EXISTS character_portraits (
  character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data BLOB NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 2097152),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_skill_icons (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data BLOB NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 524288),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (character_id, slot)
);

CREATE TABLE IF NOT EXISTS character_change_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  changed_on TEXT,
  title TEXT NOT NULL,
  content TEXT,
  source_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(character_id, changed_on, title)
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
  expires_at INTEGER,
  last_login_at INTEGER,
  last_login_ip_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 40),
  bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 160),
  default_page TEXT NOT NULL DEFAULT 'countdown'
    CHECK (default_page IN ('countdown', 'bp', 'bracket', 'materials', 'logs', 'updates', 'profile')),
  accent TEXT NOT NULL DEFAULT 'blue' CHECK (accent IN ('blue', 'green', 'purple', 'rose')),
  layout TEXT NOT NULL DEFAULT 'comfortable' CHECK (layout IN ('comfortable', 'compact')),
  greeting TEXT NOT NULL DEFAULT 'friendly' CHECK (greeting IN ('friendly', 'compact')),
  show_greeting INTEGER NOT NULL DEFAULT 1 CHECK (show_greeting IN (0, 1)),
  show_quick_links INTEGER NOT NULL DEFAULT 1 CHECK (show_quick_links IN (0, 1)),
  show_system_status INTEGER NOT NULL DEFAULT 1 CHECK (show_system_status IN (0, 1)),
  gender TEXT NOT NULL DEFAULT 'unspecified'
    CHECK (gender IN ('unspecified', 'male', 'female', 'other')),
  birth_date TEXT,
  region TEXT NOT NULL DEFAULT '未知地区' CHECK (length(region) <= 80),
  region_source TEXT NOT NULL DEFAULT 'login_ip'
    CHECK (region_source IN ('login_ip', 'proxy_geo', 'local', 'administrator')),
  identity_key TEXT NOT NULL DEFAULT 'guest'
    CHECK (identity_key IN ('developer', 'administrator', 'director', 'commentator', 'referee', 'scorer', 'guest')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_updated ON user_profiles(updated_at);

CREATE TABLE IF NOT EXISTS user_identity_assignments (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  identity_key TEXT NOT NULL
    CHECK (identity_key IN ('developer', 'administrator', 'director', 'commentator', 'referee', 'scorer', 'guest')),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 7),
  PRIMARY KEY (user_id, identity_key),
  UNIQUE (user_id, sort_order)
);
CREATE INDEX IF NOT EXISTS idx_user_identity_assignments_user ON user_identity_assignments(user_id, sort_order);

CREATE TABLE IF NOT EXISTS identity_permission_policies (
  identity_key TEXT NOT NULL
    CHECK (identity_key IN ('developer', 'administrator', 'director', 'commentator', 'referee', 'scorer', 'guest')),
  permission_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (identity_key, permission_key)
);

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('grant', 'deny')),
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_user ON user_permission_overrides(user_id, effect);

CREATE TABLE IF NOT EXISTS user_profile_quick_links (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page TEXT NOT NULL
    CHECK (page IN ('countdown', 'bp', 'bracket', 'materials', 'logs', 'updates', 'profile')),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 3),
  PRIMARY KEY (user_id, page),
  UNIQUE (user_id, sort_order)
);

CREATE TABLE IF NOT EXISTS user_avatars (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data BLOB NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 614400),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_avatars_updated ON user_avatars(updated_at);

CREATE TABLE IF NOT EXISTS user_profile_covers (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data BLOB NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 2097152),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_profile_covers_updated ON user_profile_covers(updated_at);

CREATE TABLE IF NOT EXISTS user_profile_stat_visibility (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stat_key TEXT NOT NULL
    CHECK (stat_key IN ('duty_time', 'account_expiry', 'event_count', 'game_count')),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 3),
  PRIMARY KEY (user_id, stat_key),
  UNIQUE (user_id, sort_order)
);

CREATE TABLE IF NOT EXISTS user_relationships (
  user_low_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id),
  CHECK (requested_by = user_low_id OR requested_by = user_high_id)
);
CREATE INDEX IF NOT EXISTS idx_user_relationships_high ON user_relationships(user_high_id, status);

CREATE TABLE IF NOT EXISTS communication_channels (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('global', 'identity', 'private', 'custom')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 120),
  identity_key TEXT,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  private_key TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((kind = 'identity') = (identity_key IS NOT NULL)),
  CHECK ((kind = 'private') = (private_key IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_communication_channels_kind ON communication_channels(kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS communication_channel_members (
  channel_id TEXT NOT NULL REFERENCES communication_channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  last_read_message_id INTEGER NOT NULL DEFAULT 0 CHECK (last_read_message_id >= 0),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_communication_members_user ON communication_channel_members(user_id, channel_id);

CREATE TABLE IF NOT EXISTS communication_channel_observers (
  channel_id TEXT NOT NULL REFERENCES communication_channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  observed_at INTEGER NOT NULL,
  last_read_message_id INTEGER NOT NULL DEFAULT 0 CHECK (last_read_message_id >= 0),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_communication_observers_user
  ON communication_channel_observers(user_id, channel_id);

CREATE TABLE IF NOT EXISTS communication_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL REFERENCES communication_channels(id) ON DELETE CASCADE,
  sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  sender_display_name TEXT NOT NULL,
  sender_identity_key TEXT NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  recalled_at INTEGER,
  recalled_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  urgent INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_communication_messages_channel
  ON communication_messages(channel_id, id DESC);

CREATE TABLE IF NOT EXISTS communication_message_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES communication_messages(id) ON DELETE CASCADE,
  editor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_communication_message_edits_message
  ON communication_message_edits(message_id, id);

CREATE TABLE IF NOT EXISTS communication_message_deletions (
  message_id INTEGER NOT NULL REFERENCES communication_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_communication_message_deletions_user
  ON communication_message_deletions(user_id, message_id);

CREATE TABLE IF NOT EXISTS communication_message_plus_ones (
  message_id INTEGER NOT NULL REFERENCES communication_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_communication_message_plus_ones_message
  ON communication_message_plus_ones(message_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL
    CHECK (type IN ('message', 'urgent', 'friend_request', 'version', 'announcement')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 160),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 2000),
  urgent INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1)),
  source_kind TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  target_kind TEXT NOT NULL DEFAULT 'system'
    CHECK (target_kind IN ('all', 'identity', 'account', 'system')),
  target_value TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_identity_key TEXT NOT NULL DEFAULT 'system',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_source
  ON notifications(source_kind, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS notification_recipients (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at INTEGER,
  PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_notification_recipients_user
  ON notification_recipients(user_id, read_at, notification_id);

CREATE TABLE IF NOT EXISTS user_login_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_hash TEXT NOT NULL,
  ip_address TEXT NOT NULL DEFAULT 'unknown',
  region TEXT NOT NULL,
  device_fingerprint TEXT NOT NULL DEFAULT 'unknown',
  device_name TEXT NOT NULL DEFAULT '未知设备',
  user_agent TEXT NOT NULL DEFAULT '',
  logged_in_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_login_history_user ON user_login_history(user_id, logged_in_at DESC);

CREATE TABLE IF NOT EXISTS user_duty_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0)
);
CREATE INDEX IF NOT EXISTS idx_user_duty_logs_user ON user_duty_logs(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS user_event_history (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  first_executed_at INTEGER NOT NULL,
  last_executed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, event_id)
);

CREATE TABLE IF NOT EXISTS user_game_history (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES bp_sessions(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  executed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_user_game_history_user ON user_game_history(user_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS user_presence (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'offline'
    CHECK (status IN ('online', 'offline', 'away', 'working', 'busy')),
  manual_status TEXT
    CHECK (manual_status IS NULL OR manual_status IN ('online', 'offline', 'away', 'busy')),
  last_heartbeat_at INTEGER,
  last_activity_at INTEGER,
  activity_window_started_at INTEGER,
  activity_count INTEGER NOT NULL DEFAULT 0 CHECK (activity_count >= 0),
  working_context_id TEXT,
  working_started_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_presence_updated ON user_presence(updated_at);

CREATE TABLE IF NOT EXISTS user_title_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_title TEXT NOT NULL CHECK (length(requested_title) <= 40),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_title_requests_status ON user_title_requests(status, requested_at DESC);

CREATE TABLE IF NOT EXISTS account_operation_logs (
  id TEXT PRIMARY KEY,
  timestamp_ms INTEGER NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_display_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'account'
    CHECK (category IN ('event', 'account')),
  action TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  session_id TEXT,
  ip_address TEXT NOT NULL DEFAULT 'unknown',
  region TEXT NOT NULL DEFAULT '未知地区',
  device_fingerprint TEXT NOT NULL DEFAULT 'unknown',
  device_name TEXT NOT NULL DEFAULT '未知设备',
  user_agent TEXT NOT NULL DEFAULT '',
  actor_identity_key TEXT NOT NULL DEFAULT 'unknown',
  sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_account_operation_logs_time ON account_operation_logs(timestamp_ms DESC);

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
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_display_name TEXT NOT NULL DEFAULT '系统',
  actor_identity_key TEXT NOT NULL DEFAULT 'system',
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

CREATE TABLE IF NOT EXISTS countdown_event_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hub_id TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_display_name TEXT NOT NULL DEFAULT '系统',
  actor_identity_key TEXT NOT NULL DEFAULT 'system',
  action_type TEXT NOT NULL,
  action_label TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1 CHECK (success IN (0, 1)),
  error TEXT,
  session_id TEXT,
  ip_address TEXT NOT NULL DEFAULT 'unknown',
  region TEXT NOT NULL DEFAULT '未知地区',
  device_fingerprint TEXT NOT NULL DEFAULT 'unknown',
  device_name TEXT NOT NULL DEFAULT '未知设备',
  user_agent TEXT NOT NULL DEFAULT '',
  details_json TEXT NOT NULL DEFAULT '{}',
  before_state_json TEXT,
  after_state_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_countdown_event_logs_hub_time
  ON countdown_event_logs(hub_id, timestamp_ms DESC, id DESC);

CREATE TABLE IF NOT EXISTS obs_operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp_ms INTEGER NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_display_name TEXT NOT NULL DEFAULT '系统',
  actor_identity_key TEXT NOT NULL DEFAULT 'system',
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

const PROFILE_PAGES = new Set(['countdown', 'bp', 'bracket', 'materials', 'logs', 'updates', 'profile']);
const PROFILE_ACCENTS = new Set(['blue', 'green', 'purple', 'rose']);
const PROFILE_LAYOUTS = new Set(['comfortable', 'compact']);
const PROFILE_GREETINGS = new Set(['friendly', 'compact']);

function legacyChoice(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function legacyText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function legacyTimestamp(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function legacyAvatar(value) {
  const source = String(value || '');
  if (!source) return null;
  const match = source.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('旧个人资料中的头像格式无效');
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > 600 * 1024) throw new Error('旧个人资料中的头像数据无效');
  return {
    mimeType: match[1],
    data,
    byteSize: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex')
  };
}

function migrateUserProfilesV2() {
  const rows = db.prepare("SELECT key, value_json FROM app_settings WHERE key LIKE 'user.profile.%' ORDER BY key").all();
  if (!rows.length) return;
  const userExists = db.prepare('SELECT 1 FROM users WHERE id = ?');
  const upsertProfile = db.prepare(`INSERT INTO user_profiles
    (user_id, title, bio, default_page, accent, layout, greeting,
      show_greeting, show_quick_links, show_system_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      title = excluded.title, bio = excluded.bio, default_page = excluded.default_page,
      accent = excluded.accent, layout = excluded.layout, greeting = excluded.greeting,
      show_greeting = excluded.show_greeting, show_quick_links = excluded.show_quick_links,
      show_system_status = excluded.show_system_status, updated_at = excluded.updated_at`);
  const deleteLinks = db.prepare('DELETE FROM user_profile_quick_links WHERE user_id = ?');
  const insertLink = db.prepare(
    'INSERT INTO user_profile_quick_links (user_id, page, sort_order) VALUES (?, ?, ?)');
  const upsertAvatar = db.prepare(`INSERT INTO user_avatars
    (user_id, mime_type, data, byte_size, sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      mime_type = excluded.mime_type, data = excluded.data, byte_size = excluded.byte_size,
      sha256 = excluded.sha256, updated_at = excluded.updated_at`);
  const deleteSetting = db.prepare('DELETE FROM app_settings WHERE key = ?');

  for (const row of rows) {
    const userId = row.key.slice('user.profile.'.length);
    if (!userId || !userExists.get(userId)) continue;
    let saved;
    try {
      saved = JSON.parse(row.value_json);
    } catch {
      throw new Error(`旧个人资料无法解析: ${row.key}`);
    }
    const home = saved && typeof saved.home === 'object' ? saved.home : {};
    const updatedAt = legacyTimestamp(saved.updatedAt);
    upsertProfile.run(
      userId,
      legacyText(saved.title, 40),
      legacyText(saved.bio, 160),
      legacyChoice(home.defaultPage, PROFILE_PAGES, 'countdown'),
      legacyChoice(home.accent, PROFILE_ACCENTS, 'blue'),
      legacyChoice(home.layout, PROFILE_LAYOUTS, 'comfortable'),
      legacyChoice(home.greeting, PROFILE_GREETINGS, 'friendly'),
      home.showGreeting === false ? 0 : 1,
      home.showQuickLinks === false ? 0 : 1,
      home.showSystemStatus === false ? 0 : 1,
      updatedAt,
      updatedAt
    );
    const quickLinks = [...new Set((Array.isArray(home.quickLinks) ? home.quickLinks : [])
      .filter(page => PROFILE_PAGES.has(page)))].slice(0, 4);
    const migratedLinks = quickLinks.length ? quickLinks : ['countdown', 'bp', 'materials', 'logs'];
    deleteLinks.run(userId);
    migratedLinks.forEach((page, index) => insertLink.run(userId, page, index));
    const avatar = legacyAvatar(saved.avatar);
    if (avatar) {
      upsertAvatar.run(userId, avatar.mimeType, avatar.data, avatar.byteSize, avatar.sha256, updatedAt, updatedAt);
    }
    deleteSetting.run(row.key);
  }
}

function tableHasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column);
}

function migrateAccountsV3() {
  const userColumns = [
    ['expires_at', 'INTEGER'],
    ['last_login_at', 'INTEGER'],
    ['last_login_ip_hash', 'TEXT']
  ];
  for (const [name, definition] of userColumns) {
    if (!tableHasColumn('users', name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
  }

  const profileColumns = [
    ['gender', "TEXT NOT NULL DEFAULT 'unspecified' CHECK (gender IN ('unspecified', 'male', 'female', 'other'))"],
    ['birth_date', 'TEXT'],
    ['region', "TEXT NOT NULL DEFAULT '未知地区' CHECK (length(region) <= 80)"],
    ['region_source', "TEXT NOT NULL DEFAULT 'login_ip' CHECK (region_source IN ('login_ip', 'proxy_geo', 'local', 'administrator'))"]
  ];
  for (const [name, definition] of profileColumns) {
    if (!tableHasColumn('user_profiles', name)) {
      db.exec(`ALTER TABLE user_profiles ADD COLUMN ${name} ${definition}`);
    }
  }

  const insertVisibility = db.prepare(
    'INSERT OR IGNORE INTO user_profile_stat_visibility (user_id, stat_key, sort_order) VALUES (?, ?, ?)');
  const users = db.prepare('SELECT id FROM users ORDER BY created_at, id').all();
  const defaults = ['duty_time', 'account_expiry', 'event_count', 'game_count'];
  for (const user of users) {
    defaults.forEach((key, index) => insertVisibility.run(user.id, key, index));
  }
}

function migrateProfileAccountsV4() {
  if (!tableHasColumn('user_profiles', 'identity_key')) {
    db.exec(`ALTER TABLE user_profiles ADD COLUMN identity_key TEXT NOT NULL DEFAULT 'operator'
      CHECK (identity_key IN ('developer', 'operator', 'director', 'commentator', 'technical', 'referee', 'analyst', 'guest'))`);
  }
  db.prepare(`UPDATE user_profiles SET identity_key = 'developer'
    WHERE user_id IN (SELECT id FROM users WHERE role IN ('developer', 'admin'))
      AND (identity_key IS NULL OR identity_key = '' OR identity_key = 'operator')`).run();
  const profileTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_profiles'").get()?.sql || '';
  if (profileTableSql.includes("'administrator'")) {
    db.prepare(`UPDATE user_profiles SET identity_key = 'administrator'
      WHERE user_id IN (SELECT id FROM users WHERE role = 'operator') AND identity_key = 'guest'`).run();
  }
  db.prepare(`UPDATE user_profiles SET identity_key = 'operator'
    WHERE identity_key IS NULL OR identity_key = ''`).run();
  db.prepare(`INSERT OR IGNORE INTO user_presence (user_id, status, updated_at)
    SELECT id, 'offline', updated_at FROM users`).run();
}

function migrateAuditActorsV5() {
  if (!tableHasColumn('account_operation_logs', 'category')) {
    db.exec(`ALTER TABLE account_operation_logs ADD COLUMN category TEXT NOT NULL DEFAULT 'account'
      CHECK (category IN ('event', 'account'))`);
  }
  if (!tableHasColumn('bp_session_history', 'actor_user_id')) {
    db.exec('ALTER TABLE bp_session_history ADD COLUMN actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL');
  }
  if (!tableHasColumn('bp_session_history', 'actor_display_name')) {
    db.exec("ALTER TABLE bp_session_history ADD COLUMN actor_display_name TEXT NOT NULL DEFAULT '系统'");
  }
  if (!tableHasColumn('obs_operation_logs', 'actor_user_id')) {
    db.exec('ALTER TABLE obs_operation_logs ADD COLUMN actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL');
  }
  if (!tableHasColumn('obs_operation_logs', 'actor_display_name')) {
    db.exec("ALTER TABLE obs_operation_logs ADD COLUMN actor_display_name TEXT NOT NULL DEFAULT '系统'");
  }
}

function migrateIdentityAssignmentsV6() {
  db.prepare(`INSERT OR IGNORE INTO user_identity_assignments (user_id, identity_key, sort_order)
    SELECT user_id, identity_key, 0 FROM user_profiles`).run();
}

function migrateRequestAuditV7() {
  const loginColumns = [
    ['ip_address', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['device_fingerprint', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['device_name', "TEXT NOT NULL DEFAULT '未知设备'"],
    ['user_agent', "TEXT NOT NULL DEFAULT ''"]
  ];
  for (const [name, definition] of loginColumns) {
    if (!tableHasColumn('user_login_history', name)) {
      db.exec(`ALTER TABLE user_login_history ADD COLUMN ${name} ${definition}`);
    }
  }

  const auditColumns = [
    ['session_id', 'TEXT'],
    ['ip_address', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['region', "TEXT NOT NULL DEFAULT '未知地区'"],
    ['device_fingerprint', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['device_name', "TEXT NOT NULL DEFAULT '未知设备'"],
    ['user_agent', "TEXT NOT NULL DEFAULT ''"]
  ];
  for (const [name, definition] of auditColumns) {
    if (!tableHasColumn('account_operation_logs', name)) {
      db.exec(`ALTER TABLE account_operation_logs ADD COLUMN ${name} ${definition}`);
    }
  }
}

function migratePresenceV8() {
  const columns = [
    ['manual_status', "TEXT CHECK (manual_status IS NULL OR manual_status IN ('online', 'offline', 'away', 'busy'))"],
    ['last_heartbeat_at', 'INTEGER'],
    ['last_activity_at', 'INTEGER'],
    ['activity_window_started_at', 'INTEGER'],
    ['activity_count', 'INTEGER NOT NULL DEFAULT 0 CHECK (activity_count >= 0)'],
    ['working_context_id', 'TEXT'],
    ['working_started_at', 'INTEGER']
  ];
  for (const [name, definition] of columns) {
    if (!tableHasColumn('user_presence', name)) {
      db.exec(`ALTER TABLE user_presence ADD COLUMN ${name} ${definition}`);
    }
  }
  db.prepare(`UPDATE user_presence SET
    manual_status = CASE WHEN status IN ('away', 'busy') THEN status ELSE NULL END,
    status = 'offline',
    last_heartbeat_at = NULL,
    last_activity_at = NULL,
    activity_window_started_at = NULL,
    activity_count = 0,
    working_context_id = NULL,
    working_started_at = NULL,
    updated_at = ?`).run(Date.now());
}

function migrateAuditIdentityV9() {
  const columns = [
    ['actor_identity_key', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['sensitive', 'INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1))']
  ];
  for (const [name, definition] of columns) {
    if (!tableHasColumn('account_operation_logs', name)) {
      db.exec(`ALTER TABLE account_operation_logs ADD COLUMN ${name} ${definition}`);
    }
  }
}

function migrateEventAuditIdentityV10() {
  for (const table of ['bp_session_history', 'obs_operation_logs']) {
    if (!tableHasColumn(table, 'actor_identity_key')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN actor_identity_key TEXT NOT NULL DEFAULT 'system'`);
    }
    db.exec(`UPDATE ${table} AS log SET actor_identity_key = CASE
      WHEN log.actor_user_id IS NULL THEN 'system'
      ELSE COALESCE((SELECT assignment.identity_key
        FROM user_identity_assignments AS assignment
        WHERE assignment.user_id = log.actor_user_id
        ORDER BY assignment.sort_order, assignment.identity_key
        LIMIT 1), 'operator')
      END
      WHERE log.actor_identity_key IS NULL OR log.actor_identity_key IN ('', 'unknown')`);
  }
}

function migratePermissionsV11() {
  const insert = db.prepare(`INSERT OR IGNORE INTO user_permission_overrides
    (user_id, permission_key, effect, updated_at, updated_by) VALUES (?, ?, 'grant', ?, NULL)`);
  const now = Date.now();
  for (const row of db.prepare('SELECT id, permissions_json FROM users').all()) {
    let permissions = [];
    try {
      permissions = JSON.parse(row.permissions_json || '[]');
    } catch {}
    for (const permission of Array.isArray(permissions) ? permissions : []) {
      if (permission && permission !== '*') insert.run(row.id, String(permission), now);
    }
  }
}

function seedCommunicationChannels() {
  const now = Date.now();
  const insert = db.prepare(`INSERT OR IGNORE INTO communication_channels
    (id, kind, name, description, identity_key, owner_user_id, private_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`);
  insert.run('global', 'global', '全局公聊', '面向所有已获通讯权限用户的公共频道。', null, now, now);
  const identities = [
    ['developer', '系统开发者'], ['administrator', '管理员'], ['director', '赛事导演'],
    ['commentator', '赛事解说'], ['referee', '裁判'], ['scorer', '记分员'], ['guest', '访客']
  ];
  for (const [key, label] of identities) {
    insert.run(`identity:${key}`, 'identity', `${label}公聊`, `仅当前使用${label}身份的用户可见。`, key, now, now);
  }
}

function migrateCommunicationMessagesV13() {
  const columns = [
    ['edited_at', 'INTEGER'],
    ['recalled_at', 'INTEGER'],
    ['recalled_by_user_id', 'TEXT REFERENCES users(id) ON DELETE SET NULL'],
    ['urgent', 'INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1))']
  ];
  for (const [name, definition] of columns) {
    if (!tableHasColumn('communication_messages', name)) {
      db.exec(`ALTER TABLE communication_messages ADD COLUMN ${name} ${definition}`);
    }
  }
}

function migrateCharacterProfilesV15() {
  const columns = [
    ['display_name', 'TEXT'],
    ['release_date_text', 'TEXT'],
    ['portrait_url', 'TEXT']
  ];
  for (const [name, definition] of columns) {
    if (!tableHasColumn('characters', name)) {
      db.exec(`ALTER TABLE characters ADD COLUMN ${name} ${definition}`);
    }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS character_skills (
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL CHECK (slot > 0),
    name TEXT,
    description TEXT,
    icon_url TEXT,
    PRIMARY KEY (character_id, slot)
  )`);
}

function migrateIdentityCatalogV20() {
  const now = Date.now();
  db.exec(`CREATE TABLE user_identity_assignments_v20 (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    identity_key TEXT NOT NULL
      CHECK (identity_key IN ('developer', 'administrator', 'director', 'commentator', 'referee', 'scorer', 'guest')),
    sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 7),
    PRIMARY KEY (user_id, identity_key),
    UNIQUE (user_id, sort_order)
  )`);
  db.exec(`INSERT INTO user_identity_assignments_v20 (user_id, identity_key, sort_order)
    SELECT user_id, CASE identity_key WHEN 'operator' THEN 'administrator' ELSE identity_key END, sort_order
    FROM user_identity_assignments
    WHERE identity_key NOT IN ('technical', 'analyst')`);
  db.exec(`INSERT INTO user_identity_assignments_v20 (user_id, identity_key, sort_order)
    SELECT users.id, 'guest', 0 FROM users
    WHERE NOT EXISTS (SELECT 1 FROM user_identity_assignments_v20 WHERE user_id = users.id)`);

  db.exec(`CREATE TABLE identity_permission_policies_v20 (
    identity_key TEXT NOT NULL
      CHECK (identity_key IN ('developer', 'administrator', 'director', 'commentator', 'referee', 'scorer', 'guest')),
    permission_key TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    updated_at INTEGER NOT NULL,
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (identity_key, permission_key)
  )`);
  db.exec(`INSERT INTO identity_permission_policies_v20
      (identity_key, permission_key, enabled, updated_at, updated_by)
    SELECT CASE identity_key WHEN 'operator' THEN 'administrator' ELSE identity_key END,
      permission_key, enabled, updated_at, updated_by
    FROM identity_permission_policies
    WHERE identity_key NOT IN ('technical', 'analyst')`);

  db.exec(`CREATE TABLE user_profiles_v20 (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 40),
    bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 160),
    default_page TEXT NOT NULL DEFAULT 'countdown'
      CHECK (default_page IN ('countdown', 'bp', 'bracket', 'materials', 'logs', 'updates', 'profile')),
    accent TEXT NOT NULL DEFAULT 'blue' CHECK (accent IN ('blue', 'green', 'purple', 'rose')),
    layout TEXT NOT NULL DEFAULT 'comfortable' CHECK (layout IN ('comfortable', 'compact')),
    greeting TEXT NOT NULL DEFAULT 'friendly' CHECK (greeting IN ('friendly', 'compact')),
    show_greeting INTEGER NOT NULL DEFAULT 1 CHECK (show_greeting IN (0, 1)),
    show_quick_links INTEGER NOT NULL DEFAULT 1 CHECK (show_quick_links IN (0, 1)),
    show_system_status INTEGER NOT NULL DEFAULT 1 CHECK (show_system_status IN (0, 1)),
    gender TEXT NOT NULL DEFAULT 'unspecified'
      CHECK (gender IN ('unspecified', 'male', 'female', 'other')),
    birth_date TEXT,
    region TEXT NOT NULL DEFAULT '未知地区' CHECK (length(region) <= 80),
    region_source TEXT NOT NULL DEFAULT 'login_ip'
      CHECK (region_source IN ('login_ip', 'proxy_geo', 'local', 'administrator')),
    identity_key TEXT NOT NULL DEFAULT 'guest'
      CHECK (identity_key IN ('developer', 'administrator', 'director', 'commentator', 'referee', 'scorer', 'guest')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.exec(`INSERT INTO user_profiles_v20
      (user_id, title, bio, default_page, accent, layout, greeting, show_greeting,
        show_quick_links, show_system_status, gender, birth_date, region, region_source,
        identity_key, created_at, updated_at)
    SELECT profile.user_id, profile.title, profile.bio, profile.default_page, profile.accent,
      profile.layout, profile.greeting, profile.show_greeting, profile.show_quick_links,
      profile.show_system_status, profile.gender, profile.birth_date, profile.region,
      profile.region_source,
      COALESCE((SELECT assignment.identity_key FROM user_identity_assignments_v20 AS assignment
        WHERE assignment.user_id = profile.user_id
        ORDER BY assignment.sort_order, assignment.identity_key LIMIT 1), 'guest'),
      profile.created_at, profile.updated_at
    FROM user_profiles AS profile`);

  db.exec('DROP TABLE user_profiles');
  db.exec('DROP TABLE user_identity_assignments');
  db.exec('DROP TABLE identity_permission_policies');
  db.exec('ALTER TABLE user_profiles_v20 RENAME TO user_profiles');
  db.exec('ALTER TABLE user_identity_assignments_v20 RENAME TO user_identity_assignments');
  db.exec('ALTER TABLE identity_permission_policies_v20 RENAME TO identity_permission_policies');
  db.exec('CREATE INDEX idx_user_profiles_updated ON user_profiles(updated_at)');
  db.exec('CREATE INDEX idx_user_identity_assignments_user ON user_identity_assignments(user_id, sort_order)');

  db.exec(`UPDATE users SET role = CASE
    WHEN role = 'developer' THEN 'developer'
    WHEN EXISTS (SELECT 1 FROM user_identity_assignments
      WHERE user_identity_assignments.user_id = users.id
        AND user_identity_assignments.identity_key = 'administrator') THEN 'admin'
    ELSE 'user' END`);
  db.prepare(`UPDATE communication_channels SET
    identity_key = 'administrator', name = '管理员公聊',
    description = '仅当前使用管理员身份的用户可见。', updated_at = ?
    WHERE kind = 'identity' AND identity_key = 'operator'`).run(now);
  db.prepare(`UPDATE communication_channels SET
    kind = 'custom', identity_key = NULL, name = '[历史] ' || name,
    description = '对应身份已停用，仅保留历史消息供开发者审计。', updated_at = ?
    WHERE kind = 'identity' AND identity_key IN ('technical', 'analyst')`).run(now);
  for (const [table, column] of [
    ['account_operation_logs', 'actor_identity_key'],
    ['countdown_event_logs', 'actor_identity_key'],
    ['bp_session_history', 'actor_identity_key'],
    ['obs_operation_logs', 'actor_identity_key'],
    ['communication_messages', 'sender_identity_key'],
    ['notifications', 'created_by_identity_key']
  ]) {
    db.exec(`UPDATE ${table} SET ${column} = 'administrator' WHERE ${column} = 'operator'`);
  }
}

const currentVersion = db.prepare('PRAGMA user_version').get().user_version;
if (currentVersion > SCHEMA_VERSION) {
  throw new Error(`数据库版本 ${currentVersion} 高于当前程序支持的 ${SCHEMA_VERSION}，已拒绝启动以保护数据`);
}
if (currentVersion === 0) {
  db.exec(SCHEMA_DDL);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
} else {
  db.exec(SCHEMA_DDL);
  if (currentVersion < 2) {
    withTransaction(() => {
      migrateUserProfilesV2();
      db.exec('PRAGMA user_version = 2');
    });
  }
  if (currentVersion < 3) {
    withTransaction(() => {
      migrateAccountsV3();
      db.exec('PRAGMA user_version = 3');
    });
  }
  if (currentVersion < 4) {
    withTransaction(() => {
      migrateProfileAccountsV4();
      db.exec('PRAGMA user_version = 4');
    });
  }
  if (currentVersion < 5) {
    withTransaction(() => {
      migrateAuditActorsV5();
      db.exec('PRAGMA user_version = 5');
    });
  }
  if (currentVersion < 6) {
    withTransaction(() => {
      migrateIdentityAssignmentsV6();
      db.exec('PRAGMA user_version = 6');
    });
  }
  if (currentVersion < 7) {
    withTransaction(() => {
      migrateRequestAuditV7();
      db.exec('PRAGMA user_version = 7');
    });
  }
  if (currentVersion < 8) {
    withTransaction(() => {
      migratePresenceV8();
      db.exec('PRAGMA user_version = 8');
    });
  }
  if (currentVersion < 9) {
    withTransaction(() => {
      migrateAuditIdentityV9();
      db.exec('PRAGMA user_version = 9');
    });
  }
  if (currentVersion < 10) {
    withTransaction(() => {
      migrateEventAuditIdentityV10();
      db.exec('PRAGMA user_version = 10');
    });
  }
  if (currentVersion < 11) {
    withTransaction(() => {
      migratePermissionsV11();
      db.exec('PRAGMA user_version = 11');
    });
  }
  if (currentVersion < 12) {
    withTransaction(() => {
      seedCommunicationChannels();
      db.exec('PRAGMA user_version = 12');
    });
  }
  if (currentVersion < 13) {
    withTransaction(() => {
      migrateCommunicationMessagesV13();
      db.exec('PRAGMA user_version = 13');
    });
  }
  if (currentVersion < 14) {
    withTransaction(() => {
      db.exec('PRAGMA user_version = 14');
    });
  }
  if (currentVersion < 15) {
    withTransaction(() => {
      migrateCharacterProfilesV15();
      db.exec('PRAGMA user_version = 15');
    });
  }
  if (currentVersion < 16) {
    withTransaction(() => {
      db.exec('PRAGMA user_version = 16');
    });
  }
  if (currentVersion < 17) {
    withTransaction(() => {
      db.exec('PRAGMA user_version = 17');
    });
  }
  if (currentVersion < 18) {
    withTransaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS character_change_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        changed_on TEXT,
        title TEXT NOT NULL,
        content TEXT,
        source_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(character_id, changed_on, title)
      )`);
      db.exec('PRAGMA user_version = 18');
    });
  }
  if (currentVersion < 19) {
    withTransaction(() => {
      if (!tableHasColumn('matches', 'exclude_from_character_stats')) {
        db.exec('ALTER TABLE matches ADD COLUMN exclude_from_character_stats INTEGER NOT NULL DEFAULT 0');
      }
      db.exec('PRAGMA user_version = 19');
    });
  }
  if (currentVersion < 20) {
    withTransaction(() => {
      migrateIdentityCatalogV20();
      db.exec('PRAGMA user_version = 20');
    });
  }
  if (currentVersion < 21) {
    withTransaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS character_portraits (
        character_id TEXT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
        mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
        data BLOB NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 2097152),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`);
      db.exec('PRAGMA user_version = 21');
    });
  }
  if (currentVersion < 22) {
    withTransaction(() => {
      if (!tableHasColumn('characters', 'nickname')) {
        db.exec('ALTER TABLE characters ADD COLUMN nickname TEXT');
      }
      db.exec(`UPDATE characters SET nickname = id
        WHERE nickname IS NULL OR trim(nickname) = ''`);
      db.exec(`CREATE TABLE IF NOT EXISTS character_skill_icons (
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
        mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
        data BLOB NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 524288),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (character_id, slot)
      )`);
      db.exec('PRAGMA user_version = 22');
    });
  }
  if (currentVersion < 23) {
    withTransaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS event_management_profiles (
        event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
        description TEXT NOT NULL DEFAULT '',
        max_teams INTEGER CHECK (max_teams IS NULL OR max_teams BETWEEN 2 AND 128),
        event_type TEXT NOT NULL DEFAULT 'private' CHECK (event_type IN ('private', 'public')),
        require_real_name INTEGER NOT NULL DEFAULT 0 CHECK (require_real_name IN (0, 1)),
        visibility TEXT NOT NULL DEFAULT 'system' CHECK (visibility IN ('system', 'participants', 'invite_only')),
        registration_method TEXT NOT NULL DEFAULT 'invite' CHECK (registration_method IN ('invite', 'manual', 'closed')),
        team_requirement TEXT NOT NULL DEFAULT 'any' CHECK (team_requirement IN ('any', 'club', 'organization')),
        start_date TEXT,
        end_date TEXT,
        registration_start TEXT,
        registration_end TEXT,
        min_team_members INTEGER CHECK (min_team_members IS NULL OR min_team_members BETWEEN 1 AND 99),
        max_team_members INTEGER CHECK (max_team_members IS NULL OR max_team_members BETWEEN 1 AND 99),
        require_system_login INTEGER NOT NULL DEFAULT 1 CHECK (require_system_login IN (0, 1)),
        organizer_type TEXT NOT NULL DEFAULT 'personal' CHECK (organizer_type IN ('personal', 'organization')),
        organizer_name TEXT NOT NULL DEFAULT '',
        contact TEXT NOT NULL DEFAULT '',
        rules_text TEXT NOT NULL DEFAULT '',
        manual_status TEXT CHECK (manual_status IS NULL OR manual_status IN ('live', 'completed')),
        marked INTEGER NOT NULL DEFAULT 0 CHECK (marked IN (0, 1)),
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_media (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('logo', 'cover')),
        mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
        data BLOB NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 4194304),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, kind)
      )`);
      db.exec('PRAGMA user_version = 23');
    });
  }
}

seedCommunicationChannels();

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
