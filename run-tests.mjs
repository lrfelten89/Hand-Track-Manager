/**
 * MeetManager domain tests.
 *
 * Run with:  node tests/run-tests.mjs
 * No dependencies, no framework — plain Node and the real domain module.
 *
 * Most cases here are regressions: each one corresponds to a bug that reached
 * a real meet or a real Athletic.net upload. They are written so that a future
 * change which reintroduces the bug fails loudly, with a message that says
 * what the meet-day consequence was.
 */

import assert from 'node:assert/strict';
import {
  ATHLETIC_NET_HEADERS,
  athleticNetMarkForRow,
  cleanText,
  csvEscape,
  extractHeatNumber,
  fmt,
  isDistanceEvent,
  isRunmeetFieldEvent,
  isRunmeetTimedEvent,
  normalizeAthleticNetEvent,
  normalizeAthleticNetGender,
  overallPlacesByRow,
  queueRaceGenderLabel,
  resultGroupForCompetitor,
  resultRowsToAthleticNetRows,
  resultTimeToMs,
  sanitizeSpreadsheetCell,
  splitAthleteName,
  statusKeyForPosition,
} from '../domain.mjs';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { failures.push({ name, message: err.message }); }
}

/* ── Names ───────────────────────────────────────────────────────────────── */

test('athlete names split on the comma Athletic.net uses', () => {
  assert.deepEqual(splitAthleteName('Klein, Mireya'), { last: 'Klein', first: 'Mireya' });
});

test('multi-word surnames survive the split', () => {
  assert.deepEqual(splitAthleteName('Studebaker II, William'), { last: 'Studebaker II', first: 'William' });
});

test('a name with no comma is not mangled', () => {
  const out = splitAthleteName('Cher');
  assert.ok(out.first || out.last, 'a single-word name must land in one of the fields');
});

/* ── Times and marks ─────────────────────────────────────────────────────── */

test('fmt renders sub-minute and over-minute times the way officials read them', () => {
  assert.equal(fmt(9640), '9.64');
  assert.equal(fmt(65432), '1:05.43');
});

test('resultTimeToMs round-trips a formatted time', () => {
  assert.equal(resultTimeToMs('1:05.43'), 65430);
  assert.equal(resultTimeToMs('9.64'), 9640);
  assert.equal(resultTimeToMs(''), null);
  assert.equal(resultTimeToMs('DQ'), null);
});

test('REGRESSION: a DQ exports its status, not a bare time', () => {
  // Shipped once as a plain time with no place, which on Athletic.net is
  // indistinguishable from a result that simply was not counted.
  assert.equal(athleticNetMarkForRow({ status: 'DQ', result: '13.90' }), 'DQ');
  assert.equal(athleticNetMarkForRow({ status: 'DNF', result: '' }), 'DNF');
  assert.equal(athleticNetMarkForRow({ status: 'OK', result: '13.90' }), '13.90');
});

/* ── Event and gender normalisation ──────────────────────────────────────── */

test('field events are not treated as timed events', () => {
  assert.equal(isRunmeetFieldEvent('Shot Put'), true);
  assert.equal(isRunmeetFieldEvent('High Jump'), true);
  assert.equal(isRunmeetTimedEvent('100 Meters'), true);
  assert.equal(isRunmeetTimedEvent('Discus'), false);
});

test('distance events use the recorded-time flow, sprints do not', () => {
  assert.equal(isDistanceEvent('3000m'), true);
  assert.equal(isDistanceEvent('100m'), false);
});

test('REGRESSION: adult divisions keep Women/Men instead of becoming Girls/Boys', () => {
  // "women" contains "men"; an ordering slip here relabelled every adult race.
  assert.equal(queueRaceGenderLabel({ groups: [{ gender: "Women's" }] }), 'Women');
  assert.equal(queueRaceGenderLabel({ groups: [{ gender: "Men's" }] }), 'Men');
  assert.equal(queueRaceGenderLabel({ groups: [{ gender: "Girls'" }] }), 'Girls');
});

test('a cross-gender combined race is labelled Mixed', () => {
  assert.equal(queueRaceGenderLabel({ groups: [{ gender: "Girls'" }, { gender: "Boys'" }] }), 'Mixed');
});

