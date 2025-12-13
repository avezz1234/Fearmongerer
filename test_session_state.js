const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'test_sessions.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(SESSIONS_FILE)) return {};

  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[test-session] Failed to read test_sessions.json:', error);
    return {};
  }
}

function saveStore(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[test-session] Failed to write test_sessions.json:', error);
  }
}

function getGuildBucket(store, guildId) {
  const bucket = store[guildId];
  if (bucket && typeof bucket === 'object') {
    if (!('active' in bucket)) bucket.active = null;
    if (!Array.isArray(bucket.history)) bucket.history = [];
    return bucket;
  }

  const created = { active: null, history: [] };
  store[guildId] = created;
  return created;
}

function generateSessionId() {
  return crypto.randomBytes(4).toString('hex');
}

function getActiveSession(guildId) {
  if (!guildId) return null;
  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const active = bucket.active;
  return active && typeof active === 'object' ? active : null;
}

function listActiveSessions() {
  const store = loadStore();
  const result = [];

  for (const [guildId, bucketRaw] of Object.entries(store)) {
    const bucket = bucketRaw && typeof bucketRaw === 'object' ? bucketRaw : null;
    const active = bucket && bucket.active && typeof bucket.active === 'object' ? bucket.active : null;
    if (active && active.channelId) {
      result.push({ guildId, session: active });
    }
  }

  return result;
}

function startSession({
  guildId,
  channelId,
  startTimeText,
  startAtUnix,
  durationMinutes,
  announcedBy,
  announcementChannelId,
  announcementMessageId,
}) {
  if (!guildId || !channelId) {
    throw new Error('guildId and channelId are required');
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);

  const sessionId = generateSessionId();
  const session = {
    id: sessionId,
    guildId,
    channelId,
    startTimeText: typeof startTimeText === 'string' ? startTimeText.trim() : '',
    startAtUnix: Number.isFinite(startAtUnix) ? Math.floor(startAtUnix) : null,
    durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : null,
    announcedAt: nowIso,
    announcedBy: announcedBy || null,
    announcementChannelId: announcementChannelId || null,
    announcementMessageId: announcementMessageId || null,
    participants: {},
  };

  bucket.active = session;
  saveStore(store);
  return session;
}

function recordJoin(guildId, userId, nowMs) {
  if (!guildId || !userId) return null;

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const session = bucket.active;

  if (!session || typeof session !== 'object') return null;
  if (!session.participants || typeof session.participants !== 'object') session.participants = {};

  const nowIso = new Date(nowMs).toISOString();
  const existing = session.participants[userId];

  if (existing && existing.currentJoinAt) {
    saveStore(store);
    return session;
  }

  const next = {
    userId,
    firstJoinedAt: existing?.firstJoinedAt || nowIso,
    lastJoinedAt: nowIso,
    currentJoinAt: nowIso,
    totalSeconds: typeof existing?.totalSeconds === 'number' ? existing.totalSeconds : 0,
  };

  session.participants[userId] = next;
  bucket.active = session;
  saveStore(store);
  return session;
}

function recordLeave(guildId, userId, nowMs) {
  if (!guildId || !userId) return null;

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const session = bucket.active;

  if (!session || typeof session !== 'object') return null;
  if (!session.participants || typeof session.participants !== 'object') session.participants = {};

  const entry = session.participants[userId];
  if (!entry || !entry.currentJoinAt) {
    saveStore(store);
    return session;
  }

  const joinedAtMs = Date.parse(entry.currentJoinAt);
  const deltaSeconds = Number.isFinite(joinedAtMs) ? Math.max(0, Math.floor((nowMs - joinedAtMs) / 1000)) : 0;

  entry.totalSeconds = (typeof entry.totalSeconds === 'number' ? entry.totalSeconds : 0) + deltaSeconds;
  entry.currentJoinAt = null;
  session.participants[userId] = entry;

  bucket.active = session;
  saveStore(store);
  return session;
}

function finalizeSessionDurations(session, nowMs) {
  if (!session || typeof session !== 'object') return;
  if (!session.participants || typeof session.participants !== 'object') session.participants = {};

  for (const entry of Object.values(session.participants)) {
    if (!entry || !entry.currentJoinAt) continue;

    const joinedAtMs = Date.parse(entry.currentJoinAt);
    const deltaSeconds = Number.isFinite(joinedAtMs) ? Math.max(0, Math.floor((nowMs - joinedAtMs) / 1000)) : 0;

    entry.totalSeconds = (typeof entry.totalSeconds === 'number' ? entry.totalSeconds : 0) + deltaSeconds;
    entry.currentJoinAt = null;
  }
}

function endSession(guildId, nowMs) {
  if (!guildId) return null;

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const active = bucket.active;

  if (!active || typeof active !== 'object') {
    return null;
  }

  finalizeSessionDurations(active, nowMs);

  const ended = {
    ...active,
    endedAt: new Date(nowMs).toISOString(),
  };

  bucket.history = Array.isArray(bucket.history) ? bucket.history : [];
  bucket.history.unshift(ended);
  bucket.history = bucket.history.slice(0, 20);

  bucket.active = null;
  saveStore(store);
  return ended;
}

function syncAttendance(guildId, presentUserIds, nowMs) {
  if (!guildId) return null;

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const session = bucket.active;

  if (!session || typeof session !== 'object') {
    return null;
  }

  if (!session.participants || typeof session.participants !== 'object') {
    session.participants = {};
  }

  const nowIso = new Date(nowMs).toISOString();
  const presentSet = new Set(Array.isArray(presentUserIds) ? presentUserIds.filter(Boolean) : []);

  // Mark everyone currently present as "joined".
  for (const userId of presentSet) {
    const existing = session.participants[userId];
    if (!existing) {
      session.participants[userId] = {
        userId,
        firstJoinedAt: nowIso,
        lastJoinedAt: nowIso,
        currentJoinAt: nowIso,
        totalSeconds: 0,
      };
      continue;
    }

    existing.lastJoinedAt = nowIso;
    if (!existing.currentJoinAt) {
      existing.currentJoinAt = nowIso;
    }
    session.participants[userId] = existing;
  }

  // Mark anyone who was "currently joined" but isn't present now as "left".
  for (const [userId, entry] of Object.entries(session.participants)) {
    if (!entry || !entry.currentJoinAt) continue;
    if (presentSet.has(userId)) continue;

    const joinedAtMs = Date.parse(entry.currentJoinAt);
    const deltaSeconds = Number.isFinite(joinedAtMs) ? Math.max(0, Math.floor((nowMs - joinedAtMs) / 1000)) : 0;
    entry.totalSeconds = (typeof entry.totalSeconds === 'number' ? entry.totalSeconds : 0) + deltaSeconds;
    entry.currentJoinAt = null;
    session.participants[userId] = entry;
  }

  bucket.active = session;
  saveStore(store);
  return session;
}

module.exports = {
  getActiveSession,
  listActiveSessions,
  startSession,
  recordJoin,
  recordLeave,
  endSession,
  syncAttendance,
};
