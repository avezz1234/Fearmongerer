const { EmbedBuilder } = require('discord.js');

const tsState = require('./ts_state');
const tsLeaderboardState = require('./ts_leaderboard_state');

const lastDigestByMessageId = new Map();

function medalForRank(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return null;
}

function buildLeaderboardLines(testers) {
  const sorted = Array.isArray(testers) ? [...testers] : [];
  sorted.sort((a, b) => {
    const at = typeof a?.ts === 'number' ? a.ts : 0;
    const bt = typeof b?.ts === 'number' ? b.ts : 0;
    if (bt !== at) return bt - at;
    return String(a?.userId || '').localeCompare(String(b?.userId || ''));
  });

  const lines = sorted.map((t, idx) => {
    const rank = idx + 1;
    const medal = medalForRank(rank);
    const ts = typeof t?.ts === 'number' ? t.ts : 0;
    const userId = String(t?.userId || '');

    const rankLabel = medal ? medal : `#${rank}`;
    return `${rankLabel} <@${userId}> — **${ts} TS**`;
  });

  return { sorted, lines };
}

function chunkLines(lines, maxChars) {
  const chunks = [];
  let current = [];
  let used = 0;

  for (const line of lines) {
    const nextUsed = used + (current.length ? 1 : 0) + line.length;
    if (nextUsed > maxChars) {
      if (current.length) {
        chunks.push(current);
      }
      current = [line];
      used = line.length;
      continue;
    }

    current.push(line);
    used = nextUsed;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

function buildTsLeaderboardEmbed(guildId, testers, { totalTracked } = {}) {
  const { sorted, lines } = buildLeaderboardLines(testers);

  const embed = new EmbedBuilder()
    .setTitle('TS Leaderboard')
    .setColor(0x005865f2)
    .setDescription('Live TS rankings (highest → lowest). Auto-updates.')
    .setTimestamp(new Date());

  const displayLines = lines.length ? lines : ['(no tracked testers)'];
  const chunks = chunkLines(displayLines, 1024);

  // Keep the embed compact: split into 2–4 fields max when possible.
  const maxFields = 4;
  const useChunks = chunks.length > maxFields ? chunks.slice(0, maxFields) : chunks;

  for (let i = 0; i < useChunks.length; i += 1) {
    const startRank = i === 0 ? 1 : (useChunks.slice(0, i).reduce((acc, c) => acc + c.length, 0) + 1);
    const endRank = startRank + useChunks[i].length - 1;
    embed.addFields({
      name: `Ranks ${startRank}–${endRank}`,
      value: useChunks[i].join('\n'),
      inline: false,
    });
  }

  const hidden = sorted.length - useChunks.reduce((acc, c) => acc + c.length, 0);
  const footerBits = [];
  if (typeof totalTracked === 'number') footerBits.push(`${totalTracked} tracked`);
  else footerBits.push(`${sorted.length} tracked`);
  if (hidden > 0) footerBits.push(`showing top ${sorted.length - hidden}`);
  footerBits.push('refreshes automatically');

  embed.setFooter({ text: footerBits.join(' • ') });
  return embed;
}

function digestForTesters(testers) {
  const rows = Array.isArray(testers) ? testers : [];
  const sorted = [...rows].sort((a, b) => {
    const at = typeof a?.ts === 'number' ? a.ts : 0;
    const bt = typeof b?.ts === 'number' ? b.ts : 0;
    if (bt !== at) return bt - at;
    return String(a?.userId || '').localeCompare(String(b?.userId || ''));
  });

  return sorted.map(r => `${r.userId}:${r.ts}`).join('|');
}

async function sweepTsLeaderboards(client) {
  if (!client) return;

  const tracked = tsLeaderboardState.listLeaderboards();
  if (!tracked.length) return;

  // Group by guild so we only compute the leaderboard digest once per guild per sweep.
  const byGuild = new Map();
  for (const item of tracked) {
    if (!item?.guildId || !item?.channelId || !item?.messageId) continue;
    const list = byGuild.get(item.guildId) || [];
    list.push(item);
    byGuild.set(item.guildId, list);
  }

  for (const [guildId, items] of byGuild.entries()) {
    const testers = tsState.listTesters(guildId);
    const digest = digestForTesters(testers);

    for (const item of items) {
      const messageId = item.messageId;
      const prev = lastDigestByMessageId.get(messageId);
      if (prev === digest) {
        continue;
      }

      try {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
          tsLeaderboardState.removeLeaderboard(guildId, messageId);
          lastDigestByMessageId.delete(messageId);
          continue;
        }

        const channel = await guild.channels.fetch(item.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
          tsLeaderboardState.removeLeaderboard(guildId, messageId);
          lastDigestByMessageId.delete(messageId);
          continue;
        }

        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (!msg) {
          tsLeaderboardState.removeLeaderboard(guildId, messageId);
          lastDigestByMessageId.delete(messageId);
          continue;
        }

        const embed = buildTsLeaderboardEmbed(guildId, testers);
        await msg.edit({ embeds: [embed] }).catch(() => null);

        lastDigestByMessageId.set(messageId, digest);
      } catch (error) {
        console.error('[ts-leaderboard] Sweep failed for message:', messageId, error);
        tsLeaderboardState.removeLeaderboard(guildId, messageId);
        lastDigestByMessageId.delete(messageId);
      }
    }
  }
}

module.exports = {
  buildTsLeaderboardEmbed,
  sweepTsLeaderboards,
};
