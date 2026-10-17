# Changelog

## v0.4.0 — 2026-07-26

**Recorded times now survive a lost connection.** A failed write used to be applied to local state and forgotten — the timer saw their tap, nothing retried it, and a refresh threw it away. Failed writes are now persisted to localStorage as serializable operations and replayed automatically when the connection returns.

- Queued operations describe the smallest fact recorded (this lane got this time; this distance time was pressed), not "write this whole race". Replaying a whole state would overwrite work other devices did while this one was offline.
- Replay merges conservatively: a lane time is only written into an empty lane, so a time another device already recorded is never overwritten; a distance time is only appended if it isn't already present. Each operation is stamped with the race it belongs to and is discarded if the meet has moved on, so a stale time can never land on a later race.
- The queue drains when Firebase reports the connection restored, when the meet changes, and on a 15-second retry while anything is outstanding. An "N unsynced" badge appears next to the connection status and can be tapped to retry immediately.
- Starting or resetting a race is deliberately NOT queued — replaying it later would overwrite the meet's subsequent work. That case now says so plainly instead of implying the race is fine.

**Timer login is throttled and PINs are longer.** The login endpoint is public and a 4-digit PIN is only 10,000 guesses.

- Six failed attempts for a meet + timer number within 15 minutes locks that pair out, with an HTTP 429 and a message telling the timer how long to wait. A correct PIN clears the counter. Counters live outside `meets/`, where no client can read or reset them.
- New PINs must be at least 6 digits. Existing 4-digit PINs keep working; re-saving one upgrades it.

**Domain logic extracted and tested.** Parsing, results assembly, and export mapping — the layer where every bug this project has shipped actually lived — now sits in `domain.mjs` as pure functions with no DOM, Firebase, or app state.

- `tests/run-tests.mjs`: 25 unit tests, no dependencies, most of them regressions standing for real shipped bugs.
- `tests/regression-export.mjs`: parses the sample RUNMEET file, simulates a meet, and byte-compares the resulting CSV against a file Athletic.net accepted. It passes on this release, which is how the extraction was verified to change nothing.
- `index.html` drops from 5,586 to 5,316 lines. The service worker precaches `domain.mjs` (the app cannot boot without it) and `netlify.toml` pins the `.mjs` content type so the module always arrives executable.

## v0.3.5 — 2026-07-25

- **DQ and DNF now publish their status in the Result column** instead of a bare time. Previously a disqualified athlete uploaded as a normal time with no place, which on Athletic.net is indistinguishable from a result that simply wasn't counted — the athlete looked skipped rather than disqualified.
- **DNF athletes with no recorded time are no longer dropped from the export.** The old filter required a result value, so a runner who never finished (the usual case — no time to record) vanished from the upload entirely. DQ/DNF rows are now included regardless of whether a time was captured.
- DNS and SCR remain excluded: those athletes did not compete. (One-line change if a future meet needs them published as marks.)
- Places are unaffected: DQ/DNF receive no placement, and the remaining finishers still compact to 1, 2, 3… Verified on the simulated meet — the women's 100m hurdles now reads 1–5 plus a DQ row marked DQ, and the 1500m DNF appears as its own row rather than disappearing.

## v0.3.4 — 2026-07-25

- **Overall place is now published in the results CSV.** The `[Place]` column was previously left blank on the assumption that Athletic.net would compute placement on import; a real upload showed it does not, so every event came in with no places. Place is now computed at export time by ranking recorded times across **all heats/sections of the same event + gender + division**, which is what `[Place]` means — the timing screen only ever knew placement within a single heat (`[HeatPlace]`, unchanged).
- Ties are decided on the **published mark**, not raw milliseconds: two athletes whose exported times read the same share a place and the next place skips (1, 2, 2, 4). Ranking still uses raw milliseconds so ordering is stable when marks are equal.
- DQ and DNF rows keep their recorded time and receive **no** place; SCR/DNS never reach the export. Verified on a full simulated meet: 243 of 244 rows placed, the single unplaced row being the DQ; zero place/time ordering violations across all events; every event's fastest finisher is place 1.
- Overall place falls back to parsing the formatted result when a saved race predates the raw-millisecond field, so meets resumed from older snapshots still export placements.

## v0.3.3 — 2026-07-25

- Results now export as **CSV** instead of .xlsx. Both export buttons ("Export CSV" for the current race, "All CSV" for the whole meet) write the same 62-column Athletic.net layout — identical columns, identical values, identical filtering (finishes only; SCR/DNS rows stay out) — just as a text file. Verified by exporting a full simulated meet through both paths and diffing cell-by-cell against the previous .xlsx output: 15,190 cells, zero differences.
- Formula-injection protection is unchanged: every cell still passes through sanitizeSpreadsheetCell before quoting, so values starting with = + - @ are prefixed. Fields containing commas, quotes, or newlines are quoted and internal quotes doubled, per RFC 4180. Line endings are CRLF; no UTF-8 BOM is written, since the file's purpose is uploading to Athletic.net and a BOM can attach itself to the first header in stricter parsers.
- Removed the vendored SheetJS library (~880 KB) and its CDN fallback script — nothing else used it. The service worker's precache list dropped the same entry; leaving it would have failed the whole worker install (cache.addAll rejects if any listed file 404s) and silently killed offline support.

