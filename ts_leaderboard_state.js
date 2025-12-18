const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'ts_leaderboards.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(FILE)) return {};

  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[ts-leaderboard] Failed to read ts_leaderboards.json:', error);
    return {};
  }
}

function saveStore(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[ts-leaderboard] Failed to write ts_leaderboards.json:', error);
  }
}

function getGuildBucket(store, guildId) {
  const bucket = store[guildId];
  if (bucket && typeof bucket === 'object') {
    if (!Array.isArray(bucket.messages)) bucket.messages = [];
    return bucket;
  }

  const created = { messages: [] };
  store[guildId] = created;
  return created;
}

function listLeaderboards() {
  const store = loadStore();
  const out = [];

  for (const [guildId, bucketRaw] of Object.entries(store)) {
    const bucket = bucketRaw && typeof bucketRaw === 'object' ? bucketRaw : null;
    const messages = bucket && Array.isArray(bucket.messages) ? bucket.messages : [];

    for (const m of messages) {
      if (!m || typeof m !== 'object') continue;
      if (!m.channelId || !m.messageId) continue;
      out.push({ guildId, channelId: m.channelId, messageId: m.messageId });
    }
  }

  return out;
}

function addLeaderboard(guildId, channelId, messageId, createdBy) {
  if (!guildId || !channelId || !messageId) return null;

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);

  const nowIso = new Date().toISOString();
  const entry = {
    channelId,
    messageId,
    createdAt: nowIso,
    createdBy: createdBy || null,
  };

  // Dedupe if already tracked.
  bucket.messages = (Array.isArray(bucket.messages) ? bucket.messages : []).filter(m => m?.messageId !== messageId);
  bucket.messages.unshift(entry);

  // Cap tracked messages per guild to avoid unlimited sweeps.
  bucket.messages = bucket.messages.slice(0, 5);

  store[guildId] = bucket;
  saveStore(store);
  return entry;
}

function removeLeaderboard(guildId, messageId) {
  if (!guildId || !messageId) return false;

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const before = Array.isArray(bucket.messages) ? bucket.messages.length : 0;

  bucket.messages = (Array.isArray(bucket.messages) ? bucket.messages : []).filter(m => m?.messageId !== messageId);
  store[guildId] = bucket;
  saveStore(store);

  return bucket.messages.length !== before;
}

module.exports = {
  addLeaderboard,
  removeLeaderboard,
  listLeaderboards,
};
