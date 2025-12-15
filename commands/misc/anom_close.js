const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const anonPollState = require('../../anom_poll_state');
const anonPollLib = require('../../anom_poll_lib');

function formatPercent(count, total) {
  if (!total) return '0.0%';
  return `${((count / total) * 100).toFixed(1)}%`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('anom_close')
    .setDescription('Close an anonymous poll and publish final results.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('poll_id')
        .setDescription('Poll ID to close (optional; defaults to your most recent open anon poll)')
        .setRequired(false),
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const guildId = guild.id;
    const pollIdRaw = interaction.options.getString('poll_id', false);
    const pollId = typeof pollIdRaw === 'string' ? pollIdRaw.trim() : '';

    let poll = null;
    if (pollId) {
      poll = anonPollState.getAnonPoll(guildId, pollId);
      if (!poll) {
        await interaction.editReply('I could not find an anonymous poll with that ID in this server.');
        return;
      }
    } else {
      poll = anonPollState.findMostRecentOpenAnonPollByOwner(guildId, interaction.user.id);
      if (!poll) {
        await interaction.editReply('You have no open anonymous polls in this server.');
        return;
      }
    }

    if (poll.closed) {
      await interaction.editReply('That poll is already closed.');
      return;
    }

    const closed = anonPollState.closeAnonPoll(guildId, poll.id, { nowMs: Date.now(), closedBy: interaction.user.id });
    if (!closed) {
      await interaction.editReply('Failed to close the poll (unexpected).');
      return;
    }

    let edited = false;
    let channelForSend = null;
    try {
      const channel = await guild.channels.fetch(closed.channelId).catch(() => null);
      if (channel && channel.isTextBased()) {
        channelForSend = channel;
        const message = await channel.messages.fetch(closed.messageId).catch(() => null);
        if (message) {
          const embed = anonPollLib.buildAnonPollEmbed(closed);
          const components = anonPollLib.buildAnonPollComponents(closed);
          await message.edit({ embeds: [embed], components });
          edited = true;
        }
      }
    } catch {
      edited = false;
    }

    // Post a readable, non-embed summary highlighting the winner.
    if (channelForSend) {
      try {
        const title = (typeof closed.title === 'string' && closed.title.trim().length)
          ? closed.title.trim()
          : 'Anonymous Poll';
        const question = typeof closed.question === 'string' ? closed.question.trim() : '';
        const options = Array.isArray(closed.options) ? closed.options : [];
        const { counts, totalVotes, uniqueVoters } = anonPollLib.getVoteCounts(closed);
        const maxCount = counts.length ? Math.max(...counts) : 0;
        const winnerIdxs = maxCount > 0
          ? counts.map((c, i) => (c === maxCount ? i : -1)).filter(i => i >= 0)
          : [];

        const labelFor = idx => String.fromCharCode('A'.charCodeAt(0) + idx);

        const lines = options.map((opt, i) => {
          const count = counts[i] || 0;
          const pct = formatPercent(count, totalVotes);
          const label = labelFor(i);
          const base = `${label}) ${opt} — ${count} (${pct})`;
          return winnerIdxs.includes(i) ? `**${base}**` : base;
        });

        let winnerLine = '';
        if (!totalVotes) {
          winnerLine = '**Winner:** (no votes)';
        } else if (winnerIdxs.length === 1) {
          const i = winnerIdxs[0];
          winnerLine = `**Winner:** **${labelFor(i)}) ${options[i]}**`;
        } else {
          const names = winnerIdxs.map(i => `${labelFor(i)}) ${options[i]}`).join(' / ');
          winnerLine = `**Winner:** **TIE** (${names})`;
        }

        const link = `https://discord.com/channels/${guildId}/${closed.channelId}/${closed.messageId}`;
        const content = [
          `**${title} — Result**`,
          question ? `**Question:** ${question}` : null,
          '',
          ...lines,
          '',
          winnerLine,
          `*${totalVotes} vote(s) from ${uniqueVoters} user(s)*`,
          link,
        ].filter(Boolean).join('\n');

        await channelForSend.send({ content });
      } catch {
        // ignore send failures
      }
    }

    const link = `https://discord.com/channels/${guildId}/${closed.channelId}/${closed.messageId}`;
    await interaction.editReply(
      edited
        ? `✅ Closed poll **${closed.id.slice(0, 8)}**. ${link}`
        : `✅ Closed poll **${closed.id.slice(0, 8)}** (but I couldn’t edit the original message). ${link}`,
    );
  },
};
