// Timer login: verifies the timer PIN server-side and mints a Firebase
// custom token carrying { meetId, timerNumber, lanes, canStart } claims.
// Database rules can then enforce auth.token.meetId === $meetId, so the PIN
// gates the DATABASE, not just the app UI, and PIN hashes never need to be
// readable by clients.
//
// Required Netlify environment variables (Site settings -> Environment):
//   FIREBASE_SERVICE_ACCOUNT  - the full service-account JSON (one line)
//   FIREBASE_DATABASE_URL     - e.g. https://<project>-default-rtdb.firebaseio.com

const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) {
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  admin.initializeApp({
    credential: admin.credential.cert(svc),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const respond = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const clean = v => String(v || '').trim().replace(/[^A-Za-z0-9_-]/g, '');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });
  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return respond(400, { error: 'Invalid request body.' }); }

  const meetId = clean(payload.meetId);
  const timerNumber = clean(payload.timerNumber);
  const pin = String(payload.pin || '');
  if (!meetId || !timerNumber || !pin) {
    return respond(400, { error: 'Meet ID, timer number, and PIN are required.' });
  }

  // ── Throttling ───────────────────────────────────────────────────────────
  // A 4-6 digit PIN is only a few thousand guesses; without a limit this
  // endpoint is brute-forceable in minutes. Failures are counted per meet +
  // timer number and the pair is locked out after MAX_ATTEMPTS within
  // WINDOW_MS. Counters live outside `meets/` so no client can read or reset
  // them (top-level rules deny everything not explicitly allowed).
  const MAX_ATTEMPTS = 6;
  const WINDOW_MS = 15 * 60 * 1000;
  const attemptsRef = admin.database().ref(`loginAttempts/${meetId}/${timerNumber}`);

  try {
    const now = Date.now();
    const attemptSnap = await attemptsRef.get();
    const record = (attemptSnap.exists() && attemptSnap.val()) || {};
    const windowStart = Number(record.windowStart || 0);
    const fails = windowStart && (now - windowStart) < WINDOW_MS ? Number(record.fails || 0) : 0;
    if (fails >= MAX_ATTEMPTS) {
      const waitMs = WINDOW_MS - (now - windowStart);
      const waitMin = Math.max(1, Math.ceil(waitMs / 60000));
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(waitMs / 1000)) },
        body: JSON.stringify({
          error: `Too many incorrect attempts. Try again in ${waitMin} minute${waitMin > 1 ? 's' : ''}, or ask the meet director to reset your PIN.`
        }),
      };
    }

    const recordFailure = async () => {
      await attemptsRef.set({
        fails: fails + 1,
        windowStart: fails === 0 ? now : windowStart,
        lastAttemptAt: now,
      }).catch(() => {});
    };

    const snap = await admin.database().ref(`meets/${meetId}/timerAssignments/${timerNumber}`).get();
    // Same error for "no assignment" and "wrong PIN" so callers can't probe
    // which timer numbers exist.
    const failure = async () => {
      await recordFailure();
      return respond(401, { error: 'Incorrect Meet ID, timer number, or PIN.' });
    };
    if (!snap.exists()) return failure();
    const assignment = snap.val() || {};
    if (!assignment.pinHash) return failure();

    const enteredHash = crypto.createHash('sha256').update(pin).digest();
    const storedHash = Buffer.from(String(assignment.pinHash), 'hex');
    if (storedHash.length !== enteredHash.length || !crypto.timingSafeEqual(enteredHash, storedHash)) {
      return failure();
    }

    // Correct PIN: clear the counter so a fumbled entry earlier in the day
    // never counts against a timer who is now signing in correctly.
    await attemptsRef.remove().catch(() => {});

    const uid = `timer-${meetId}-${timerNumber}`;
    const claims = {
      meetId,
      timerNumber,
      lanes: String(assignment.lanes || ''),
      canStart: assignment.canStart === true,
    };
    const token = await admin.auth().createCustomToken(uid, claims);
    return respond(200, { token, lanes: claims.lanes, canStart: claims.canStart });
  } catch (err) {
    console.error('timer-login error:', err);
    return respond(500, { error: 'Timer login failed. Try again.' });
  }
};
