const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const ACCEPTED_TICKETS_FILE = path.join(DATA_DIR, 'accepted_tickets.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadAcceptedTickets() {
  ensureDataDir();
  if (!fs.existsSync(ACCEPTED_TICKETS_FILE)) return {};

  try {
    const raw = fs.readFileSync(ACCEPTED_TICKETS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error(
      '[tickets] Failed to read accepted_tickets.json, starting fresh:',
      error,
    );
    return {};
  }
}

function saveAcceptedTickets(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(
      ACCEPTED_TICKETS_FILE,
      JSON.stringify(store, null, 2),
      'utf8',
    );
  } catch (error) {
    console.error('[tickets] Failed to write accepted_tickets.json:', error);
  }
}

function incrementAcceptedTickets({ guildId, userId }) {
  if (!guildId || !userId) return 0;

  const store = loadAcceptedTickets();

  if (!store[guildId]) {
    store[guildId] = {};
  }

  const currentRaw = store[guildId][userId];
  const current = Number.isFinite(currentRaw)
    ? currentRaw
    : Number(currentRaw) || 0;

  const next = current + 1;
  store[guildId][userId] = next;

  saveAcceptedTickets(store);

  return next;
}

function getAcceptedTicketsCount({ guildId, userId }) {
  if (!guildId || !userId) return 0;

  const store = loadAcceptedTickets();
  const value = store[guildId]?.[userId];

  if (!Number.isFinite(value)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  return value;
}

module.exports = {
  incrementAcceptedTickets,
  getAcceptedTicketsCount,
};
