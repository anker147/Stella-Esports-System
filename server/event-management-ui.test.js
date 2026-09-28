const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('event management replaces the placeholder with cards, filters and persisted actions', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'event-management.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'assets', 'css', 'event-management.css'), 'utf8');
  const page = html.match(/<section class="page-view" id="eventsPage"[\s\S]*?<\/section>/)?.[0] || '';

  assert.match(page, /id="eventManagementRoot"/);
  assert.doesNotMatch(page, /data-operations-root="events"/);
  assert.match(page, /data-event-filter="live"[\s\S]*data-event-filter="upcoming"[\s\S]*data-event-filter="completed"[\s\S]*data-event-filter="all"/);
  assert.match(script, /let activeFilter = 'live'/);
  assert.match(page, /id="eventCreateButton"/);
  assert.match(css, /\.event-card-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3/);
  assert.match(script, /method:\s*'POST'[\s\S]*\/api\/events/);
  assert.match(script, /statusAction === 'end'/);
  assert.match(script, /managedEventId/);
  assert.match(script, /scheduleButton\.disabled = event\.status !== 'live'/);
  assert.match(script, /'toggle-mark'/);
});

test('managed events and schedule context stay isolated from legacy tournament data', () => {
  // DDL 在 schema.js（自 db.js 拆出），断言读两份源码的拼接
  const database = fs.readFileSync(path.join(root, 'server', 'db.js'), 'utf8')
    + fs.readFileSync(path.join(root, 'server', 'schema.js'), 'utf8');
  const events = fs.readFileSync(path.join(root, 'server', 'event-management-service.js'), 'utf8');
  const operations = fs.readFileSync(path.join(root, 'server', 'operations-service.js'), 'utf8');
  assert.match(database, /CREATE TABLE IF NOT EXISTS tournament_events/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS tournament_schedule_links/);
  assert.match(events, /INSERT INTO tournament_events/);
  assert.doesNotMatch(events, /INSERT INTO events\s/);
  assert.match(operations, /resolveScheduleEvent/);
  assert.match(operations, /link\.tournament_event_id/);
});

test('formal event editor uses the acrylic three-step workflow and searchable team selection', () => {
  const script = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'event-management.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'assets', 'css', 'event-management.css'), 'utf8');

  assert.match(script, /data-event-method=\"formal\"[\s\S]*data-event-method=\"community\"[\s\S]*data-event-method=\"quick\"/);
  assert.equal((script.match(/data-event-step-panel=\"[0-2]\"/g) || []).length, 3);
  assert.match(script, /eventHandbookUrl/);
  assert.match(script, /eventHandbookOpen/);
  assert.match(script, /classList\.add\('is-workflow'\)/);
  assert.match(css, /\.event-editor-form\.is-workflow[\s\S]*\.event-editor-header/);
  assert.match(css, /\.event-editor-form\.is-workflow\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.event-editor-form\.is-workflow \.event-editor-workflow\s*\{[\s\S]*grid-row:\s*2/);
  assert.match(css, /\.event-method-grid\s*\{[\s\S]*align-self:\s*start/);
  assert.match(css, /\.event-method-grid\s*\{[\s\S]*justify-self:\s*center[\s\S]*width:\s*min\(100%, 768px\)/);
  assert.match(script, /workflow\.removeAttribute\('hidden'\)/);
  assert.match(css, /\.event-method-hero\s*\{[\s\S]*transform:\s*translateY\(88px\)/);
  assert.match(script, /eventContactGroupUrl/);
  assert.match(script, /eventGroupQrInput/);
  assert.match(script, /eventTeamSearch/);
  assert.match(script, /eventTeamSelectedList/);
  assert.match(script, /eventTeamSelectAll/);
  assert.match(script, /renderTeamLists/);
  assert.match(script, /team\.logos/);
  assert.doesNotMatch(script, /input\.type = 'checkbox'/);
  assert.match(css, /\.event-team-card-logo[\s\S]*width:\s*64px[\s\S]*height:\s*64px/);
  assert.match(script, /\/api\/events\/team-candidates/);
  assert.match(css, /backdrop-filter:\s*blur\(28px\)/);
  assert.match(css, /\.event-method-card[\s\S]*aspect-ratio:\s*1/);
  assert.match(css, /\.event-form-columns\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /\.event-team-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /\.event-team-card\.is-selected[\s\S]*box-shadow:/);
  assert.match(script, /StellaDialog\.alert/);
  assert.match(script, /async function validateStep/);
  assert.doesNotMatch(script, /reportValidity\s*\(/);
  assert.doesNotMatch(script, /(?:^|[^.\w])(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
});
