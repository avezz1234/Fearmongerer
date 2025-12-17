const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const SELFROLES_FILE = path.join(DATA_DIR, 'selfroles.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(SELFROLES_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(SELFROLES_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[selfroles] Failed to read selfroles.json:', error);
    return {};
  }
}

function saveStore(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(SELFROLES_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[selfroles] Failed to write selfroles.json:', error);
  }
}

function createSelfRolePanel(panel) {
  if (!panel || typeof panel !== 'object') return;

  const id = typeof panel.id === 'string' ? panel.id.trim() : '';
  const guildId = typeof panel.guildId === 'string' ? panel.guildId.trim() : '';
  const channelId = typeof panel.channelId === 'string' ? panel.channelId.trim() : '';
  const messageId = typeof panel.messageId === 'string' ? panel.messageId.trim() : '';

  const rawRoleIds = Array.isArray(panel.roleIds) ? panel.roleIds : [];
  const roleIds = rawRoleIds
    .map(r => (typeof r === 'string' ? r.trim() : ''))
    .filter(Boolean)
    .slice(0, 25);

  if (!id || !guildId || !channelId || !messageId || !roleIds.length) return;

  const store = loadStore();
  store[id] = {
    id,
    guildId,
    channelId,
    messageId,
    roleIds,
    createdBy: typeof panel.createdBy === 'string' ? panel.createdBy : null,
    createdAt: typeof panel.createdAt === 'string' ? panel.createdAt : new Date().toISOString(),
  };
  saveStore(store);
}

function getSelfRolePanel(panelId) {
  const id = typeof panelId === 'string' ? panelId.trim() : '';
  if (!id) return null;

  const store = loadStore();
  const panel = store[id];
  return panel && typeof panel === 'object' ? panel : null;
}

function deleteSelfRolePanel(panelId) {
  const id = typeof panelId === 'string' ? panelId.trim() : '';
  if (!id) return;

  const store = loadStore();
  if (!store[id]) return;

  delete store[id];
  saveStore(store);
}

module.exports = {
  createSelfRolePanel,
  getSelfRolePanel,
  deleteSelfRolePanel,
};
