const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const PERMS_FILE = path.join(DATA_DIR, 'command_perms.json');

let cachedStore = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore() {
  if (cachedStore) {
    return cachedStore;
  }

  ensureDataDir();
  if (!fs.existsSync(PERMS_FILE)) {
    cachedStore = {};
    return cachedStore;
  }

  try {
    const raw = fs.readFileSync(PERMS_FILE, 'utf8');
    cachedStore = raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[cmd-perms] Failed to read command_perms.json:', error);
    cachedStore = {};
  }

  return cachedStore;
}

function saveStore(store) {
  ensureDataDir();
  cachedStore = store;

  try {
    fs.writeFileSync(PERMS_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[cmd-perms] Failed to write command_perms.json:', error);
  }
}

function normalizeCommandName(name) {
  const raw = typeof name === 'string' ? name.trim().toLowerCase() : '';
  if (!raw) {
    return null;
  }

  const stripped = raw.startsWith('/') ? raw.slice(1) : raw;
  if (!stripped) {
    return null;
  }

  return stripped;
}

function ensureGuildBucket(store, guildId) {
  if (!store[guildId] || typeof store[guildId] !== 'object') {
    store[guildId] = {};
  }
  const bucket = store[guildId];

  if (!bucket.users || typeof bucket.users !== 'object') {
    bucket.users = {};
  }
  if (!bucket.roles || typeof bucket.roles !== 'object') {
    bucket.roles = {};
  }

  return bucket;
}

function mergeCommandSets(existing, toAdd) {
  const current = Array.isArray(existing) ? existing : [];
  const set = new Set(current);

  for (const cmd of toAdd) {
    if (cmd) {
      set.add(cmd);
    }
  }

  return Array.from(set);
}

function grantCommandsToUser(guildId, userId, commands) {
  if (!guildId || !userId) {
    return [];
  }

  const normalized = (Array.isArray(commands) ? commands : [])
    .map(normalizeCommandName)
    .filter(Boolean);

  if (!normalized.length) {
    return getAllowedCommandsForUser(guildId, userId);
  }

  const store = loadStore();
  const bucket = ensureGuildBucket(store, guildId);

  const existing = bucket.users[userId];
  const merged = mergeCommandSets(existing, normalized);
  bucket.users[userId] = merged;

  saveStore(store);
  return merged;
}

function grantCommandsToRole(guildId, roleId, commands) {
  if (!guildId || !roleId) {
    return [];
  }

  const normalized = (Array.isArray(commands) ? commands : [])
    .map(normalizeCommandName)
    .filter(Boolean);

  if (!normalized.length) {
    return getAllowedCommandsForRole(guildId, roleId);
  }

  const store = loadStore();
  const bucket = ensureGuildBucket(store, guildId);

  const existing = bucket.roles[roleId];
  const merged = mergeCommandSets(existing, normalized);
  bucket.roles[roleId] = merged;

  saveStore(store);
  return merged;
}

function getAllowedCommandsForUser(guildId, userId) {
  const store = loadStore();
  const bucket = store[guildId];
  if (!bucket || typeof bucket !== 'object') {
    return [];
  }
  const list = bucket.users && typeof bucket.users === 'object' ? bucket.users[userId] : null;
  return Array.isArray(list) ? list : [];
}

function getAllowedCommandsForRole(guildId, roleId) {
  const store = loadStore();
  const bucket = store[guildId];
  if (!bucket || typeof bucket !== 'object') {
    return [];
  }
  const list = bucket.roles && typeof bucket.roles === 'object' ? bucket.roles[roleId] : null;
  return Array.isArray(list) ? list : [];
}

function isCommandAllowed({ guildId, userId, roleIds, commandName }) {
  if (!guildId || !userId) {
    return false;
  }

  const cmd = normalizeCommandName(commandName);
  if (!cmd) {
    return false;
  }

  const bucket = loadStore()[guildId];
  if (!bucket || typeof bucket !== 'object') {
    return false;
  }

  const userCommands = bucket.users && typeof bucket.users === 'object' ? bucket.users[userId] : null;
  if (Array.isArray(userCommands) && userCommands.includes(cmd)) {
    return true;
  }

  const roles = Array.isArray(roleIds) ? roleIds : [];
  if (!roles.length) {
    return false;
  }

  const roleMap = bucket.roles && typeof bucket.roles === 'object' ? bucket.roles : null;
  if (!roleMap) {
    return false;
  }

  for (const roleId of roles) {
    const roleCommands = roleMap[roleId];
    if (Array.isArray(roleCommands) && roleCommands.includes(cmd)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  normalizeCommandName,
  grantCommandsToUser,
  grantCommandsToRole,
  getAllowedCommandsForUser,
  getAllowedCommandsForRole,
  isCommandAllowed,
};
