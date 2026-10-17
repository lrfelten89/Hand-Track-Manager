/**
 * End-to-end regression: parse a real RUNMEET export, simulate the meet, and
 * rebuild the Athletic.net CSV — then compare it against a file that was
 * verified by a successful upload to Athletic.net.
 *
 * The domain layer is imported directly. The few functions still embedded in
 * index.html (they touch app state) are lifted out by name; when those move to
 * the domain module too, the lifting disappears.
 */
import fs from 'node:fs';
import { JSDOM } from '/home/claude/jsdomtest/node_modules/jsdom/lib/api.js';
import * as D from '../domain.mjs';

const html = fs.readFileSync('index.html', 'utf8');
const mod = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const lift = names => {
  const src = names.map(n => {
    const a = mod.indexOf('  function ' + n + '(');
    if (a < 0) throw new Error('not found in index.html: ' + n);
    const ends = [mod.indexOf('\n  function ', a + 1), mod.indexOf('\n  async function ', a + 1)].filter(x => x > 0);
    return mod.slice(a, Math.min(...ends));
  }).join('\n');
  const params = Object.keys(D);
  return new Function(...params, src + '\nreturn {' + names.join(',') + '};')(...params.map(k => D[k]));
};

// Only resultRowsForState is still embedded in index.html (it reads app
// state); everything else now comes straight from the domain module.
const app = lift(['resultRowsForState']);

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.document = dom.window.document;

const parsed = D.parseRunmeetHtmlDocument(
  fs.readFileSync('/mnt/user-data/uploads/RUNMEET__TEST_Sample_Meet.html', 'utf8'));

let s = 672513; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const seedToMs = t => { const m = String(t || '').trim().match(/^(?:(\d+):)?(\d{1,2}(?:\.\d+)?)$/);
  return m ? (m[1] ? Number(m[1]) * 60000 : 0) + Math.round(parseFloat(m[2]) * 1000) : null; };
const BASE = {'100m':16500,'200m':34000,'400m':78000,'800m':175000,'1500m':350000,'3000m':780000,
  '100m Hurdles':19500,'110m Hurdles':20000,'300m Hurdles':56000,'4x100 Relay':60000,'4x400 Relay':300000};
let budget = { SCR:2, DNS:2, DQ:1, DNF:1 };
const allRows = [];

parsed.groups.forEach((g, gi) => {
  if (!D.isRunmeetTimedEvent(g.eventName || '')) return;
  const entries = (g.entryIndexes || []).map(i => parsed.entries[i]).filter(e => e && !e.excluded);
  if (!entries.length) return;
  const competitors = entries.map((e, idx) => ({
    position: e.position || String(idx + 1),
    lane: /^\d+$/.test(String(e.position || '')) ? Number(e.position) : '',
    bib: e.bib || '', athlete: e.athlete || '', age: e.age || '', club: e.club || '', seed: e.seed || '',
    competitorType: e.competitorType || (/relay/i.test(e.eventName || '') ? 'Relay' : 'Individual'),
    eventNumber: e.eventNumber || '', gender: e.gender || '', division: e.division || '',
    combinedGender: e.combinedGender || '', combinedDivision: e.combinedDivision || '',
    combinedRaceId: e.combinedRaceId || '', combinedLabel: e.combinedLabel || '' }));
  const eventName = D.normalizeImportedEventName(g.eventName);
  const isDist = D.isDistanceEvent(eventName);
  const raceDisplay = g.raceDisplay || g.heat || ('Race ' + (g.raceNumber || ''));
  const eventBase = BASE[eventName] || 90000;
  const plausible = ms => ms != null && ms > eventBase * 0.55 && ms < eventBase * 2.2;
  const seeds = competitors.map(c => seedToMs(c.seed)).filter(plausible);
  const fallback = seeds.length ? seeds.reduce((a, b) => a + b, 0) / seeds.length * 1.04 : eventBase;
  const sim = new Map();
  competitors.forEach(c => { const sm = seedToMs(c.seed);
    sim.set(c, Math.round((plausible(sm) ? sm : fallback * (0.96 + rnd() * 0.12)) * (0.975 + rnd() * 0.07))); });
  const statuses = {};
  const take = kind => { if (budget[kind] <= 0) return;
    const v = competitors.find(c => !statuses['p' + String(c.position)]); if (!v) return;
    statuses['p' + String(v.position).replace(/[^A-Za-z0-9_-]/g, '_')] = kind; budget[kind]--;
    if (kind !== 'DQ') sim.delete(v); };
  if (!isDist && gi % 3 === 1) { take('SCR'); take('DNS'); }
  if (!isDist && /Hurdles/.test(eventName)) take('DQ');
  if (isDist) take('DNF');
  const st = { raceName: eventName, gender: (g.combinedGender || g.gender || ''),
    ageGroup: (g.combinedDivision || g.division || ''), heatLabel: raceDisplay,
    importedCompetitors: competitors, athleteStatuses: statuses, distanceMode: isDist };
  if (isDist) {
    const fin = competitors.filter(c => sim.has(c)).sort((a, b) => sim.get(a) - sim.get(b));
    st.times = fin.map(c => sim.get(c)); st.numbers = {};
    fin.forEach((c, i) => st.numbers['t' + i] = String(c.position)); st.laneCount = 8;
  } else {
    const maxLane = Math.max(0, ...competitors.map(c => Number(c.lane) || 0));
    st.laneCount = Math.max(8, Math.min(12, maxLane || 8)); st.lanes = {};
    for (let i = 1; i <= st.laneCount; i++) st.lanes['lane' + i] = { time: null };
    competitors.forEach(c => { if (c.lane && sim.has(c)) st.lanes['lane' + c.lane] = { time: sim.get(c) }; });
  }
  allRows.push(...app.resultRowsForState(st, raceDisplay));
});

const aoa = [D.ATHLETIC_NET_HEADERS, ...D.resultRowsToAthleticNetRows(allRows)];
const csv = aoa.map(r => r.map(D.csvEscape).join(',')).join('\r\n');
const expectedPath = '/mnt/user-data/outputs/TEST_Sample_Meet_results_v2.csv';
const expected = fs.readFileSync(expectedPath, 'utf8');
if (csv === expected) {
  console.log(`PASS — export is byte-identical to the uploaded-and-verified file (${aoa.length - 1} rows)`);
  process.exit(0);
}
const a = csv.split('\r\n'), b = expected.split('\r\n');
console.error(`FAIL — export changed. new ${a.length} lines vs expected ${b.length}`);
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] !== b[i]) { console.error(`  first difference at line ${i + 1}:\n    new: ${a[i]}\n    old: ${b[i]}`); break; }
}
process.exit(1);
