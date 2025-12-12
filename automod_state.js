const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const AUTOMOD_FILE = path.join(DATA_DIR, 'automod.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(AUTOMOD_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(AUTOMOD_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[automod] Failed to read automod.json:', error);
    return {};
  }
}

function saveStore(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(AUTOMOD_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[automod] Failed to write automod.json:', error);
  }
}

function addAutomodWords(guildId, words, setBy) {
  if (!guildId) {
    return;
  }

  const source = Array.isArray(words) ? words : [words];
  const cleaned = source
    .map(word => (typeof word === 'string' ? word.trim() : ''))
    .filter(Boolean);

  if (cleaned.length === 0) {
    return;
  }

  const store = loadStore();
  if (!store[guildId]) {
    store[guildId] = { words: [] };
  }

  const guildStore = store[guildId];
  if (!Array.isArray(guildStore.words)) {
    guildStore.words = [];
  }

  const existing = new Set(
    guildStore.words
      .filter(entry => entry && typeof entry.phrase === 'string')
      .map(entry => entry.phrase.toLowerCase()),
  );

  const nowIso = new Date().toISOString();

  for (const phrase of cleaned) {
    const lower = phrase.toLowerCase();
    if (existing.has(lower)) {
      continue;
    }

    guildStore.words.push({
      phrase,
      setBy: typeof setBy === 'string' ? setBy : null,
      setAt: nowIso,
    });

    existing.add(lower);
  }

  saveStore(store);
}

function getAutomodRules(guildId) {
  if (!guildId) {
    return [];
  }

  const store = loadStore();
  const guildStore = store[guildId];

  if (!guildStore || !Array.isArray(guildStore.words)) {
    return [];
  }

  return guildStore.words;
}

function clearAutomodRules(guildId) {
  if (!guildId) {
    return;
  }

  const store = loadStore();
  if (!store[guildId]) {
    return;
  }

  delete store[guildId];

  saveStore(store);
}

function addReverseAutomodWords(guildId, words, setBy) {
  if (!guildId) {
    return;
  }

  const source = Array.isArray(words) ? words : [words];
  const cleaned = source
    .map(word => (typeof word === 'string' ? word.trim() : ''))
    .filter(Boolean);

  if (cleaned.length === 0) {
    return;
  }

  const store = loadStore();
  if (!store[guildId]) {
    store[guildId] = { words: [], reverseWords: [] };
  }

  const guildStore = store[guildId];

  if (!Array.isArray(guildStore.words)) {
    guildStore.words = [];
  }

  if (!Array.isArray(guildStore.reverseWords)) {
    guildStore.reverseWords = [];
  }

  const existing = new Set(
    guildStore.reverseWords
      .filter(entry => entry && typeof entry.phrase === 'string')
      .map(entry => entry.phrase.toLowerCase()),
  );

  const nowIso = new Date().toISOString();

  for (const phrase of cleaned) {
    const lower = phrase.toLowerCase();
    if (existing.has(lower)) {
      continue;
    }

    guildStore.reverseWords.push({
      phrase,
      setBy: typeof setBy === 'string' ? setBy : null,
      setAt: nowIso,
    });

    existing.add(lower);
  }

  saveStore(store);
}

function getReverseAutomodRules(guildId) {
  if (!guildId) {
    return [];
  }

  const store = loadStore();
  const guildStore = store[guildId];

  if (!guildStore || !Array.isArray(guildStore.reverseWords)) {
    return [];
  }

  return guildStore.reverseWords;
}

function clearReverseAutomodRules(guildId) {
  if (!guildId) {
    return;
  }

  const store = loadStore();
  const guildStore = store[guildId];

  if (!guildStore || !Array.isArray(guildStore.reverseWords)) {
    return;
  }

  guildStore.reverseWords = [];

  saveStore(store);
}

module.exports = {
  addAutomodWords,
  getAutomodRules,
  clearAutomodRules,
  addReverseAutomodWords,
  getReverseAutomodRules,
  clearReverseAutomodRules,
};
