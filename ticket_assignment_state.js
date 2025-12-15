const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const ASSIGN_FILE = path.join(DATA_DIR, 'ticket_assignment.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(ASSIGN_FILE)) return {};

  try {
    const raw = fs.readFileSync(ASSIGN_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[ticket-assign] Failed to read ticket_assignment.json:', error);
    return {};
  }
}

function saveStore(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(ASSIGN_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[ticket-assign] Failed to write ticket_assignment.json:', error);
  }
}

function normalizeBucket(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const nextIndex = Number.isFinite(b.nextIndex) ? Math.max(0, Math.floor(b.nextIndex)) : 0;
  return { nextIndex };
}

function pickNextAssignee({ guildId, candidates }) {
  if (!guildId) return null;

  const list = Array.isArray(candidates) ? candidates.filter(Boolean).map(String) : [];
  const unique = Array.from(new Set(list));
  unique.sort((a, b) => a.localeCompare(b));

  if (unique.length === 0) {
    return null;
  }

  const store = loadStore();
  const bucket = normalizeBucket(store[guildId]);

  const idx = bucket.nextIndex % unique.length;
  const picked = unique[idx] || null;

  bucket.nextIndex = bucket.nextIndex + 1;
  store[guildId] = bucket;
  saveStore(store);

  return picked;
}

module.exports = {
  pickNextAssignee,
};
