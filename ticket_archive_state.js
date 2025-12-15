const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const TICKET_ARCHIVE_FILE = path.join(DATA_DIR, 'ticket_archive.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadTicketArchiveFromDisk() {
  ensureDataDir();
  if (!fs.existsSync(TICKET_ARCHIVE_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(TICKET_ARCHIVE_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[tickets] Failed to read ticket_archive.json:', error);
    return {};
  }
}

function saveTicketArchiveToDisk(map) {
  ensureDataDir();
  try {
    const obj = {};
    for (const [id, ticket] of map.entries()) {
      obj[id] = ticket;
    }

    fs.writeFileSync(TICKET_ARCHIVE_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (error) {
    console.error('[tickets] Failed to write ticket_archive.json:', error);
  }
}

const ticketArchive = new Map();

// Bootstrap from disk on startup so old/closed tickets survive restarts.
(function bootstrapFromDisk() {
  const stored = loadTicketArchiveFromDisk();
  if (!stored || typeof stored !== 'object') {
    return;
  }

  for (const [id, ticket] of Object.entries(stored)) {
    ticketArchive.set(id, ticket);
  }
})();

// Wrap set so any archive update is flushed to disk.
const originalSet = ticketArchive.set.bind(ticketArchive);

ticketArchive.set = (key, value) => {
  const result = originalSet(key, value);
  saveTicketArchiveToDisk(ticketArchive);
  return result;
};

function archiveTicket(ticketId, ticket, meta = {}) {
  const id = typeof ticketId === 'string' ? ticketId.trim().toUpperCase() : '';
  if (!id) return null;
  if (!ticket || typeof ticket !== 'object') return null;

  const archivedAt =
    typeof meta.archivedAt === 'string' && meta.archivedAt.trim().length
      ? meta.archivedAt.trim()
      : new Date().toISOString();

  const entry = {
    ...ticket,
    _archivedAt: archivedAt,
  };

  if (typeof meta.archivedBy === 'string' && meta.archivedBy.trim().length) {
    entry._archivedBy = meta.archivedBy.trim();
  }

  if (typeof meta.archivedReason === 'string' && meta.archivedReason.trim().length) {
    entry._archivedReason = meta.archivedReason.trim();
  }

  ticketArchive.set(id, entry);
  return entry;
}

function getArchivedTicket(ticketId) {
  const id = typeof ticketId === 'string' ? ticketId.trim().toUpperCase() : '';
  if (!id) return null;
  return ticketArchive.get(id) ?? null;
}

module.exports = {
  archiveTicket,
  getArchivedTicket,
  ticketArchive,
};
