const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(ACTIVITY_FILE)) return {};

  try {
    const raw = fs.readFileSync(ACTIVITY_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[activity] Failed to read activity.json:', error);
    return {};
  }
}

function saveStore(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[activity] Failed to write activity.json:', error);
  }
}

function getGuildBucket(store, guildId) {
  const existing = store[guildId];
  if (existing && typeof existing === 'object') {
    return existing;
  }

  const created = {};
  store[guildId] = created;
  return created;
}

function normalizeEntry(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const totalSeconds = typeof e.totalSeconds === 'number' ? Math.max(0, Math.floor(e.totalSeconds)) : 0;

  return {
    totalSeconds,
    currentClockInAt: typeof e.currentClockInAt === 'string' ? e.currentClockInAt : null,
    lastClockInAt: typeof e.lastClockInAt === 'string' ? e.lastClockInAt : null,
    lastClockOutAt: typeof e.lastClockOutAt === 'string' ? e.lastClockOutAt : null,
    lastSessionSeconds: typeof e.lastSessionSeconds === 'number' ? Math.max(0, Math.floor(e.lastSessionSeconds)) : 0,
    sessions: Array.isArray(e.sessions) ? e.sessions.filter(s => s && typeof s === 'object') : [],
  };
}

function ensureUserEntry(store, guildId, userId) {
  if (!guildId || !userId) return null;
  const bucket = getGuildBucket(store, guildId);
  const existing = bucket[userId];
  const normalized = normalizeEntry(existing);
  bucket[userId] = normalized;
  return normalized;
}

function getUserActivity(guildId, userId) {
  if (!guildId || !userId) return null;
  const store = loadStore();
  const bucket = store[guildId];
  if (!bucket || typeof bucket !== 'object') return null;
  const entry = bucket[userId];
  if (!entry || typeof entry !== 'object') return null;
  return normalizeEntry(entry);
}

function getCurrentSessionSeconds(entry, nowMs) {
  if (!entry || !entry.currentClockInAt) return 0;
  const startedAtMs = Date.parse(entry.currentClockInAt);
  if (!Number.isFinite(startedAtMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}

function clockIn(guildId, userId, nowMs) {
  if (!guildId || !userId) return null;

  const store = loadStore();
  const entry = ensureUserEntry(store, guildId, userId);
  if (!entry) return null;

  if (entry.currentClockInAt) {
    saveStore(store);
    return { status: 'already_clocked_in', entry };
  }

  const nowIso = new Date(nowMs).toISOString();
  entry.currentClockInAt = nowIso;
  entry.lastClockInAt = nowIso;
  entry.lastSessionSeconds = 0;

  const bucket = getGuildBucket(store, guildId);
  bucket[userId] = entry;
  saveStore(store);
  return { status: 'clocked_in', entry };
}

function clockOut(guildId, userId, nowMs) {
  if (!guildId || !userId) return null;

  const store = loadStore();
  const entry = ensureUserEntry(store, guildId, userId);
  if (!entry) return null;

  if (!entry.currentClockInAt) {
    saveStore(store);
    return { status: 'not_clocked_in', entry };
  }

  const startedAtMs = Date.parse(entry.currentClockInAt);
  const deltaSeconds = Number.isFinite(startedAtMs) ? Math.max(0, Math.floor((nowMs - startedAtMs) / 1000)) : 0;

  const nowIso = new Date(nowMs).toISOString();
  const session = {
    inAt: entry.currentClockInAt,
    outAt: nowIso,
    seconds: deltaSeconds,
  };

  entry.totalSeconds += deltaSeconds;
  entry.lastSessionSeconds = deltaSeconds;
  entry.lastClockOutAt = nowIso;
  entry.currentClockInAt = null;

  entry.sessions = Array.isArray(entry.sessions) ? entry.sessions : [];
  entry.sessions.unshift(session);
  entry.sessions = entry.sessions.slice(0, 50);

  const bucket = getGuildBucket(store, guildId);
  bucket[userId] = entry;
  saveStore(store);

  return { status: 'clocked_out', entry, deltaSeconds };
}

module.exports = {
  getUserActivity,
  getCurrentSessionSeconds,
  clockIn,
  clockOut,
};
