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
  assert.match(page, /data-event-filter="all"[\s\S]*data-event-filter="live"[\s\S]*data-event-filter="completed"/);
  assert.match(page, /id="eventCreateButton"/);
  assert.match(css, /\.event-card-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3/);
  assert.match(script, /method:\s*'POST'[\s\S]*\/api\/events/);
  assert.match(script, /statusAction === 'end'/);
  assert.match(script, /'toggle-mark'/);
});

test('formal event editor uses a five-step workflow and keeps unsupported paths explicit', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'control.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'event-management.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'assets', 'css', 'event-management.css'), 'utf8');

  assert.match(html, /data-event-method="formal"[\s\S]*data-event-method="community"[\s\S]*data-event-method="quick"/);
  assert.equal((html.match(/data-event-step-panel="[0-4]"/g) || []).length, 5);
  assert.match(html, /name="eventType" value="public" disabled/);
  assert.match(html, /报名链接[\s\S]*input type="url" disabled/);
  assert.match(html, /id="eventLogoInput"[^>]*type="file"/);
  assert.match(html, /id="eventCoverInput"[^>]*type="file"/);
  assert.match(css, /\.event-cover-editor\s*\{[\s\S]*height:\s*35%/);
  assert.match(css, /\.event-form-columns\s*\{[\s\S]*grid-template-columns:\s*repeat\(2/);
  assert.match(script, /StellaDialog\.alert/);
  assert.match(script, /async function validateStep/);
  assert.doesNotMatch(script, /reportValidity\s*\(/);
  assert.doesNotMatch(script, /(?:^|[^.\w])(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
});
