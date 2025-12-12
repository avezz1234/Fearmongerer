const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const NOPING_FILE = path.join(DATA_DIR, 'noping.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(NOPING_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(NOPING_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[noping] Failed to read noping.json:', error);
    return {};
  }
}

function saveStore(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(NOPING_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[noping] Failed to write noping.json:', error);
  }
}

function setNoPingRule(guildId, userId, parseFor, response) {
  if (!guildId || !userId) {
    return;
  }

  const cleanParse = (parseFor ?? '').trim();
  const cleanResponse = (response ?? '').trim();

  if (!cleanParse) {
    return;
  }

  const store = loadStore();
  if (!store[guildId]) {
    store[guildId] = {};
  }

  store[guildId][userId] = {
    parseFor: cleanParse,
    response: cleanResponse,
    setAt: new Date().toISOString(),
  };

  saveStore(store);
}

function clearNoPingRule(guildId, userId) {
  if (!guildId || !userId) {
    return;
  }

  const store = loadStore();
  if (!store[guildId] || !store[guildId][userId]) {
    return;
  }

  delete store[guildId][userId];

  if (Object.keys(store[guildId]).length === 0) {
    delete store[guildId];
  }

  saveStore(store);
}

function getNoPingRule(guildId, userId) {
  if (!guildId || !userId) {
    return null;
  }

  const store = loadStore();
  const guildStore = store[guildId];
  if (!guildStore) {
    return null;
  }

  return guildStore[userId] || null;
}

module.exports = {
  setNoPingRule,
  clearNoPingRule,
  getNoPingRule,
};