## v0.3.2 — 2026-07-18

- Adult divisions keep their gender wording on the timing screen: "Women's"/"Men's" groups now display as Women/Men in race tabs and roster buckets instead of being normalized to Girls/Boys. Youth labels are unchanged; cross-gender merges still read Mixed. Each group's own gender now takes precedence over the combined label's F/M shorthand, so adult combined races label correctly too, and a same-sex youth+adult combination names both (e.g. "Girls/Women"). Verified with a 12-case unit test.

## v0.3.1 — 2026-07-18

- Unified the timing roster's two render paths: races loaded without meet-queue context now flow through the same bucket/heat pipeline as queue races, via a synthetic roster item wrapping the loaded race's competitors. The separate fallback renderer — source of two prior bug rounds (missing sticky header, float-right legend) — is deleted, along with its now-dead CSS.
- Side effects of unification: the non-queue path gains the distance Record Time bar (previously missing there), collapsible age-group/heat presentation, and director status dropdowns rendered identically; its rows are not draggable (no import-roster identity to move), which the renderer now expresses explicitly instead of by accident.

## v0.3.0 — 2026-07-18

Consolidated release covering all work since v0.2.14.

**Security**
- Server-side timer PIN verification: a Netlify Function verifies PINs (timing-safe, non-enumerable errors) and mints meet-scoped Firebase custom tokens; database rules enforce token claims on currentRace, and PIN hashes are owner-only. Deployed and verified.
- XSS and CSV/XLSX formula-injection fixes re-applied and audited across all new surfaces.

**Timing screen**
- Two-level roster (age-group dropdowns containing per-heat dropdowns), sticky header block (clock, banner, event title, aligned column headers) with the timing column as its own scroll container, 30% narrower sidebar, single Back to Setup button in the top bar.
- Athlete statuses (SCR / DNS / DNF / DQ), director-set, synced to all devices; SCR/DNS lanes don't block auto-finish and drop from the finished count; explicit statuses override derived results and compact placing.
- Starter capability: timer assignments can grant a Start Race button, enforced in masterStart.
- Athlete moves (drag-and-drop or dropdown, both screens) prompt for the destination lane with collision handling; roster lane/hip cells directly editable; setup-screen roster editor restored (was unreachable).

**Documents**
- All printed documents restyled to Athletic.net RUNMEET formats from provided samples: Meet Program (single-line rows, grouped heats, Finals chips, optional two-column layout), Finish Line Sheets (stacked age/seed, wide Place/Time write-ins, fit-based page packing), Horizontal Field Sheets (portrait, six attempts), Vertical Field Sheets (landscape, twelve evenly-sized height boxes with attempt-divider ticks).
- Officials signature rows removed from all documents.

**Data & meets**
- Bib number extraction from RUNMEET HTML (badge-in-name-cell format, verified against a real bib-assigned export; 552/560 entries captured with relays correctly bib-less).
- Supabase historical archive: schema, director auth, publish-with-retry.
- Identity-based saved-race keys (queue reorders can no longer misattribute results), with legacy-key migration.
- Meet Summary reorganized (track/field columns, distinct combined counts, Total Flights counted like Queued Races).
- Combined race/flight wording made event-type aware; cross-gender merges labeled Mixed.

**Packaging**
- Deploy bundle now actually contains sw.js (network-first app shell, versioned cache), manifest.json, and a vendored xlsx.full.min.js — previously referenced but missing, so offline support silently didn't work. The service worker cache version is tied to the release and must be bumped each release.

<details><summary>Detailed entries for v0.3.0</summary>

### bib numbers + two-column meet program
- The RUNMEET parser now extracts bib numbers when Athletic.net has assigned them. In the real export format (verified against an actual bib-assigned HTML file), the bib renders as a <web-comp-number> badge inside the name cell; the parser reads the badge element and strips its text from the athlete name — previously names would have imported as "#533 Klein, Mireya". A pure-numeric second column is also handled defensively in case other export variants place the bib in its own cell. Verified end-to-end against the provided file: 560 entries, 552 bibs captured, relay rows unaffected, all spot checks matching the printed program. Bibs flow through parsed entries, saved snapshots, and the timing race payload.
- The Meet Program shows a bib column ("#533") between lane and athlete whenever any imported entry carries a bib; bib-less meets print exactly as before.
- Added "Meet Program (2-Col)" buttons on the setup screen and the timing sidebar, matching the AthleticRUNMEET PDF layout: two columns with each event block kept whole, and compacted row/heading sizes for the narrower column width.
- Fixed a latent wiring hazard: the program buttons passed the click event into the builder, which would have been read as a truthy layout flag; both now call with explicit arguments.

