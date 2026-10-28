# MeetManager Master Project v0.2.7

Static Netlify app. Main entry point: `index.html`.

Combined all-ages heat labels use compact meet terminology: `M 3000m All Ages`, `F 1500m All Ages`, and `Mixed 100m Hurdles All Ages`.

## Files

- `index.html` — app markup + application JavaScript. The JS stays inline on purpose: external JS modules do not load over `file://`, and keeping it inline means the app still runs if someone opens the file directly instead of serving it. CSS lives in `styles.css`.
- `styles.css` — all styles (extracted from index.html in v0.2.0).
- `sw.js` — service worker; caches the app shell so the app loads and exports offline after the first visit. Active on Netlify (HTTPS) and localhost.
- `manifest.json` — PWA manifest (previously referenced but missing).
- `firebase-rules.example.json` — recommended Realtime Database rules. Paste into Firebase Console → Realtime Database → Rules and publish. See the note inside the file about what anonymous auth can and cannot lock down.

## Event order (v0.2.3)

The imported RUNMEET HTML sequence is the default source of truth for event order. The **Event Order** panel can be used to move entire event types up or down. That same order is applied to the combiner, timing queue, Meet Program, Finish Line Sheets, and Field Event Sheets. **Restore Imported Order** returns to the original Athletic.net sequence.

## Heat/flight separation (v0.2.1)

The RUNMEET parser treats each `.heat-block` as its own race group. Multi-heat sprints and multi-flight field events therefore remain separated throughout the combiner, timing queue, Meet Program, Finish Line Sheets, and Field Event Sheets.

## Crash recovery

The imported meet (entries, combined races, roster edits) and all saved race results snapshot to `localStorage` after every change. If the tab crashes or reloads mid-meet, the setup screen offers **Resume Saved Meet**. "Clear Import" discards the snapshot.

## Timing accuracy and concurrency (v0.2.0)

- Race start/elapsed times use Firebase server time (`.info/serverTimeOffset`), so a device with a skewed clock no longer records skewed results.
- Recording, deleting, and lane stops are Firebase transactions: two devices acting simultaneously can no longer overwrite each other's times.

## Changes in v0.2.0

See CHANGELOG.md.


## Timing screen layout

The timing workspace uses a split-pane design. The left pane lists events and heats and shows meet progress. The right pane keeps the race clock and controls sticky above the active event heat tables. On smaller screens, the navigation pane becomes collapsible.

### v0.2.4 timing navigation

The timing sidebar displays the imported Athletic.net meet name and Meet ID. Directors can move with **Previous Race**, **Next Race**, or **Save + Next Race**.

### v0.2.6 additions

- Directors can open the Meet Program, Finish Line Sheets, and Field Event Sheets directly from the left-side timing navigation.
- Selecting every age group for an event/race automatically names the combined race `<Event> All Ages`.


## Timing navigation update (v0.2.6)

The timing header no longer displays a wrapping row of heat pills. The left sidebar is the primary event/heat selector, with labels such as `Girls 9-10 - Heat 1`. Every race group is presented as a heat, and heat tables in the roster/timing workspace are collapsible.

### Combined-race naming across empty age groups

When selected age groups contain a gap, the app checks whether the missing age group has an entry-bearing group for the same event, heat, and gender. If no such group exists, the generated label spans the gap. For example, selecting male 1500 Meters groups 7-8, 9-10, and 13-14 yields `Combined M 1500 Meters 7-14` when there is no male 11-12 group with entries. If an 11-12 group exists but was not selected, the age labels remain separated.


### Combined-race naming (v0.2.10)

Combined labels now follow this precedence:

- All entry-bearing female groups: `F 1500 Meters All Ages`
- All entry-bearing male groups: `M 1500 Meters All Ages`
- All entry-bearing female and male groups: `Mixed 1500 Meters All Ages`
- Partial female and male groups: `Mixed 1500 Meters 9-14`
- Partial single-gender groups: `F 1500 Meters 9-14` or `M 1500 Meters 7-14`

Age divisions with no active entries do not block an `All Ages` label and may be bridged in a continuous range.

### Parser age-group summaries

The parser review shows one row per event/gender/age group and totals entries across all heats. Individual heats remain stored internally and are still used when generating heat sheets, finish-line sheets, field-event sheets, the timing queue, and exports.

### Timer lane permissions

Timer devices may stop only their assigned lanes. Unassigned-lane controls are disabled, and the timing function independently rejects attempts to stop an unassigned lane. Director devices may control all lanes. Leaving the timer assignment blank intentionally assigns all lanes.

### Timer phone interface

