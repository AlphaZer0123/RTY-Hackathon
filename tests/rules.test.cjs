const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../app/rules.js');

const future = { date: '2035-11-19', start: '10:30', title: '  Team meeting  ', duration: 60 };
const today = Date.parse('2035-11-19T10:20:00+05:30');
test('plans contiguous intervals with the given title and an IST date', () => {
  assert.deepEqual(rules.meeting(future, today), {
    date: future.date, title: 'Team meeting', duration: 60,
    parts: [{ start: 630, end: 660 }, { start: 660, end: 690 }]
  });
  assert.equal(rules.meeting({ ...future, duration: 30 }, today).parts.length, 1);
});
test('rejects invalid dates, invalid starts, past starts, midnight and unsupported durations', () => {
  for (const change of [{ date: '2035-02-29' }, { start: '10:19' }, { start: '10:15' },
    { start: '23:30' }, { start: '25:00' }, { duration: 45 }, { title: '' }]) {
    assert.throws(() => rules.meeting({ ...future, ...change }, today));
  }
});
test('decodes both live date formats and common booking email times', () => {
  for (const label of ['18 Nov 2026', 'Nov 18-2026', 'Nov 18, 2026']) assert.equal(rules.dateLabel(label), '2026-11-18');
  assert.equal(rules.dateLabel('31 Apr 2026'), '');
  assert.equal(rules.minute('12:05 AM'), 5);
  assert.equal(rules.minute('12:05 PM'), 725);
  assert.equal(rules.minute('00:01 PM'), -1);
});
test('protects overlapping intervals across title edits and allows adjacent intervals', () => {
  const run = { room: { id: 'tower/a' }, date: future.date, title: 'Original',
    parts: [{ start: 600, end: 630, state: 'pending' }] };
  assert.equal(rules.conflicts([run], run.room, run.date, { start: 615, end: 645 }), true);
  assert.equal(rules.conflicts([run], run.room, run.date, { start: 630, end: 660 }), false);
  assert.equal(rules.conflicts([run], { id: 'tower/b' }, run.date, { start: 615, end: 645 }), false);
});
test('parses Gmail booking subject and tower from the preview without reading a title', () => {
  assert.deepEqual(rules.parseBooking('Room Booked (MVP-712 (Podcast)) @ 2035-11-19 10:30 - 11:00 (IST)',
    'Your meeting has been scheduled. Room Name. MVP-712 (Podcast) Location. Tower CDS - 07th Floor Time. 10:30'), {
    kind: 'booked', room: 'MVP-712 (Podcast)', date: future.date, start: 630, end: 660, location: 'Tower CDS - 07th Floor'
  });
  assert.equal(rules.parseBooking('Room Booked (MVP) @ 2035-11-19 10:30 - 11:00 (IST)', 'No location preview'), null);
});
test('accepts only a fresh, exact booked message with a stable reference', () => {
  const now = Date.now();
  const run = { room: { name: 'MVP', tower: 'Tower A' }, date: future.date };
  const part = { start: 630, end: 660, grantedAt: now - 500, baseline: ['old'] };
  const candidate = { id: 'new', sender: 'noreply@mastersunion.org', kind: 'booked', room: 'MVP', location: 'Tower A',
    date: future.date, start: 630, end: 660, timestamp: now };
  assert.equal(rules.confirmation(candidate, run, part), true);
  for (const change of [{ id: 'old' }, { id: '' }, { sender: 'fake@mastersunion.org' }, { location: 'Tower AA' },
    { room: 'Other' }, { date: '2035-11-20' }, { end: 675 }, { kind: 'cancelled' }, { timestamp: now - 1000 }]) {
    assert.equal(rules.confirmation({ ...candidate, ...change }, run, part), false);
  }
});

test('reads English Gmail tooltip timestamps in both common regional layouts', () => {
  const expected = new Date(2026, 10, 18, 17, 12).getTime();
  assert.equal(rules.mailTooltipTimestamp('Wed, 18 Nov 2026, 17:12'), expected);
  assert.equal(rules.mailTooltipTimestamp('Wed, Nov 18, 2026, 5:12 PM'), expected);
  assert.ok(Number.isNaN(rules.mailTooltipTimestamp('18 Nov')));
});

test('requires a baseline before admitting minute-precision evidence in the grant minute', () => {
  const now = Date.now();
  const timestamp = Math.floor(now / 60000) * 60000;
  const candidate = { id: 'candidate', sender: 'noreply@mastersunion.org', kind: 'booked',
    date: future.date, room: 'Sync', location: 'Tower B', start: 600, end: 630,
    timestamp, minutePrecision: true };
  const run = { date: future.date, room: { name: 'Sync', tower: 'Tower B' } };
  const part = { start: 600, end: 630, grantedAt: timestamp + 100, baseline: [] };
  assert.equal(rules.confirmation(candidate, run, part), false);
  assert.equal(rules.confirmation(candidate, run, { ...part, baselineComplete: true }), true);
  assert.equal(rules.confirmation(candidate, run, { ...part, baselineComplete: true, baseline: ['candidate'] }), false);
});

test('parses the live Tower field without mistaking other text for the location', () => {
  const subject = 'Room Booked (Room A) @ 2035-11-19 22:00 - 22:30 (IST)';
  const body = 'Room Booked\nRoom: Room A\nDate: 2035-11-19\nTime: 22:00 - 22:30 (IST)\nTower: A\nBooking policy';
  assert.equal(rules.parseBooking(subject, body)?.location, 'Tower A');
  assert.equal(rules.parseBooking(subject, body.replace('Tower: A', 'Tower: CDS - 07th Floor'))?.location, 'Tower CDS - 07th Floor');
  assert.equal(rules.parseBooking(subject, body.replace('Tower: A', 'Tower:')), null);
});

test('splits a seven-hour range into fourteen adjacent requests', () => {
  const review = rules.meeting({ ...future, start: '09:00', duration: 420 }, Date.parse('2035-11-19T08:00:00+05:30'));
  assert.equal(review.parts.length, 14);
  assert.deepEqual(review.parts[0], { start: 540, end: 570 });
  assert.deepEqual(review.parts.at(-1), { start: 930, end: 960 });
  assert.ok(review.parts.every((part, index) => index === 0 || part.start === review.parts[index - 1].end));
});

test('matches the complete live Gmail preview tower without the sign-off', () => {
  const subject = 'Room Booked (Room A) @ 2035-11-19 22:00 - 22:30 (IST)';
  const preview = "Room Booked ✅ Your room has been booked successfully. Room: Room A Date: 2035-11-19 Time: 22:00 - 22:30 (IST) Tower: CDS - 07th Floor Best regards, Masters' Union";
  assert.equal(rules.parseBooking(subject, preview)?.location, 'Tower CDS - 07th Floor');
  assert.equal(rules.parseBooking(subject, preview.split(' Best regards')[0]), null);
});