### Meet Program matched to Athletic.net sample
- Removed the stacked athlete blocks from the Meet Program; rows are single-line again (Lane, Athlete, italic Age, Club, Seed) with no row borders, per the sample.
- Heats now group under ONE event heading like the sample ("#32 Boys' 50 Meter 9-10" followed by "Heat 1" / "Heat 2" bold subheads) instead of repeating the heading per heat; consecutive races sharing an event heading merge into a block, separated by a light rule.
- Header matches the sample composition: centered navy meet name, date line, and a centered "Meet Program" title. Event headings split the age group into a bolder segment and carry a boxed "Finals" chip (RUNMEET exports are finals-format; Field/Combined chips are appended when applicable).

### height box borders restored
- Restored the solid borders between vertical-sheet height boxes. The attempt-divider ticks had been positioned on the table cells themselves; a relatively-positioned cell inside a border-collapse table drops its solid borders (browser rendering quirk). The ticks now live on an inner wrapper element, so both the solid box borders and the attempt dividers render together.

### attempt dividers in height boxes
- Vertical field sheet height boxes now contain two short gray divider ticks splitting each box into thirds — one slot per attempt at that height (X / X / O convention), matching the Athletic.net sample. Implemented as bordered elements rather than CSS backgrounds so they print reliably regardless of the browser's "background graphics" setting. Best and Place boxes remain plain, as in the sample.

### 12 height columns on vertical field sheets
- Vertical field sheets expanded from 8 to 12 boxed height columns, with the height, Best, and Place boxes evenly sized (46px each, fourteen equal boxes) within the 960px landscape width (athlete block 194px, Division 88px).

### stacked age/seed in all printed reports
- Age and Seed now stack inside the athlete block (age on the name line, seed on the club line — Athletic.net style) in ALL printed reports; the Meet Program already used this layout, and the Finish Line Sheets and vertical field sheets now match the horizontal field sheets.
- Finish Line Sheets: Age and Seed columns eliminated; remaining columns are Lane/Hip, athlete block, Division, Place, Time, with Place widened to 90px and Time to 150px for handwriting. Rows are 32px (two-line blocks); the boilerplate note line was removed from sprint sections so three 6-lane heats still fit per page (verified: 4/5/6-lane heats pack 3 per page, 8-lane packs 2). The packing estimator was updated to match (61px chrome for sprint sections, 85px for distance sections which keep their note, 33px per row).
- Vertical field sheets: Age and Seed columns eliminated; the eight height columns widened from 48px to 52px and the athlete block to 252px. Blank write-in rows and headers updated on both documents.
- CSV and XLSX exports are unchanged — those are data formats where one value per column is correct.

### field sheet orientation & six attempts
- Horizontal field sheets: PORTRAIT with six attempt columns (Attempt 1-3, spacer, Attempt 4-6). Made to fit by stacking age on the athlete's name line and seed on the club line (Athletic.net style), eliminating the Age and Seed columns; the Division column remains. Column headers over the name block are blank, matching the sample.
- Vertical field sheets: landscape (@page letter landscape, 960px printable), with the Division column restored and height columns widened to 48px.
- Removed the Event Judge / Recorder / Referee signature row from field sheets (the last remaining officials row in any download) and its now-unused CSS.

