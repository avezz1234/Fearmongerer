const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadServersStore() {
  ensureDataDir();
  if (!fs.existsSync(SERVERS_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(SERVERS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[welcome] Failed to read servers.json:', error);
    return {};
  }
}

function saveServersStore(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[welcome] Failed to write servers.json:', error);
  }
}

function getWelcomeEnabled(guildId) {
  if (!guildId) {
    return false;
  }

  const store = loadServersStore();
  const guildStore = store[guildId];
  if (!guildStore) {
    return false;
  }

  return !!guildStore.welcomeEnabled;
}

function setWelcomeEnabled(guildId, enabled) {
  if (!guildId) {
    return;
  }

  const store = loadServersStore();
  const guildStore = store[guildId] || {};

  guildStore.welcomeEnabled = Boolean(enabled);
  store[guildId] = guildStore;

  saveServersStore(store);
}

function getWelcomeChannelId(guildId) {
  if (!guildId) {
    return null;
  }

  const store = loadServersStore();
  const guildStore = store[guildId];
  if (!guildStore || !guildStore.welcomeChannelId) {
    return null;
  }

  return guildStore.welcomeChannelId;
}

function setWelcomeChannelId(guildId, channelId) {
  if (!guildId || !channelId) {
    return;
  }

  const store = loadServersStore();
  const guildStore = store[guildId] || {};

  guildStore.welcomeChannelId = channelId;
  store[guildId] = guildStore;

  saveServersStore(store);
}

function getWelcomeMessageTemplate(guildId) {
  if (!guildId) {
    return null;
  }

  const store = loadServersStore();
  const guildStore = store[guildId];
  if (!guildStore) {
    return null;
  }

  const raw = guildStore.welcomeMessageTemplate;
  return typeof raw === 'string' && raw.trim().length ? raw : null;
}

function setWelcomeMessageTemplate(guildId, template) {
  if (!guildId) {
    return;
  }

  const store = loadServersStore();
  const guildStore = store[guildId] || {};

  const safe = typeof template === 'string' ? template.trim() : '';

  if (safe) {
    guildStore.welcomeMessageTemplate = safe;
  } else {
    delete guildStore.welcomeMessageTemplate;
  }

  store[guildId] = guildStore;
  saveServersStore(store);
}

module.exports = {
  getWelcomeEnabled,
  setWelcomeEnabled,
  getWelcomeChannelId,
  setWelcomeChannelId,
  getWelcomeMessageTemplate,
  setWelcomeMessageTemplate,
};
