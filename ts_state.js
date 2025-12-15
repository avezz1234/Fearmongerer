const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const TS_FILE = path.join(DATA_DIR, 'tester_scores.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(TS_FILE)) return {};

  try {
    const raw = fs.readFileSync(TS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[ts] Failed to read tester_scores.json:', error);
    return {};
  }
}

function saveStore(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(TS_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[ts] Failed to write tester_scores.json:', error);
  }
}

function getGuildBucket(store, guildId) {
  const bucket = store[guildId];
  if (bucket && typeof bucket === 'object') {
    if (!bucket.testers || typeof bucket.testers !== 'object') bucket.testers = {};
    return bucket;
  }

  const created = { testers: {} };
  store[guildId] = created;
  return created;
}

function normalizeEntry(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const ts = Number.isFinite(base.ts) ? Math.max(0, Math.floor(base.ts)) : 0;
  const lastAwardedSessionId = typeof base.lastAwardedSessionId === 'string' ? base.lastAwardedSessionId : null;
  return { ts, lastAwardedSessionId };
}

function ensureTester(guildId, userId) {
  if (!guildId || !userId) return null;

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const testers = bucket.testers;

  const existingRaw = testers[userId];
  const existed = existingRaw != null;
  const entry = normalizeEntry(existingRaw);

  if (!existed) {
    testers[userId] = entry;
    bucket.testers = testers;
    store[guildId] = bucket;
    saveStore(store);
    return { created: true, entry };
  }

  // Ensure we persist any shape normalization.
  testers[userId] = entry;
  bucket.testers = testers;
  store[guildId] = bucket;
  saveStore(store);

  return { created: false, entry };
}

function getTester(guildId, userId) {
  if (!guildId || !userId) return null;
  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const raw = bucket.testers[userId];
  if (!raw) return null;
  return normalizeEntry(raw);
}

function setTester(guildId, userId, nextEntry) {
  if (!guildId || !userId) return null;

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  bucket.testers[userId] = normalizeEntry(nextEntry);
  store[guildId] = bucket;
  saveStore(store);
  return bucket.testers[userId];
}

function addTs(guildId, userId, delta, { min = 0 } = {}) {
  if (!guildId || !userId) return null;

  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) {
    const existing = getTester(guildId, userId);
    return existing ? existing.ts : null;
  }

  const ensured = ensureTester(guildId, userId);
  if (!ensured) return null;

  const current = ensured.entry;
  const nextTs = Math.max(min, current.ts + Math.trunc(d));
  setTester(guildId, userId, { ...current, ts: nextTs });
  return nextTs;
}

function awardForSession(guildId, userId, sessionId, delta) {
  if (!guildId || !userId || !sessionId) return null;

  const ensured = ensureTester(guildId, userId);
  if (!ensured) return null;

  const current = ensured.entry;
  if (current.lastAwardedSessionId === sessionId) {
    return { awarded: false, ts: current.ts };
  }

  const nextTs = addTs(guildId, userId, delta, { min: 0 });
  setTester(guildId, userId, { ...normalizeEntry({ ts: nextTs, lastAwardedSessionId: sessionId }) });
  return { awarded: true, ts: nextTs };
}

function listTesters(guildId) {
  if (!guildId) return [];

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const testers = bucket.testers && typeof bucket.testers === 'object' ? bucket.testers : {};

  return Object.entries(testers)
    .filter(([userId]) => Boolean(userId))
    .map(([userId, entry]) => ({ userId, ...normalizeEntry(entry) }));
}

module.exports = {
  ensureTester,
  getTester,
  addTs,
  awardForSession,
  listTesters,
};
