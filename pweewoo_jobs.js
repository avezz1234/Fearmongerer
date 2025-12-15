const jobs = new Map();

function keyFor(guildId, pollId) {
  return `${guildId || 'unknown'}:${pollId || 'unknown'}`;
}

function stopJob(guildId, pollId) {
  const key = keyFor(guildId, pollId);
  const existing = jobs.get(key);
  if (existing && typeof existing.cancel === 'function') {
    try {
      existing.cancel();
    } catch {
      // ignore
    }
  }
  jobs.delete(key);
}

function startOrReplaceJob(guildId, pollId, job) {
  stopJob(guildId, pollId);
  const key = keyFor(guildId, pollId);
  jobs.set(key, job);
}

function getJob(guildId, pollId) {
  const key = keyFor(guildId, pollId);
  return jobs.get(key) || null;
}

module.exports = {
  startOrReplaceJob,
  stopJob,
  getJob,
};