### server-side timer PIN verification
- Timer login now posts to a Netlify Function (netlify/functions/timer-login.js) that verifies the PIN server-side (timing-safe compare, generic errors that don't reveal which timer numbers exist) and mints a Firebase custom token carrying meetId/timerNumber/lanes/canStart claims; the client signs in with that token.
- firebase-rules.example.json now enforces the claims: currentRace read/write requires auth.token.meetId === $meetId or meet ownership; timerAssignments (including PIN hashes) is owner-only; the legacy top-level currentRace node is restricted to non-anonymous accounts.
- Added netlify.toml and package.json (firebase-admin) so the function deploys with the site. README documents the two required environment variables and the deploy order (function first, then rules).
- Refreshing a timer device still requires re-entering the PIN; persisted custom-token sessions are signed out on load.

### audit fixes
- Cross-gender merges are labeled "Mixed" (matching the combine-label convention) instead of "Combined", fixing "Combined All Ages (Combined)" bucket titles and "- Combined" tab doubling.
- Saved races now use identity-based keys (combined ID, or group ID + event + race number) instead of queue position, so saved results and Complete badges stay attached to the correct race if the queue is rebuilt mid-meet (combining, clearing combinations, reordering). Restored snapshots migrate legacy positional keys while positions still match; Complete checks accept both key forms during transition.
- Removed dead CSS: .timing-sidebar-footer rules, the superseded .timer-return-bar rule, and the unused .prog-stamp document rule.

### fallback roster header fix
- The fallback roster render path (used when a race loads without event-queue context) still had the old float-right bullet legend inside the scrolling roster box. It now writes the same aligned column header into the sticky header container as the main path, so Pos/Athlete/Age/Club/Seed columns are pinned in the header and sit over their columns in all cases.

### timing sticky header fix — root cause
- Root cause of the header rows scrolling: .timing-sticky-controls (the clock/controls/banner block) was never actually sticking — html/body's height:100% + overflow-x:hidden alters the page's scroll container and defeats viewport sticky. On desktop the timing main column is now its own scroll container (height: calc(100vh - 53px); overflow-y: auto) and the header block sticks to its top, making the behavior independent of page-level overflow settings. Mobile/timer layouts are untouched (change is scoped to min-width 991px). The internal scroller resets when returning to Setup.

### header rows moved into sticky controls
- The event title row and the roster column-header row are now physically inside the sticky clock/controls/banner block, pinning as one continuous header directly beneath "Press Start when ready" — replacing the previous JS-measured sticky offsets (that machinery is removed).
- The column header renders into a fixed container whose horizontal padding matches the workspace+panel padding at both breakpoints, keeping headers aligned over the roster columns. Both rows hide with the roster/panel and on the timer-role phone layout.

### sidebar width + single back button
- Timing screen sidebar narrowed 30% (grid column minmax(250px, 28%) -> minmax(175px, 19.6%)); mobile/collapsed layouts unaffected.
- Removed the duplicate sidebar "Back to Setup" button and its listener; the topbar button is the single way back. The empty sidebar footer div was removed with it.

### Back to Setup + combined naming consistency
- The "Back to Parse / Setup" button is renamed "Back to Setup" and moved into the timing screen's top row (next to the wordmark); the timing sidebar's back button matches. All existing show/hide logic is preserved.
- Combined-race naming on the timing screen aligned after an audit:
  - Race tabs no longer show "Heat 1" for combined items (that was the first merged group's number); they now say "Combined".
  - Age-group bucket titles use the same normalized wording as the tabs (Girls/Boys/Mixed + division) instead of raw group text or the full combined label; combined buckets read e.g. "Mixed All Ages (Combined)".
  - The nested combined dropdown lists its source heats, e.g. "Combined race — Heat 1 + Heat 2".

### two-level timing roster
- The timing screen's event roster is now organized as age-group dropdowns (e.g. "Girls 5-6") with each heat as its own nested dropdown inside — heat names no longer appear at the top level. Combined races/flights form their own top-level dropdown labeled with the combined label.
- The age-group row shows aggregate status (Active/Complete/Pending), heat count, and total entries; the active race auto-expands both its age group and its heat. Drag-and-drop targets remain on the individual heat sections.

### sticky timing headers
- On the director timing screen, the event heading row and the roster column header are now sticky while heats scroll beneath them — pinned directly under the sticky clock/controls/"Press Start" banner block rather than the top of the window, with offsets measured live so control-bar height changes (banner text, wrapped tabs, window resizes) can't cause overlap.
- The second row no longer repeats the event title; it is now a proper column header row (Lane/Pos, Athlete, Age, Club, Seed, Time or Place/Time) that reuses the roster row grid, so headers align exactly with the data at every breakpoint.
- The header offset tracks the heading row's height (so wrapped race tabs don't cause overlap). The timer-role mobile layout, which uses stacked cards, hides the header row.

### Total Flights counting
- Total Flights in the Meet Summary now counts flights the way Queued Races counts races: a combined flight counts as one flight rather than one per merged source group (uses the same queueGroupKey grouping as documents and the timing queue).

### Meet Summary layout
- Meet Summary reorganized: Meet ID as a full-width row on top, then a track column (Track Events, Track Athletes, Relay Teams, Combined Races, Queued Races) beside a field column (Field Events, Field Athletes, Combined Flights, Total Flights, Warnings).
- New/changed metrics: Field Events (distinct events, matching Track Events), Track Athletes (active track individuals, excluding relay teams; replaces the all-events Competitors card), and Total Flights (renamed from Field Flights).

### re-seeding tool removed
- Removed the day-of re-seeding tool (the Re-seed checkbox and Lanes input in the combine row, and the seed-parsing/waterfall/reseed functions). Combining once again preserves athletes' original lane/hip positions. Heat arrangement is done in Athletic.net; lane changes for individual athletes remain available via the roster panel's editable Lane/Hip cell and the lane prompt on moves.

### field events in Meet Summary
- Meet Summary now shows Field Flights (flight count), Field Athletes (active field entries), and Combined Flights (distinct merged flights).
- The Combined card is now labeled Combined Races, counts track only, and both combined cards count distinct combined races/flights rather than the number of source groups merged (previous count included every merged group, so one combination of 3 groups showed as 3).

### lane choice on athlete moves
- Moving an athlete between heats (drag-and-drop or the Move dropdown, on both the setup and timing screens) now prompts for their lane/hip in the destination, pre-filled with the next open slot. If the chosen lane is occupied, OK bumps the occupant to the next open lane and Cancel places the moved athlete there instead.
- Fixed a latent collision: moves previously carried the athlete's old lane number into the new heat, silently duplicating lanes.
- The Lane/Hip cell in the setup-screen roster panel is now directly editable; entering an occupied lane offers a swap with its current occupant. Changes re-sort the heat and refresh the loaded race.

### roster editor restored on setup screen
- Fixed: the Build Races roster editor (Add to Heat write-in form, Move To dropdown, drag-and-drop rows) existed in code but had no UI trigger — the Athletes column was rendering empty, so the feature was unreachable. Each heat now has a Roster button in the Athletes column that opens its roster panel inline.
- Roster buttons are also drag-drop targets: drag an athlete row from an open roster and drop it on another heat's button to move them (same-event heats only). Multi-heat age groups show one button per heat.
- The timing-screen drag-and-drop was unaffected and continues to work.

### day-of re-seeding on combine
- Combining groups can now re-seed the combined race (checkbox in the combine row, on by default, with a configurable lane count remembered across sessions):
  - Lane races: entries sorted fastest seed first, assigned center-out waterfall lanes (4-5-3-6-2-7-1-8 pattern, verified against Athletic.net samples); unseeded entries follow in original order into outer lanes; a warning notes any overflow beyond the lane pool.
  - Distance races: sequential hip numbers by seed, fastest first, unseeded last.
  - Combined field flights: competition order with best mark last, unseeded first.
- Seed parsing handles times (ss.hh, m:ss.hh, h:m:ss), imperial marks (135-01.00, 12' 4"), and metric (3.5m); unparseable seeds are treated as unseeded.
- Single-race output by design: this is a day-of tool. Pre-meet heat arrangement should still happen in Athletic.net, then re-export and re-import.

### full-width meet program
- Meet Program entry tables now span the full printable page width (was a fixed 560px), and the lane/hip number column widened from 30px to 46px so two-digit numbers display fully.

### Athletic.net-style meet program
- Meet Program restyled to match Athletic.net's RUNMEET program (based on provided sample): centered navy meet header with date/meet-ID line; navy event headings in the "#101 Girls' 100 Meters 7-8 - Heat 1 of 2" composition with boxed chips for Field/Combined; headerless entry tables where each athlete is a two-line block (bold name with age at right; club with seed at right beneath) and a lane/hip number at left.
- Removed the previous column-header table layout, the event double-rule separator, and the now-unused DOC_PROGRAM_WIDTH constant. Division info shows on the athlete's top line only for combined/multi-group races.

### Athletic.net-style field sheets
- Field Event Sheets restyled to match Athletic.net's RUNMEET field sheets (based on provided samples): a header band with the meet name left and "#<event numbers> <event>" right; a sub-line with flight info and date; club stacked under the athlete's name (separate Club column removed, freeing width); attempt, Best, and Place cells drawn as outlined boxes; normal-case bold column headers; taller rows (42px horizontal, 38px vertical) with light separators.
- Vertical sheets' eight height columns widened to 40px with boxed blank headers for writing bar heights.
- Meet Program and Finish Line Sheets are unchanged (no samples provided for those).

### timing sidebar field sheet split
- The director timing screen's Meet Documents sidebar now offers Field Sheets (Horizontal) and Field Sheets (Vertical), matching the setup screen. This also fixes a latent bug from the original split: the old single sidebar button was silently printing horizontal sheets only.

### combined column fix
- The Combined Race / Flight column (and its ✕ clear button) now only shows for age groups that are actually part of a combined race or flight. Previously the label fallback included the event name, so uncombined rows displayed a stray label and clear button.

### combined flight wording
- All user-facing "combined race" wording is now event-type aware: field events say "combined flight" in the inline roster tools, clear buttons/tooltips, toasts, and status messages. The shared review-table column header now reads "Combined Race / Flight".

### starter capability & athlete statuses
Starter:
- Timer assignments can grant a "Starter" flag; starter timers see a Start Race button and the "Press Start when ready" banner. masterStart() rejects non-director, non-starter callers. Assignment list shows a Starter tag.

Athlete statuses (SCR / DNS / DNF / DQ):
- Directors can set a per-athlete status from the timing screen: a dropdown on each lane card and on each roster row (lane and distance modes). Statuses sync through race state to all devices.
- SCR and DNS block time recording for that lane (stop buttons disabled and guarded in stopLane), are excluded from the finished count denominator, and don't hold up race auto-finish.
- Results: an explicit status always wins over the derived OK/DNS; athletes with any explicit status receive no place and remaining places compact. DQ/DNF keep a recorded time visible in results. SCR rows remain in the CSV but are excluded from the Athletic.net XLSX (existing filter).
- Distance races additionally emit status-only result rows for roster athletes marked SCR/DNS/DNF/DQ who never recorded a finish.

### 27px finish sheet rows
- Finish Line Sheet rows set to 27px (entry and blank rows), with the packing estimator updated to match. Three heats fit per page for races up to 6 lanes; 8+ lane heats print two per page.

### fit-based finish sheet packing
- Finish Line Sheets now pack sprint heats onto each page based on an estimated section height (fixed 30px rows make this deterministic), including a 3rd heat when it fits, capped at 3 per page. Distance races keep a full page. Queue order is always preserved; a conservative 920px budget avoids overflow, and page-break-inside remains as a rendering backstop.

### finish sheet signature row removed
- Removed the Timer / Recorder / Referee signature row from each Finish Line Sheet page. The Event Judge / Recorder / Referee row on Field Sheets is unchanged.

### field event combining
- Field events now appear in the Build Races table alongside track events (Track/Field chips distinguish them) and can be combined: selecting flights of the same field event merges them into one flight on the Field Sheets, with each athlete's Division shown per row.
- Field combinations require only the same event name (flight numbers may differ); track combinations still require the same event and race number. Track and field rows cannot be combined with each other.
- Field events can never enter the timing queue: their Include in Timing checkbox is disabled, the queue builder skips them, timing toggles force them off, and loading one to the timer is rejected with a clear message.

### field sheet split & Division rename
- Field Event Sheets are now two separate exports: Field Sheets (Horizontal) for jumps/throws and Field Sheets (Vertical) for high jump/pole vault, each with its own button, document title, and page headers.
- The "Group" column header is renamed to "Division" in the printed documents (Meet Program, Finish Line Sheets, and horizontal Field Sheets; vertical sheets have no such column).

### document column alignment
- All three printed documents now use fixed table layout with explicit widths for every column, so tables align exactly from race to race and page to page.
- The Group column is always present in the Meet Program, Finish Line Sheets, and horizontal Field Event Sheets (previously it appeared only for combined races, shifting other columns).
- The Meet Program and Finish Line Sheets share identical widths for all common columns (Pos/Athlete/Age/Club/Group/Seed), so those columns also align across the two documents; the Program's table is fixed at 570px, the Finish sheets fill the 720px printable width with Place/Time.
- Field Event Sheets align internally per variant; vertical (HJ/PV) sheets drop the Group column to fit the eight height columns. Long names now truncate with an ellipsis instead of disturbing column widths.

### finish line sheet pagination
- Sprint (lane) races now print two heats per Finish Line Sheet page, separated by a dashed rule, with the page header reading "Races 3–4 of 12". Distance races keep a full page to themselves. Pairing follows queue order; a sprint race adjacent to a distance race gets its own page.

### report formatting & consistency
- Whole-meet Athletic.net XLSX is now named after the meet instead of the currently loaded race.
- `[Heat]` in the Athletic.net XLSX is only populated from explicit "Heat/Race/Section/Flight N" labels (or bare numbers); custom labels leave it blank instead of grabbing stray digits.
- `[HeatPlace]` keeps the within-heat place; `[Place]` is now left blank for Athletic.net to compute overall placements.
- Meet Program now draws a visible break (double rule + spacing) when moving to a new event; previously the event-break logic computed but rendered nothing.
- Field Event Sheet page headers now read "Flight X of N" to match the Finish Line Sheets' "Race X of N" wording.
- The three printed documents share one set of column widths (`DOC_COL`), so Pos/Age/Group/Seed columns align across documents.
- Printed column headers renamed: "Athlete / Team" → "Athlete / Relay" and "Team / Club" → "Club".
- Import review CSV filename now includes the meet ID (e.g. `runmeet_import_251234.csv`).
- Results CSV header "Race" renamed to "RaceLabel" to match the import CSV vocabulary.

### per-race combination clearing
- Added a ✕ button next to each combined-race label in the Build Races review table, clearing just that combined race. The existing "Clear This Combined Race" button inside the expanded roster view now shares the same implementation.
- "Clear Combinations" (all-or-nothing) is unchanged and still clears everything.

### setup screen layout
- Removed the Step 1 / Step 2 workflow step cards from the top of the setup screen (and their unused CSS).
- Moved the Meet Program / Finish Line Sheets / Field Event Sheets buttons up, between the Parse HTML button row and the combine label field.
- Pinned the import card header (title, file picker, Parse row, document buttons, and combine/label row) so it stays visible while the race table scrolls beneath it.

### Supabase historical archive
- Added an optional Supabase-backed historical archive for final meet results (`supabase-schema.sql` + a Meet Archive panel on the Parse / Setup screen).
- Publishing uploads the saved races (the same data as the All-XLSX export) to `meets` / `race_results` tables; raw milliseconds are stored alongside formatted times.
- Re-publishing the same Athletic.net meet replaces its archived results instead of duplicating them.
- Failed publishes are kept in localStorage and can be retried; the supabase-js client is loaded lazily only when the archive panel is opened, so live timing and offline behavior are unaffected.
- Archive access uses Supabase email/password auth with Row Level Security; each director account can only read and write its own archive.

### security patch
- Re-escaped event number/name/race fields in the RUNMEET import issue panel before inserting into innerHTML (this had regressed to unescaped in v0.2.14; closes a stored-XSS gap).
- Re-added `sanitizeSpreadsheetCell()` to guard CSV and Athletic.net XLSX exports against formula injection (also regressed in v0.2.14). Values starting with `=`, `+`, `-`, `@`, tab, or CR are now prefixed with `'`.

## v0.2.10

- Reordered combined-race naming so the all-entry-bearing-groups test runs before age-range calculation.
- All available age groups from one gender now produce `F/M <Event> All Ages`.
- All available age groups from both genders now produce `Mixed <Event> All Ages`.
- Partial selections from both genders produce `Mixed <Event> <Age Range>`.
- Partial selections from one gender produce `F/M <Event> <Age Range>`.
- Empty age divisions no longer prevent `All Ages` or continuous-range naming.

## v0.2.7

- Updated automatic all-ages combined heat naming.
- All age groups from one gender now use `M` or `F`, for example `M 3000m All Ages`.
- All age groups from both male and female divisions now use `Mixed`, for example `Mixed 100m Hurdles All Ages`.
- Compact event labels convert names such as `3000 Meters` to `3000m` while preserving descriptors such as `Hurdles` and `Relay`.

## v0.2.6

- Removed the crowded heat-tab row from the timing header.
- Made the left sidebar the primary event/heat navigation.
- Standardized timing labels to `Girls 9-10 - Heat 1`, `Boys 13-16 - Heat 1`, etc.
- Displays all race groups as **Heat**, including source sections.
- Added collapsible heat headers in the merged roster/timing table.
- The active heat expands by default; other heats can be expanded for review or drag-and-drop moves.

## v0.2.3

- Rebuilt the timing screen as a responsive split-pane workspace.
- Added a left meet-navigation pane with event groups, race/heat links, and saved-results progress.
- Kept the clock and director controls sticky above the active event tables.
- Added direct event/heat navigation for directors without returning to Parse / Setup.
- Preserved the merged roster/timing tables, drag-and-drop roster behavior, Firebase synchronization, and XLSX exports.
- Added responsive collapse behavior for tablets and phones.

## v0.2.2

- Event order now defaults to the exact sequence of event blocks in the imported Athletic.net RUNMEET HTML instead of sorting by Athletic.net event number.
- Added an **Event Order** panel with Up/Down controls and **Restore Imported Order**.
- The selected event order is used consistently by the combiner, Start Meet timing queue, Meet Program, Finish Line Sheets, and Field Event Sheets.
- Custom event order is saved with the meet snapshot and restored after a refresh.
- Verified the supplied YMCA All Comers #3 HTML begins with relay events, then 3000 Meters, then 1500 Meters; the app now preserves that sequence.

## v0.2.1

- Fixed RUNMEET parsing for events containing multiple heats, sections, or flights inside one event block. Each heat/flight is now stored as a separate race group instead of flattening all entries into the first heat.
- Meet Program, Finish Line Sheets, and Field Event Sheets now preserve and visibly separate Heat 1, Heat 2, Section 1, Flight 1, Flight 2, etc.
- Tested against `RUNMEET_ YMCA All Comers #3.html`: 146 event blocks expand to 165 distinct heat/section/flight groups while preserving all 619 entries.

## v0.2.0

- **Crash recovery**: the meet (import, combined races, roster edits, saved race results) now snapshots to localStorage after every change; a Resume Saved Meet banner restores everything after a refresh or crash.
- **Clock-skew fix**: race timestamps now use Firebase server time via `.info/serverTimeOffset`, so timer phones with wrong clocks no longer record wrong times.
- **Lost-update fix**: Record Time, Delete Time, and lane stops now use Firebase transactions; simultaneous presses on two devices can no longer overwrite each other. The last-lane "race finished" check moved inside the transaction, closing a race where two simultaneous final stops left the race never marked finished. Verified live with two browser clients stopping lanes at the same millisecond, including the final-two-lanes collision.
- **Lane validation**: stopping a lane number that is not part of the current race is now rejected inside the transaction (previously a stray tap/keypress could write a time for a nonexistent lane, which then leaked into the XLSX export).
- **Offline**: vendored `xlsx.full.min.js` locally (CDN is fallback only), added the missing `manifest.json`, and added a service worker that caches the app shell — the app loads and exports with no internet after the first visit.
- **Boot fix**: no longer subscribes to the legacy default `currentRace` Firebase path at startup, which the database rules deny — this removed the permission_denied console error and false "Offline" status on every load.
- **Cleanup**: extracted all CSS to `styles.css`; removed dead code (unwired buttons `btn-add-export`/`btn-load-imported-race`/timing filter trio, the hidden legacy Selected Heat Roster panel and its duplicate add-athlete implementation, `buildHeatCSVBlock`, a no-op backward-compat loop in Download All); renamed `exportCSV` to `exportCurrentRaceXlsx` to match what it does.
- **Accessibility**: pinch-zoom re-enabled (removed `user-scalable=no`); muted/dim text colors are actual grays again instead of black-on-black-on-black; fixed invalid `apple-mobile-web-app-status-bar-style` value.
- Added `firebase-rules.example.json` with recommended locked-down Realtime Database rules and an honest note on the limits of anonymous auth.

## v0.1.37

- Added printable Meet Documents (Meet Program, Finish Line Sheets, Field Event Sheets) generated from the imported meet, honoring combined races, flights, roster edits, and excluded rows.
- Documents open in a new tab as self-contained HTML; print or save as PDF from the browser (no external services).
- Meet name is now parsed from the RUNMEET HTML and used in document headers.


</details>

## v0.1.36

- Merged distance race roster/timing display into the event roster table.
- Removed the duplicate imported entries list for distance races.
- Added distance-row assignment controls so recorded times can be assigned directly from athlete rows.
- Preserved space-bar Record Time behavior and XLSX export data.

## v0.2.4

- Added a dedicated **Next Race** button to the timing screen.
- Added meet name and Athletic.net Meet ID to the left-side timing navigation.
- Meet metadata is now included in the Firebase race state so timer devices can display it too.

## v0.2.5

- Added director-only Meet Program, Finish Line Sheets, and Field Event Sheets controls to the timing sidebar.
- When every available age group for an event/race is selected for combination, the generated label is now `<Event> All Ages` and the combined division is stored as `All Ages`.

## v0.2.9

- Extended combined-race age naming across unavailable age groups.
- If an omitted age group has no entry-bearing race group for the same event, heat, and gender, the selected ages collapse to one continuous range.
- Example: male 1500 Meters groups 7-8, 9-10, and 13-14 become `Combined M 1500 Meters 7-14` when no male 11-12 group has entries.
- An existing, unselected age group inside the span prevents the range from being collapsed.
- Preserved full event names such as `3000 Meters` rather than abbreviating them to `3000m`.

## v0.2.11

- HTML parser review now displays one summary row per event, gender, and age group.
- Multiple heats within an age group are no longer shown as separate parser rows.
- The Entries column shows the total active entries across all underlying heats.
- Heat boundaries remain preserved internally for generated sheets, timing, rosters, and export.

## v0.2.12

- Enforced timer lane assignments in every timing control path.
- Stop buttons for lanes not assigned to the current timer are now disabled in the merged roster/timing view.
- Added a guard inside the lane-stop function so touch, click, keyboard, or direct calls cannot stop an unassigned lane.
- Director devices retain control of every lane; a blank timer assignment continues to mean all lanes.

## v0.2.13

- Added a dedicated phone layout for timer devices.
- Removed director navigation, document controls, and Parse/Setup controls from the phone timer view.
- Moved the live clock near the top and made it sticky while scrolling.
- Added a compact meet, Meet ID, event, heat, assigned-lane, and heat-progress summary.
- Timer phones show only the active heat and assigned lanes by default, with a Show all lanes toggle.
- Reworked roster rows into large mobile tap targets with prominent lane numbers and Stop buttons.

## v0.2.14

- Added a required authentication screen before entering the application.
- Directors now sign in with Firebase Email/Password Authentication.
- Added director account creation, persistent sessions, and Sign Out.
- Added meet-specific timer assignments with timer number, PIN, and lanes.
- Timer devices now join using Meet ID, timer number, and PIN; lane assignments load automatically.
- Added a Timer Assignments panel for directors.
- Added owner records for imported Athletic.net meets.
- Added `firebase-rules.example.json` for authenticated Realtime Database access.
- Timer PINs are stored as SHA-256 hashes rather than plain text.
