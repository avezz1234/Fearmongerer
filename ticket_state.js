const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadTicketsFromDisk() {
  ensureDataDir();
  if (!fs.existsSync(TICKETS_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(TICKETS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[tickets] Failed to read tickets.json:', error);
    return {};
  }
}

function saveTicketsToDisk(map) {
  ensureDataDir();
  try {
    const obj = {};
    for (const [id, ticket] of map.entries()) {
      obj[id] = ticket;
    }

    fs.writeFileSync(TICKETS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (error) {
    console.error('[tickets] Failed to write tickets.json:', error);
  }
}

const ticketState = new Map();

// Bootstrap from disk on startup so existing tickets survive restarts.
(function bootstrapFromDisk() {
  const stored = loadTicketsFromDisk();
  if (!stored || typeof stored !== 'object') {
    return;
  }

  for (const [id, ticket] of Object.entries(stored)) {
    ticketState.set(id, ticket);
  }
})();

// Wrap mutating methods so any change is flushed to disk.
const originalSet = ticketState.set.bind(ticketState);
const originalDelete = ticketState.delete.bind(ticketState);
const originalClear = ticketState.clear.bind(ticketState);

ticketState.set = (key, value) => {
  const result = originalSet(key, value);
  saveTicketsToDisk(ticketState);
  return result;
};

ticketState.delete = key => {
  const result = originalDelete(key);
  saveTicketsToDisk(ticketState);
  return result;
};

ticketState.clear = () => {
  originalClear();
  saveTicketsToDisk(ticketState);
};

module.exports = { ticketState };
