const assert = require('node:assert/strict');
const test = require('node:test');
const { beijingDate, beijingTimestamp, selectSchedulePresentation } = require('./schedule-service');

const schedules = [
  { event: { date: '2026-07-27', scheduleImage: 'today.png', scheduleTableImage: 'today-table.png' }, matches: [{ id: 'm1' }, { id: 'm2' }] },
  { event: { date: '2026-07-27', scheduleImage: 'today.png', scheduleTableImage: 'today-table.png' }, matches: [{ id: 'm3' }] },
  { event: { date: '2026-08-01', scheduleImage: 'next.png', scheduleTableImage: 'next-table.png' }, matches: [{ id: 'm4' }] }
];

test('Beijing date and filename timestamp ignore the host timezone', () => {
  const instant = new Date('2026-07-26T16:30:45.000Z');
  assert.equal(beijingDate(instant), '2026-07-27');
  assert.equal(beijingTimestamp(instant), '2026-07-27-00-30-45');
});

test('today schedule remains until every same-date match has a final winner', () => {
  const complete = new Set(['m1', 'm2']);
  const selected = selectSchedulePresentation(
    schedules,
    matchId => complete.has(matchId),
    new Date('2026-07-27T04:00:00.000Z')
  );
  assert.equal(selected.image, 'today.png');
  assert.equal(selected.tableImage, 'today-table.png');
  assert.equal(selected.advanced, false);
});

test('completed Beijing-day schedule advances to the next match image', () => {
  const selected = selectSchedulePresentation(
    schedules,
    matchId => ['m1', 'm2', 'm3'].includes(matchId),
    new Date('2026-07-27T15:59:59.000Z')
  );
  assert.equal(selected.image, 'next.png');
  assert.equal(selected.tableImage, 'next-table.png');
  assert.equal(selected.date, '2026-08-01');
  assert.equal(selected.advanced, true);
});