Timer devices on screens 700 px wide or narrower use a focused interface with a sticky clock, meet/race summary, assigned lanes, current heat progress, and large lane stop controls. Director-only navigation and setup controls are omitted. Assigned lanes are shown by default; timers may temporarily show all lanes for roster review.

## Server-side timer PIN verification (Netlify Function)

Timer PINs are verified by a Netlify Function (`netlify/functions/timer-login.js`), which mints a Firebase custom token scoped to the meet and timer number. Database rules (`firebase-rules.example.json`) enforce `auth.token.meetId === $meetId` on `meets/$meetId/currentRace`, so the PIN gates the database itself — PIN hashes are no longer readable by clients, and a device can only write to the meet it authenticated for. Directors are authorized by meet ownership (`ownerUid`) via their email sign-in.

### One-time setup

1. Firebase Console → Project settings → Service accounts → **Generate new private key**. This downloads a JSON file — treat it like a password.
2. Netlify → Site settings → Environment variables. Add:
   - `FIREBASE_SERVICE_ACCOUNT` — the entire JSON file contents, pasted as one value
   - `FIREBASE_DATABASE_URL` — your Realtime Database URL (e.g. `https://<project>-default-rtdb.firebaseio.com`)
3. Deploy the site (the repo now includes `netlify.toml` and `package.json`; Netlify installs `firebase-admin` and publishes the function automatically).
4. Firebase Console → Realtime Database → Rules: paste the contents of `firebase-rules.example.json` and publish. Do this AFTER the function is deployed and verified — publishing the rules first will lock out timer devices still using the old login.
5. Verify: on a timer device, join a meet with a valid PIN (should work) and a wrong PIN (should fail with a generic message).

### Notes

- Timer PINs are still re-entered after a page refresh by design; any persisted token session is dropped.
- The legacy top-level `currentRace` node (used only before a meet is imported, Meet ID `default`) is restricted to non-anonymous (director) accounts.
- The function returns the same error for a wrong PIN and a nonexistent timer number, so timer numbers can't be probed.
- If a director sees a brief permission error immediately after switching to a brand-new Meet ID, the ownership claim raced the first write — reloading resolves it.

## Historical meet archive (Supabase)

Final results can be published to a Supabase (Postgres) archive at the end of a meet. Live timing remains entirely on Firebase; Supabase is only written to when a director presses **Publish Meet to Archive**, and only the races already saved to export are uploaded.

### Setup (one time)

1. Create a project at supabase.com.
2. Open **SQL Editor**, paste the contents of `supabase-schema.sql`, and run it. This creates the `meets` and `race_results` tables with Row Level Security (each director account sees only its own archive).
3. In **Authentication → Providers**, ensure **Email** is enabled.
4. In **Project Settings → API**, copy the **Project URL** and **anon public** key into the `SUPABASE_CONFIG` block near the top of the script in `index.html`.

### Publishing a meet

1. On the Parse / Setup screen, open **Meet Archive (Supabase)** and sign in (or create an archive account — this is separate from the Firebase director login and may use the same email).
2. Run the meet normally. Each **Save + Next Race** adds that race's results to the saved set.
3. After the meet, press **Publish Meet to Archive**. All saved results upload in one batch. Re-publishing the same Athletic.net meet replaces its previously archived results rather than duplicating them.

If the upload fails (for example, poor venue Wi-Fi), the payload is kept in localStorage and the panel offers to retry; nothing about live timing or the results export is affected. Raw times are stored as milliseconds (`result_ms`) alongside the formatted text, so the archive can be queried for season bests, athlete history, and records.

## Authentication setup (v0.2.14)

This version requires Firebase Authentication.

### Firebase Console

1. Open **Authentication** and enable **Email/Password** for directors.
2. Keep **Anonymous** enabled for timer devices.
3. Add the deployed Netlify domain under Authentication authorized domains.
4. In **Realtime Database → Rules**, publish the rules from `firebase-rules.example.json`.

### Director workflow

1. Create a director account or sign in with email and password.
2. Import an Athletic.net RUNMEET HTML file.
3. Open **Timer Assignments**.
4. Create each timer number with a PIN and lane assignment.
5. Give the timer the Athletic.net Meet ID, timer number, and PIN.

### Timer workflow

1. Open the same deployed site.
2. Enter the Meet ID, timer number, and PIN.
3. The app loads the assigned lanes from Firebase and opens the mobile timer interface.

### Security note

Director authentication and database writes are enforced with Firebase Authentication and Realtime Database rules. Timer PIN verification occurs in the browser against a SHA-256 hash stored in Firebase. This is suitable for controlling volunteer access in a meet workflow, but it is not equivalent to server-side credential verification. For stronger protection against a determined attacker, move timer PIN verification into a Netlify Function or Firebase Cloud Function that returns a Firebase custom token with meet/timer claims.