test("a group's own gender outranks the combined F/M shorthand", () => {
  assert.equal(queueRaceGenderLabel({ groups: [{ gender: "Women's", combinedGender: 'F' }] }), 'Women');
});

test('Athletic.net gender codes are single letters', () => {
  assert.equal(normalizeAthleticNetGender("Girls'"), 'F');
  assert.equal(normalizeAthleticNetGender("Boys'"), 'M');
});

/* ── Heats ───────────────────────────────────────────────────────────────── */

test('heat numbers are pulled from labels, and custom labels stay blank', () => {
  assert.equal(extractHeatNumber('Heat 3'), '3');
  assert.equal(extractHeatNumber('Section 2'), '2');
  assert.equal(extractHeatNumber('2'), '2');
  assert.equal(extractHeatNumber('Fast Heat'), '');
});

/* ── Overall place (the column Athletic.net does not compute) ────────────── */

const row = (over) => Object.assign({
  status: 'OK', eventName: '100m', gender: "Girls'", ageGroup: 'Varsity',
  result: '', rawTimeMs: null, place: '', competitorType: 'Individual',
  athlete: 'A, B', club: 'TEAM', age: '10', heatLabel: 'Heat 1',
}, over);

test('REGRESSION: place is ranked across heats, not within one', () => {
  // Left blank once on the assumption the site would compute it; every event
  // uploaded with no places at all.
  const rows = [
    row({ rawTimeMs: 12000, result: '12.00', place: '1', heatLabel: 'Heat 1' }),
    row({ rawTimeMs: 11000, result: '11.00', place: '1', heatLabel: 'Heat 2' }),
    row({ rawTimeMs: 13000, result: '13.00', place: '2', heatLabel: 'Heat 1' }),
  ];
  const places = overallPlacesByRow(rows);
  assert.equal(places.get(rows[1]), 1, 'the fastest runner overall placed first, from heat 2');
  assert.equal(places.get(rows[0]), 2);
  assert.equal(places.get(rows[2]), 3);
});

test('equal published marks share a place and the next place skips', () => {
  const rows = [
    row({ rawTimeMs: 9990, result: '9.99' }),
    row({ rawTimeMs: 9994, result: '9.99' }),
    row({ rawTimeMs: 10060, result: '10.06' }),
  ];
  const places = overallPlacesByRow(rows);
  assert.equal(places.get(rows[0]), 1);
  assert.equal(places.get(rows[1]), 1, 'identical printed marks must tie');
  assert.equal(places.get(rows[2]), 3, 'the place after a tie skips');
});

test('different events and divisions are placed independently', () => {
  const rows = [
    row({ rawTimeMs: 12000, result: '12.00', eventName: '100m' }),
    row({ rawTimeMs: 30000, result: '30.00', eventName: '200m' }),
  ];
  const places = overallPlacesByRow(rows);
  assert.equal(places.get(rows[0]), 1);
  assert.equal(places.get(rows[1]), 1, 'a different event starts its own placing');
});

test('DQ and DNF take no place', () => {
  const rows = [
    row({ rawTimeMs: 12000, result: '12.00' }),
    row({ status: 'DQ', rawTimeMs: 11000, result: '11.00' }),
  ];
  const places = overallPlacesByRow(rows);
  assert.equal(places.get(rows[0]), 1, 'the DQ must not consume first place');
  assert.equal(places.get(rows[1]), undefined);
});

/* ── Export rows ─────────────────────────────────────────────────────────── */

test('the export keeps the Athletic.net column layout', () => {
  assert.equal(ATHLETIC_NET_HEADERS.length, 62);
  assert.equal(ATHLETIC_NET_HEADERS[0], 'Type');
  assert.equal(ATHLETIC_NET_HEADERS[9], '[HeatPlace]');
  assert.equal(ATHLETIC_NET_HEADERS[10], '[Place]');
  assert.equal(ATHLETIC_NET_HEADERS[11], 'Result');
});

test('scratched and did-not-start athletes stay out of the upload', () => {
  const rows = [
    row({ status: 'OK', rawTimeMs: 12000, result: '12.00' }),
    row({ status: 'SCR', result: '' }),
    row({ status: 'DNS', result: '' }),
  ];
  assert.equal(resultRowsToAthleticNetRows(rows).length, 1);
});

