/**
 * domain.mjs — pure domain logic for MeetManager.
 *
 * Everything here is a pure function or a constant: no DOM, no Firebase, no
 * localStorage, no module state. That is the point. This is the layer where
 * the meet's *meaning* lives — how a RUNMEET export is read, how a race's
 * results become Athletic.net rows, how places and marks are decided — and
 * historically it is also where the bugs have lived (bib badges parsed into
 * athlete names, a blank Place column, disqualifications exported as bare
 * times). Kept separate, it can be tested directly: see tests/run-tests.mjs.
 *
 * Loaded by index.html as an ES module and imported by the test runner in
 * Node, so the browser and the tests exercise the same code.
 */

function cleanText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeSpreadsheetCell(value) {
  const s = String(value ?? '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function csvEscape(value) {
  const s = sanitizeSpreadsheetCell(value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function splitAthleteName(fullName) {
  const name = String(fullName || '').trim();
  if (!name) return { first: '', last: '' };
  if (name.includes(',')) {
    const parts = name.split(',');
    return { last: parts[0].trim(), first: parts.slice(1).join(',').trim() };
  }
  const parts = name.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

function extractHeatNumber(value) {
  const s = String(value || '').trim();
  if (/^\d+$/.test(s)) return s;                       // bare number: use as-is
  const m = s.match(/\b(?:heat|race|section|flight)\s*#?\s*(\d+)/i);
  return m ? m[1] : '';                                 // custom labels: leave [Heat] blank
}

function normalizeAthleticNetGender(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'x' || v.includes('mixed') || v.includes('coed') || v.includes('co-ed')) return 'X';
  if (v === 'f' || v.includes('girl') || v.includes('women') || v.includes('female')) return 'F';
  if (v === 'm' || v.includes('boy') || v.includes('men') || v.includes('male')) return 'M';
  return String(value || '').trim();
}

function normalizeAthleticNetEvent(value) {
  if (typeof normalizeRunmeetEventName === 'function') return normalizeRunmeetEventName(value);
  return String(value || '').replace(/\bRelay\s*Relay\b/gi, 'Relay').replace(/\s+/g, ' ').trim();
}

function resultTimeToMs(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const m = s.match(/^(?:(\d+):)?(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60000 : 0) + Math.round(parseFloat(m[2]) * 1000);
}

function overallPlacesByRow(rows) {
  const groups = new Map();
  (rows || []).forEach(r => {
    // Only clean finishes are ranked: DQ/DNF keep a time but no placement,
    // and DNS/SCR never reach the export at all.
    if (!r || r.status !== 'OK') return;
    const ms = Number.isFinite(Number(r.rawTimeMs)) ? Number(r.rawTimeMs) : resultTimeToMs(r.result);
    if (!Number.isFinite(ms) || ms <= 0) return;
    const key = [
      normalizeAthleticNetEvent(r.eventName),
      normalizeAthleticNetGender(r.gender),
      r.ageGroup || ''
    ].join('|').toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ row: r, ms, mark: String(r.result || '').trim() });
  });
  const places = new Map();
  groups.forEach(list => {
    list.sort((a, b) => a.ms - b.ms);
    let place = 0, prevMark = null;
    list.forEach((item, idx) => {
      // Ties are decided on the PUBLISHED mark, not raw milliseconds: two
      // athletes whose exported times read the same share a place, and the
      // next place skips. Ranking still uses raw ms so the order is stable.
      if (prevMark === null || item.mark !== prevMark) { place = idx + 1; prevMark = item.mark; }
      places.set(item.row, place);
    });
  });
  return places;
}

function athleticNetMarkForRow(r) {
  const status = String(r && r.status || '').toUpperCase();
  if (status === 'DQ' || status === 'DNF') return status;
  return r && r.result ? r.result : '';
}

function resultRowsToAthleticNetRows(rows) {
  const overallPlaces = overallPlacesByRow(rows);
  return rows
    .filter(r => r && (r.status === 'DQ' || r.status === 'DNF' || (r.result && r.status !== 'DNS' && r.status !== 'SCR')))
    .map(r => {
      const isRelay = /relay/i.test(r.competitorType || '') || /relay/i.test(r.eventName || '');
      const out = new Array(ATHLETIC_NET_HEADERS.length).fill('');
      out[0] = isRelay ? 'Relay' : 'Event';
      out[1] = normalizeAthleticNetGender(r.gender);
      out[2] = r.ageGroup || '';
      out[3] = normalizeAthleticNetEvent(r.eventName);
      out[4] = r.seed || '';
      out[6] = 'Finals';
      out[7] = extractHeatNumber(r.race || '');
      out[9] = r.place || '';                 // [HeatPlace]: place within this heat
      out[10] = overallPlaces.get(r) || '';   // [Place]: placement across all heats of the event
      out[11] = athleticNetMarkForRow(r);  // time, or DQ / DNF
      out[12] = sanitizeSpreadsheetCell(r.club || '');
      if (isRelay) {
        out[13] = sanitizeSpreadsheetCell(String(r.athlete || '').replace(/["']/g, '').trim());
      } else {
        const nm = splitAthleteName(r.athlete);
        out[14] = sanitizeSpreadsheetCell(nm.first);
        out[15] = sanitizeSpreadsheetCell(nm.last);
        out[16] = r.age || '';
        out[17] = normalizeAthleticNetGender(r.gender);
      }
      return out;
    });
}

function isDistanceEvent(eventName) {
  return DISTANCE_EVENTS.includes(eventName);
}

function fmt(ms) {
  if (ms === null || ms === undefined) return '--.--';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const hundredths = Math.floor((ms % 1000) / 10);
  if (m === 0) {
    return String(s) + '.' + String(hundredths).padStart(2,'0');
  }
  return String(m) + ':' + String(s).padStart(2,'0') + '.' + String(hundredths).padStart(2,'0');
}

function normalizeRunmeetEventName(value) {
  let name = cleanText(value);
  if (!name) return '';

  // Normalize common Athletic.net printable-header duplication artifacts.
  // These can appear as either spaced duplicates ("Relay Relay") or
  // concatenated duplicates ("RelayRelay") depending on how the saved
  // RUNMEET HTML/PDF text is generated.
  const repeatedSuffixes = ['Relay', 'Meters', 'Meter', 'Dash', 'Hurdles', 'Hurdle'];
  repeatedSuffixes.forEach(word => {
    const spaced = new RegExp('\\b' + word + '\\s+' + word + '\\b', 'gi');
    const joined = new RegExp('\\b' + word + word + '\\b', 'gi');
    name = name.replace(spaced, word).replace(joined, word);
  });

  name = name
    .replace(/\bMetres\b/gi, 'Meters')
    .replace(/(\d+)\s*x\s*(\d+)/gi, '$1x$2')
    .replace(/\s+/g, ' ')
    .trim();

  // A second pass catches cases created by earlier replacements.
  name = name
    .replace(/\bRelay\s*Relay\b/gi, 'Relay')
    .replace(/\bMeters\s*Meters\b/gi, 'Meters')
    .replace(/\bDash\s*Dash\b/gi, 'Dash')
    .replace(/\bHurdles\s*Hurdles\b/gi, 'Hurdles')
    .replace(/\bHurdle\s*Hurdle\b/gi, 'Hurdle')
    .replace(/\s+/g, ' ')
    .trim();

  return name;
}

function normalizeImportedEventName(eventName) {
  let name = normalizeRunmeetEventName(eventName);
  name = name.replace(/^(\d+)\s+Meters$/i, '$1m');
  name = name.replace(/^(\d+)\s+Meter$/i, '$1m');
  name = name.replace(/^(\d+)m\s+Hurdles$/i, '$1m Hurdles');
  return name || 'Imported Race';
}

function isRunmeetFieldEvent(eventName) {
  const name = cleanText(eventName).toLowerCase();
  return /\b(high jump|pole vault|long jump|triple jump|shot put|discus|javelin|hammer|weight throw|turbojav|turbo jav|throws?|jump)\b/.test(name);
}

function isRunmeetTimedEvent(eventName) {
  return !isRunmeetFieldEvent(eventName);
}

function queueRaceGenderLabel(item) {
  const groups = item && Array.isArray(item.groups) ? item.groups : [];
  // Prefer each group's OWN gender over the combined label's F/M shorthand,
  // so adult divisions keep "Women"/"Men" even inside combined races.
  const rawValues = groups.map(g => String(g.gender || g.combinedGender || '').trim()).filter(Boolean);
  const normalized = new Set(rawValues.map(v => {
    const x = v.toLowerCase().replace(/[’']/g, '');
    if (x === 'x' || x.includes('mixed') || x.includes('coed') || x.includes('co-ed') || x.includes('combined')) return 'Mixed';
    if (x.includes('women') || x.includes('woman')) return 'Women'; // before the 'men' check — "women" contains "men"
    if (x.includes('girl') || x === 'f' || x === 'female') return 'Girls';
    if (x.includes('boy')) return 'Boys';
    if (x.includes('men') || x === 'm' || x === 'male') return 'Men';
    return v;
  }));
  if (normalized.has('Mixed')) return 'Mixed';
  const hasFemale = normalized.has('Girls') || normalized.has('Women');
  const hasMale = normalized.has('Boys') || normalized.has('Men');
  if (hasFemale && hasMale) return 'Mixed';
  if (normalized.size === 1) return Array.from(normalized)[0];
  // Same-sex mix of youth and adult divisions (e.g. Girls + Women combined):
  // name both rather than mislabeling either.
  return normalized.size ? Array.from(normalized).join('/') : '';
}

function statusKeyForPosition(pos) {
  return 'p' + String(pos ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
}

const DISTANCE_EVENTS = ['800m', '1500m', 'Mile', '1600m', '3000m', '3200m', '5000m', '4x400m Relay', '4x800m Relay', 'Sprint Medley Relay'];

const ATHLETE_STATUSES = ['SCR', 'DNS', 'DNF', 'DQ'];

const ATHLETIC_NET_HEADERS = [
  'Type','Gender','[Division]','Event','[Seed]','[Score]','[Round]','[Heat]','[Wind]','[HeatPlace]','[Place]','Result','Team','[RelayLetter]',
  'FirstName1','LastName1','[Grade1]','[Gender1]','[RegId1]','[Birthdate1]',
  'FirstName2','LastName2','[Grade2]','[Gender2]','[RegId2]','[Birthdate2]',
  'FirstName3','LastName3','[Grade3]','[Gender3]','[RegId3]','[Birthdate3]',
  'FirstName4','LastName4','[Grade4]','[Gender4]','[RegId4]','[Birthdate4]',
  'FirstName5','LastName5','[Grade5]','[Gender5]','[RegId5]','[Birthdate5]',
  'FirstName6','LastName6','[Grade6]','[Gender6]','[RegId6]','[Birthdate6]',
  'FirstName7','LastName7','[Grade7]','[Gender7]','[RegId7]','[Birthdate7]',
  'FirstName8','LastName8','[Grade8]','[Gender8]','[RegId8]','[Birthdate8]'
];

const NO_TIME_STATUSES = ['SCR', 'DNS'];

function normalizeRunmeetGenderLabel(value) {
  const text = cleanText(value).replace(/[\u2022·]/g, '').replace(/’/g, "'");
  if (/^(mixed|co-?ed|x)$/i.test(text)) return 'Mixed';
  if (/^(girls'?|women'?s|female|f)$/i.test(text)) return text.match(/^girls/i) ? "Girls'" : text.match(/^women/i) ? "Women's" : 'Female';
  if (/^(boys'?|men'?s|male|m)$/i.test(text)) return text.match(/^boys/i) ? "Boys'" : text.match(/^men/i) ? "Men's" : 'Male';
  return text;
}

function parseRunmeetHeader(headerEl) {
  const result = { eventNumber: '', genderLabel: '', eventName: '', division: '', round: '' };
  if (!headerEl) return result;
  const headerRow = headerEl.querySelector('h5 .d-flex') || headerEl.querySelector('.d-flex') || headerEl;
  const pieces = Array.from(headerRow.children).map(el => cleanText(el.textContent)).filter(Boolean);
  const fullText = cleanText(headerRow.textContent || headerEl.textContent || '').replace(/’/g, "'");
  const genderPattern = "Girls'?|Boys'?|Women's|Men's|Mixed|Co-?Ed|Female|Male|F|M|X";
  const finalsIdx = pieces.findIndex(p => /^finals$/i.test(p));
  const useful = finalsIdx >= 0 ? pieces.slice(0, finalsIdx) : pieces;
  result.eventNumber = useful.find(p => /^#\d+/.test(p)) || (fullText.match(/#\d+/) || [''])[0];
  const genderIdx = useful.findIndex(p => new RegExp('^(' + genderPattern + ')$', 'i').test(p.replace(/[\u2022·]/g, '')));
  if (genderIdx >= 0) {
    result.genderLabel = normalizeRunmeetGenderLabel(useful[genderIdx]);
    result.eventName = useful[genderIdx + 1] || '';
    result.division = useful[genderIdx + 2] || '';
  } else {
    // Fallback for saved RUNMEET variants where the header is one text node, e.g.
    // "#211 Mixed 4x100 Relay Relay Finals".
    const headerMatch = fullText.match(new RegExp('(#\\d+)?\\s*(' + genderPattern + ')\\s+(.+?)(?:\\s+(\\d+[-–]\\d+|Masters|\\d+\\s*and\\s*under|\\d+-up))?\\s+(?:\\[?\\s*Finals|Finals|I\\s*Finals)', 'i'));
    if (headerMatch) {
      result.genderLabel = normalizeRunmeetGenderLabel(headerMatch[2]);
      result.eventName = cleanText(headerMatch[3]);
      result.division = cleanText(headerMatch[4] || '');
    } else {
      result.eventName = useful.find(p => !/^#\d+/.test(p)) || '';
    }
  }
  // Athletic.net sometimes stores Mixed relay headers as pieces like:
  //   ["#211", "Mixed 4x100 Relay", "Relay", "Finals"]
  // while men's/women's relay headers are split as:
  //   ["#212", "Men's", "4x100 Relay", "Relay", "Finals"]
  // Pull the gender prefix out of the event name so Mixed relays become
  // Group = "Mixed Relay" and Event = "4x100 Relay" rather than
  // Event = "Mixed 4x100 RelayRelay" or Group = "Relay".
  const split = splitRunmeetGenderPrefix(result.eventName);
  if (split.gender && !result.genderLabel) {
    result.genderLabel = split.gender;
    result.eventName = split.eventName;
  } else if (split.gender && normalizeRunmeetGenderLabel(result.genderLabel) === split.gender) {
    result.eventName = split.eventName;
  }

  if (/^relay$/i.test(result.division) && result.eventName && !/\bRelay\b/i.test(result.eventName)) {
    result.eventName = result.eventName + ' Relay';
  }

  result.eventName = normalizeRunmeetEventName(result.eventName);
  result.round = pieces.find(p => /^finals$/i.test(p)) || (/finals/i.test(fullText) ? 'Finals' : '');
  return result;
}

function parseRunmeetEntry(entryEl, meta) {
  const row = entryEl.querySelector('.row') || entryEl;
  const cols = Array.from(row.children).map(el => cleanText(el.textContent)).filter(Boolean);
  const position = cols[0] || '';
  const isRelay = /relay/i.test(meta.eventName || '');
  // When Athletic.net assigns bib numbers, a <web-comp-number> badge
  // ("#533") is rendered INSIDE the name cell, so the cell's text reads
  // "#533 Klein, Mireya". Read the badge element for the bib, then strip
  // its text from the name. A pure-numeric second column (bib as its own
  // cell, in case other export variants do that) is also handled.
  let bib = '';
  const bibEl = row.querySelector('web-comp-number, .badge');
  if (bibEl) bib = cleanText(bibEl.textContent).replace(/^#/, '');
  if (!bib && !isRelay && /^#?\d{1,6}$/.test(cols[1] || '') && cols.length >= 3) {
    bib = (cols[1] || '').replace(/^#/, '');
    cols.splice(1, 1);
  }
  let name = cols[1] || '';
  if (bib) name = name.replace(new RegExp('^#?' + bib + '\\s+'), '');
  let age = cols[2] || '';
  let club = cols[3] || '';
  let seed = cols[4] || '';

  if (isRelay) {
    // RUNMEET relay rows are structured as: position, club, team designation, seed/blank.
    // For timing, the relay team designation is the competitor name and the club is the club.
    club = cols[1] || '';
    name = stripRelayTeamQuotes(cols[2] || '');
    age = '';
    seed = cols[3] || '';

    // Fallback for any saved HTML variant where club and team were merged, e.g. YMCA TEAM IDAHO 'A'.
    if (!name && club) {
      const merged = club.match(/^(.*)\s+['"`]([A-Z0-9]+)['"`]$/i);
      if (merged) {
        club = cleanText(merged[1]);
        name = stripRelayTeamQuotes(merged[2]);
      }
    }
  }

  return {
    eventNumber: meta.eventNumber,
    gender: normalizeRunmeetGenderLabel(meta.genderLabel),
    eventName: normalizeRunmeetEventName(meta.eventName),
    division: meta.division,
    combinedDivision: '',
    combinedGender: '',
    combinedRaceId: '',
    combinedLabel: '',
    round: meta.round,
    heat: meta.heat,
    raceLabel: meta.raceLabel,
    raceNumber: meta.raceNumber,
    raceDisplay: meta.raceDisplay,
    originalRaceText: meta.originalRaceText,
    sourceEventOrder: meta.sourceEventOrder,
    sourceRaceOrder: meta.sourceRaceOrder,
    position,
    bib,
    athlete: name,
    age,
    club,
    seed,
    competitorType: isRelay ? 'Relay' : 'Individual',
    issue: buildImportIssue(name, age, club, meta),
    issueIgnored: false,
    excluded: false
  };
}

function parseRunmeetHtmlDocument(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const blocks = Array.from(doc.querySelectorAll('web-meet-program-entries'));
  const entries = [];
  const groups = [];
  const meetId = extractRunmeetMeetId(doc, htmlText);
  const meetName = extractRunmeetMeetName(doc);
  let nextGroupId = 1;

  blocks.forEach((block, sourceEventOrder) => {
    const header = parseRunmeetHeader(block.querySelector('web-reports-header'));

    // Athletic.net places every heat/section/flight for an event inside one
    // <web-meet-program-entries> block.  Earlier versions selected only the
    // first b.heat-num-lg and then collected every entry in the outer block,
    // which flattened Heat 1, Heat 2, etc. into one roster.  Parse each
    // .heat-block separately so heat sheets, finish-line sheets, field-event
    // sheets, the combiner, and the timing queue all retain race boundaries.
    const raceBlocks = Array.from(block.querySelectorAll('.heat-block'))
      .filter(rb => rb.querySelector('b.heat-num-lg'));
    const units = raceBlocks.length ? raceBlocks : [block];

    units.forEach((unit, sourceRaceOrder) => {
      const heatEl = unit.querySelector('b.heat-num-lg');
      const heat = cleanText(heatEl ? heatEl.textContent : '');
      const race = normalizeRunmeetRace(heat);
      const meta = { ...header, heat, ...race, sourceEventOrder, sourceRaceOrder };
      const entryEls = Array.from(unit.querySelectorAll('web-report-entry'));
      const blockEntries = entryEls.map(e => parseRunmeetEntry(e, meta));
      const startIndex = entries.length;
      blockEntries.forEach(e => entries.push(e));
      groups.push({
        id: nextGroupId++,
        eventNumber: header.eventNumber,
        gender: normalizeRunmeetGenderLabel(header.genderLabel),
        eventName: normalizeRunmeetEventName(header.eventName),
        division: header.division,
        combinedDivision: '',
        combinedGender: '',
        combinedRaceId: '',
        combinedLabel: '',
        heat,
        raceLabel: race.raceLabel,
        raceNumber: race.raceNumber,
        raceDisplay: race.raceDisplay,
        originalRaceText: race.originalRaceText,
        sourceEventOrder,
        sourceRaceOrder,
        eventType: isRunmeetTimedEvent(header.eventName) ? 'Track' : 'Field',
        includeInTiming: isRunmeetTimedEvent(header.eventName),
        entryCount: blockEntries.length,
        issues: blockEntries.filter(e => e.issue).length,
        entryIndexes: blockEntries.map((_, i) => startIndex + i)
      });
    });
  });

  return { entries, groups, meetId, meetName };
}

function extractRunmeetMeetId(doc, htmlText) {
  const text = htmlText || '';
  const patterns = [
    /\"meetID\"\s*:\s*(\d+)/i,
    /\"meetId\"\s*:\s*(\d+)/i,
    /meetID\s*[:=]\s*(\d+)/i,
    /meetId\s*[:=]\s*(\d+)/i,
    /\/TrackAndField\/meet\/(\d+)/i,
    /\/meet\/(\d+)/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return m[1];
  }
  const metaUrl = doc && doc.querySelector ? doc.querySelector('meta[property="og:url"], meta[name="og:url"]') : null;
  const content = metaUrl ? (metaUrl.getAttribute('content') || '') : '';
  const m = content.match(/(?:TrackAndField\/meet|meet)\/(\d+)/i);
  return m ? m[1] : '';
}

function extractRunmeetMeetName(doc) {
  const heading = doc.querySelector('h1, h2');
  const headingText = cleanText(heading ? heading.textContent : '');
  if (headingText && !/track\s*&\s*field/i.test(headingText)) return headingText;
  const title = cleanText(doc.title || '').replace(/^RUNMEET:?\s*/i, '');
  if (title && !/track\s*&\s*field/i.test(title)) return title;
  return '';
}

function competitorByPosition(state, value) {
  const val = String(value || '').trim();
  if (!val) return null;
  return (state.importedCompetitors || []).find(c => String(c.position || '').trim() === val || String(c.lane || '').trim() === val) || null;
}

function statusForPosition(state, pos) {
  const s = state && state.athleteStatuses ? state.athleteStatuses[statusKeyForPosition(pos)] : '';
  return ATHLETE_STATUSES.includes(s) ? s : '';
}

function splitRunmeetGenderPrefix(value) {
  const text = cleanText(value).replace(/[\u2022·]/g, '').replace(/’/g, "'");
  const match = text.match(/^(Mixed|Co-?Ed|Girls'?|Boys'?|Women's|Men's|Female|Male|F|M|X)\s+(.+)$/i);
  if (!match) return { gender: '', eventName: text };
  return { gender: normalizeRunmeetGenderLabel(match[1]), eventName: cleanText(match[2]) };
}

function normalizeRunmeetRace(rawLabel) {
  const original = cleanText(rawLabel);
  const match = original.match(/^(Heat|Section|Flight)\s*(\d+)/i);
  if (match) {
    return {
      raceLabel: match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase(),
      raceNumber: Number(match[2]),
      raceDisplay: match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase() + ' ' + match[2],
      originalRaceText: original
    };
  }
  const numeric = original.match(/(\d+)/);
  return {
    raceLabel: original || 'Race',
    raceNumber: numeric ? Number(numeric[1]) : '',
    raceDisplay: original || 'Race',
    originalRaceText: original
  };
}

function stripRelayTeamQuotes(value) {
  return cleanText(value).replace(/^['"`]+|['"`]+$/g, '');
}

function buildImportIssue(name, age, club, meta) {
  const issues = [];
  if (!name) issues.push('missing athlete/team');
  if (!club) issues.push('missing club');
  if (meta.eventName && !/relay/i.test(meta.eventName) && age && !/^\d{1,2}$/.test(age)) issues.push('check age');
  return issues.join('; ');
}

export {
  buildImportIssue,
  stripRelayTeamQuotes,
  normalizeRunmeetRace,
  splitRunmeetGenderPrefix,
  competitorByPosition,
  extractRunmeetMeetId,
  extractRunmeetMeetName,
  normalizeRunmeetGenderLabel,
  parseRunmeetEntry,
  parseRunmeetHeader,
  parseRunmeetHtmlDocument,
  statusForPosition,
  ATHLETE_STATUSES,
  ATHLETIC_NET_HEADERS,
  DISTANCE_EVENTS,
  NO_TIME_STATUSES,
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
  normalizeImportedEventName,
  normalizeRunmeetEventName,
  overallPlacesByRow,
  queueRaceGenderLabel,
  resultRowsToAthleticNetRows,
  resultTimeToMs,
  sanitizeSpreadsheetCell,
  splitAthleteName,
  statusKeyForPosition
};
