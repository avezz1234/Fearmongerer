const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const REQUIRESELECT_FILE = path.join(DATA_DIR, 'requireselect.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(REQUIRESELECT_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(REQUIRESELECT_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[requireselect] Failed to read requireselect.json:', error);
    return {};
  }
}

function saveStore(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(REQUIRESELECT_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[requireselect] Failed to write requireselect.json:', error);
  }
}

function normalizeRequiredType(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return null;

  if (raw === 'embed') return 'embed';
  if (raw === 'image') return 'image';
  if (raw === 'video') return 'video';
  if (raw === 'attachment') return 'attachment';
  if (raw === 'sticker') return 'sticker';

  return null;
}

function setRequireSelectRule(guildId, channelId, requiredType, setBy) {
  if (!guildId || !channelId) {
    return;
  }

  const normalized = normalizeRequiredType(requiredType);
  if (!normalized) {
    return;
  }

  const store = loadStore();
  if (!store[guildId] || typeof store[guildId] !== 'object') {
    store[guildId] = {};
  }

  store[guildId][channelId] = {
    requiredType: normalized,
    setBy: typeof setBy === 'string' ? setBy : null,
    setAt: new Date().toISOString(),
  };

  saveStore(store);
}

function clearRequireSelectRule(guildId, channelId) {
  if (!guildId || !channelId) {
    return;
  }

  const store = loadStore();
  if (!store[guildId] || typeof store[guildId] !== 'object') {
    return;
  }

  if (!store[guildId][channelId]) {
    return;
  }

  delete store[guildId][channelId];

  if (Object.keys(store[guildId]).length === 0) {
    delete store[guildId];
  }

  saveStore(store);
}

function getRequireSelectRule(guildId, channelId) {
  if (!guildId || !channelId) {
    return null;
  }

  const store = loadStore();
  const guildStore = store[guildId];
  if (!guildStore || typeof guildStore !== 'object') {
    return null;
  }

  return guildStore[channelId] || null;
}

module.exports = {
  setRequireSelectRule,
  clearRequireSelectRule,
  getRequireSelectRule,
};
