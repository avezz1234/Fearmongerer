const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const USER_DATA_FILE = path.join(DATA_DIR, 'user_data.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(USER_DATA_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(USER_DATA_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[user-data] Failed to read user_data.json:', error);
    return {};
  }
}

function saveStore(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(USER_DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[user-data] Failed to write user_data.json:', error);
  }
}

function setUserDataValue(guildId, userId, key, value, setBy) {
  if (!guildId || !userId || !key) {
    return;
  }

  const trimmedKey = typeof key === 'string' ? key.trim() : '';
  if (!trimmedKey.length) {
    return;
  }

  const store = loadStore();

  if (!store[guildId]) {
    store[guildId] = {};
  }

  if (!store[guildId][userId]) {
    store[guildId][userId] = {};
  }

  const nowIso = new Date().toISOString();

  store[guildId][userId][trimmedKey] = {
    value: typeof value === 'string' ? value : String(value),
    setBy: typeof setBy === 'string' ? setBy : null,
    setAt: nowIso,
  };

  saveStore(store);
}

function getUserDataValue(guildId, userId, key) {
  if (!guildId || !userId || !key) {
    return null;
  }

  const store = loadStore();
  const guildStore = store[guildId];
  if (!guildStore) {
    return null;
  }

  const userStore = guildStore[userId];
  if (!userStore) {
    return null;
  }

  return userStore[key] ?? null;
}

function getAllUserDataForUser(guildId, userId) {
  if (!guildId || !userId) {
    return {};
  }

  const store = loadStore();
  const guildStore = store[guildId];
  if (!guildStore) {
    return {};
  }

  const userStore = guildStore[userId];
  if (!userStore || typeof userStore !== 'object') {
    return {};
  }

  return userStore;
}

function deleteUserDataValue(guildId, userId, key) {
  if (!guildId || !userId || !key) {
    return false;
  }

  const store = loadStore();
  const guildStore = store[guildId];
  if (!guildStore) {
    return false;
  }

  const userStore = guildStore[userId];
  if (!userStore || !Object.prototype.hasOwnProperty.call(userStore, key)) {
    return false;
  }

  delete userStore[key];

  if (Object.keys(userStore).length === 0) {
    delete guildStore[userId];
  }

  if (Object.keys(guildStore).length === 0) {
    delete store[guildId];
  }

  saveStore(store);
  return true;
}

module.exports = {
  setUserDataValue,
  getUserDataValue,
  getAllUserDataForUser,
  deleteUserDataValue,
};