test('REGRESSION: a DNF with no time still reaches the upload', () => {
  // The old filter required a result value, so a runner who did not finish —
  // and therefore had no time — vanished from the results entirely.
  const out = resultRowsToAthleticNetRows([row({ status: 'DNF', result: '' })]);
  assert.equal(out.length, 1, 'a DNF must not be dropped for lacking a time');
  assert.equal(out[0][11], 'DNF');
});

test('a relay row is typed as a relay and carries its team', () => {
  const out = resultRowsToAthleticNetRows([row({
    competitorType: 'Relay', athlete: 'A', club: 'TEST TIGARD',
    rawTimeMs: 60000, result: '1:00.00', eventName: '4x100 Relay',
  })]);
  assert.equal(out[0][0], 'Relay');
  assert.equal(out[0][12], 'TEST TIGARD');
});

/* ── Spreadsheet safety ──────────────────────────────────────────────────── */

test('formula injection is neutralised in every cell', () => {
  for (const dangerous of ['=cmd|calc', '+1', '-1+2', '@SUM(A1)']) {
    assert.ok(String(sanitizeSpreadsheetCell(dangerous)).startsWith("'"),
      dangerous + ' must be prefixed so a spreadsheet cannot execute it');
  }
});

test('CSV quoting follows RFC 4180', () => {
  assert.equal(csvEscape('SPIKE UP, ATHLETICS'), '"SPIKE UP, ATHLETICS"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape('plain'), 'plain');
});

test('cleanText collapses the whitespace RUNMEET exports are full of', () => {
  assert.equal(cleanText('  Klein,\n  Mireya  '), 'Klein, Mireya');
});

test('status keys are safe to use as Firebase child names', () => {
  assert.ok(!/[.#$/[\]]/.test(statusKeyForPosition('1.2')));
});

/* ── Combined races ──────────────────────────────────────────────────────── */

test('a combined girls + boys race exports each athlete under their own gender and age group', () => {
  // Bug: every athlete in a combined race was exported as gender X under the
  // combined division, so the results matched none of the meet's Athletic.net
  // events and boys were ranked against girls.
  const girl = { gender: "Girls'", division: '11-12', combinedGender: 'Mixed', combinedDivision: '11-12/11-12' };
  const boy = { gender: "Boys'", division: '11-12', combinedGender: 'Mixed', combinedDivision: '11-12/11-12' };
  assert.deepEqual(resultGroupForCompetitor(girl, 'Mixed', '11-12/11-12'), { gender: "Girls'", ageGroup: '11-12' });
  assert.deepEqual(resultGroupForCompetitor(boy, 'Mixed', '11-12/11-12'), { gender: "Boys'", ageGroup: '11-12' });
});

test('combined age groups keep each athlete in their own division', () => {
  const c = { gender: 'Girls', division: '7-8', combinedGender: 'F', combinedDivision: '7-10' };
  assert.equal(resultGroupForCompetitor(c, 'F', '7-10').ageGroup, '7-8');
});

test('combined values are only a fallback when the entry has none', () => {
  assert.deepEqual(resultGroupForCompetitor({ combinedGender: 'Mixed', combinedDivision: 'Open' }, 'M', 'X'),
    { gender: 'Mixed', ageGroup: 'Open' });
  assert.deepEqual(resultGroupForCompetitor(null, 'M', '9-10'), { gender: 'M', ageGroup: '9-10' });
});

test('in a combined race, girls and boys are placed separately on Athletic.net', () => {
  const H = ATHLETIC_NET_HEADERS;
  const row = (gender, ms, name) => ({ eventName: '100m', gender, ageGroup: '7-8', race: 'Heat 1', status: 'OK',
    result: fmt(ms), rawTimeMs: ms, athlete: name });
  const out = resultRowsToAthleticNetRows([row('Boys', 15000, 'Smith, Ben'), row('Girls', 15500, 'Lee, Ava'), row('Boys', 16000, 'Cruz, Max')]);
  const get = (r, col) => r[H.indexOf(col)];
  assert.deepEqual(out.map(r => [get(r, 'Gender'), get(r, '[Place]'), get(r, '[Gender1]')]),
    [['M', 1, 'M'], ['F', 1, 'F'], ['M', 2, 'M']]);
});

/* ── Report ──────────────────────────────────────────────────────────────── */

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const f of failures) console.error(`FAILED: ${f.name}\n        ${f.message}\n`);
process.exit(failures.length ? 1 : 0);
