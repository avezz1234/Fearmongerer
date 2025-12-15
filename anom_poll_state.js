const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
const POLLS_FILE = path.join(DATA_DIR, 'polls.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(POLLS_FILE)) return {};

  try {
    const raw = fs.readFileSync(POLLS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[anom-poll] Failed to read polls.json:', error);
    return {};
  }
}

function saveStore(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(POLLS_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[anom-poll] Failed to write polls.json:', error);
  }
}

function getGuildBucket(store, guildId) {
  if (!store[guildId] || typeof store[guildId] !== 'object') {
    store[guildId] = { pollsByMessageId: {}, anonPollsById: {} };
    return store[guildId];
  }

  const bucket = store[guildId];
  if (!bucket.pollsByMessageId || typeof bucket.pollsByMessageId !== 'object') {
    bucket.pollsByMessageId = {};
  }
  if (!bucket.anonPollsById || typeof bucket.anonPollsById !== 'object') {
    bucket.anonPollsById = {};
  }
  return bucket;
}

function createAnonPoll({
  pollId,
  guildId,
  channelId,
  messageId,
  ownerId,
  title,
  question,
  options,
  closesAtMs,
  kind,
}) {
  if (!pollId || !guildId || !channelId || !messageId) {
    throw new Error('pollId, guildId, channelId, and messageId are required');
  }

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const nowIso = new Date().toISOString();

  const poll = {
    id: pollId,
    guildId,
    channelId,
    messageId,
    ownerId: ownerId || null,
    kind: kind === 'public' ? 'public' : 'anon',
    title: typeof title === 'string' && title.trim().length ? title.trim().slice(0, 256) : null,
    question: typeof question === 'string' ? question.trim() : '',
    options: Array.isArray(options) ? options.slice(0, 10) : [],
    votes: {},
    createdAt: nowIso,
    closesAtMs: Number.isFinite(closesAtMs) ? Math.floor(closesAtMs) : null,
    closed: false,
    closedAt: null,
    closedBy: null,
  };

  bucket.anonPollsById[pollId] = poll;
  saveStore(store);
  return poll;
}

function getAnonPoll(guildId, pollId) {
  if (!guildId || !pollId) return null;
  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const poll = bucket.anonPollsById[pollId];
  return poll && typeof poll === 'object' ? poll : null;
}

function recordAnonVote(guildId, pollId, userId, choiceIndex) {
  if (!guildId || !pollId || !userId) return null;

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const poll = bucket.anonPollsById[pollId];
  if (!poll || typeof poll !== 'object') return null;
  if (poll.closed) return poll;

  const idx = Number.isFinite(choiceIndex) ? Math.floor(choiceIndex) : NaN;
  if (!Number.isFinite(idx) || idx < 0 || idx >= (poll.options?.length || 0)) {
    return null;
  }

  poll.votes = poll.votes && typeof poll.votes === 'object' ? poll.votes : {};
  poll.votes[userId] = idx;

  bucket.anonPollsById[pollId] = poll;
  saveStore(store);
  return poll;
}

function closeAnonPoll(guildId, pollId, { nowMs, closedBy } = {}) {
  if (!guildId || !pollId) return null;

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const poll = bucket.anonPollsById[pollId];
  if (!poll || typeof poll !== 'object') return null;
  if (poll.closed) return poll;

  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  poll.closed = true;
  poll.closedAt = new Date(ts).toISOString();
  poll.closedBy = closedBy || 'system';

  bucket.anonPollsById[pollId] = poll;
  saveStore(store);
  return poll;
}

function listExpiredAnonPolls(nowMs) {
  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  const store = loadStore();
  const expired = [];

  for (const [guildId, bucketRaw] of Object.entries(store)) {
    const bucket = bucketRaw && typeof bucketRaw === 'object' ? bucketRaw : null;
    const pollsById = bucket && bucket.anonPollsById && typeof bucket.anonPollsById === 'object'
      ? bucket.anonPollsById
      : null;
    if (!pollsById) continue;

    for (const [pollId, pollRaw] of Object.entries(pollsById)) {
      const poll = pollRaw && typeof pollRaw === 'object' ? pollRaw : null;
      if (!poll || poll.closed) continue;
      const closesAtMs = poll.closesAtMs;
      if (typeof closesAtMs === 'number' && closesAtMs <= ts) {
        expired.push({ guildId, pollId });
      }
    }
  }

  return expired;
}

function listAnonPolls(guildId) {
  if (!guildId) return [];
  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const pollsById = bucket.anonPollsById && typeof bucket.anonPollsById === 'object'
    ? bucket.anonPollsById
    : {};
  return Object.values(pollsById).filter(p => p && typeof p === 'object');
}

function findMostRecentOpenAnonPollByOwner(guildId, ownerId) {
  if (!guildId || !ownerId) return null;
  const polls = listAnonPolls(guildId).filter(poll => poll && !poll.closed && poll.ownerId === ownerId);
  if (!polls.length) return null;

  polls.sort((a, b) => {
    const at = a.createdAt ? Date.parse(a.createdAt) : -Infinity;
    const bt = b.createdAt ? Date.parse(b.createdAt) : -Infinity;
    return bt - at;
  });

  return polls[0] || null;
}

function ensureVotesObject(poll) {
  if (!poll || typeof poll !== 'object') return;
  if (!poll.votes || typeof poll.votes !== 'object') {
    poll.votes = {};
  }
}

function addAnonPollSyntheticVotes(guildId, pollId, choiceIndex, count, { prefix } = {}) {
  if (!guildId || !pollId) return null;

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const poll = bucket.anonPollsById[pollId];
  if (!poll || typeof poll !== 'object') return null;
  if (poll.closed) return poll;

  const options = Array.isArray(poll.options) ? poll.options : [];
  const idx = Number.isFinite(choiceIndex) ? Math.floor(choiceIndex) : NaN;
  if (!Number.isFinite(idx) || idx < 0 || idx >= options.length) return null;

  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (!n) return poll;

  ensureVotesObject(poll);
  const tag = typeof prefix === 'string' && prefix.trim().length ? prefix.trim() : 'pweewoo';
  const now = Date.now();

  for (let i = 0; i < n; i += 1) {
    const key = `${tag}:${pollId}:${now}:${Math.random().toString(16).slice(2)}:${i}`;
    poll.votes[key] = idx;
  }

  bucket.anonPollsById[pollId] = poll;
  saveStore(store);
  return poll;
}

function removeAnonPollVotesFromChoice(guildId, pollId, choiceIndex, count, { preferPrefix } = {}) {
  if (!guildId || !pollId) return { poll: null, removed: 0 };

  const store = loadStore();
  const bucket = getGuildBucket(store, guildId);
  const poll = bucket.anonPollsById[pollId];
  if (!poll || typeof poll !== 'object') return { poll: null, removed: 0 };
  if (poll.closed) return { poll, removed: 0 };

  const options = Array.isArray(poll.options) ? poll.options : [];
  const idx = Number.isFinite(choiceIndex) ? Math.floor(choiceIndex) : NaN;
  if (!Number.isFinite(idx) || idx < 0 || idx >= options.length) return { poll: null, removed: 0 };

  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (!n) return { poll, removed: 0 };

  ensureVotesObject(poll);
  const prefer = typeof preferPrefix === 'string' && preferPrefix.trim().length ? preferPrefix.trim() : '';

  const matchingKeys = Object.entries(poll.votes)
    .filter(([, v]) => v === idx)
    .map(([k]) => k);

  matchingKeys.sort((a, b) => {
    const ap = prefer && a.startsWith(prefer) ? 0 : 1;
    const bp = prefer && b.startsWith(prefer) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.localeCompare(b);
  });

  let removed = 0;
  for (const key of matchingKeys) {
    if (removed >= n) break;
    delete poll.votes[key];
    removed += 1;
  }

  bucket.anonPollsById[pollId] = poll;
  saveStore(store);
  return { poll, removed };
}

module.exports = {
  createAnonPoll,
  getAnonPoll,
  recordAnonVote,
  closeAnonPoll,
  listExpiredAnonPolls,
  listAnonPolls,
  findMostRecentOpenAnonPollByOwner,
  addAnonPollSyntheticVotes,
  removeAnonPollVotesFromChoice,
};
