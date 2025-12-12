const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const AFK_FILE = path.join(DATA_DIR, 'afk.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadAfkStore() {
  ensureDataDir();
  if (!fs.existsSync(AFK_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(AFK_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[afk] Failed to read afk.json:', error);
    return {};
  }
}

function saveAfkStore(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(AFK_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[afk] Failed to write afk.json:', error);
  }
}

function setAfk(guildId, userId, data) {
  if (!guildId || !userId) {
    return;
  }

  const store = loadAfkStore();
  if (!store[guildId]) {
    store[guildId] = {};
  }

  store[guildId][userId] = {
    reason: typeof (data && data.reason) === 'string' ? data.reason : '',
    setAt: typeof (data && data.setAt) === 'number' ? data.setAt : Date.now(),
  };

  saveAfkStore(store);
}

function clearAfk(guildId, userId) {
  if (!guildId || !userId) {
    return;
  }

  const store = loadAfkStore();
  if (!store[guildId] || !store[guildId][userId]) {
    return;
  }

  delete store[guildId][userId];

  if (Object.keys(store[guildId]).length === 0) {
    delete store[guildId];
  }

  saveAfkStore(store);
}

function getAfk(guildId, userId) {
  if (!guildId || !userId) {
    return null;
  }

  const store = loadAfkStore();
  const guildStore = store[guildId];
  if (!guildStore) {
    return null;
  }

  const entry = guildStore[userId];
  return entry || null;
}

module.exports = {
  setAfk,
  clearAfk,
  getAfk,
};
