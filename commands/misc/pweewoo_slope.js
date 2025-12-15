const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const anonPollState = require('../../anom_poll_state');
const anonPollLib = require('../../anom_poll_lib');
const pweewooJobs = require('../../pweewoo_jobs');

function clampInt(value, { min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min || i > max) return null;
  return i;
}

function labelForOptionIndex(idx) {
  return String.fromCharCode('A'.charCodeAt(0) + idx);
}

async function refreshAnonPollMessage(client, poll) {
  try {
    if (!poll || !poll.guildId || !poll.channelId || !poll.messageId) return;
    const guild = client.guilds.cache.get(poll.guildId) || null;
    if (!guild) return;
    const channel = await guild.channels.fetch(poll.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const message = await channel.messages.fetch(poll.messageId).catch(() => null);
    if (!message) return;

    const embed = anonPollLib.buildAnonPollEmbed(poll);
    const components = anonPollLib.buildAnonPollComponents(poll);
    await message.edit({ embeds: [embed], components }).catch(() => null);
  } catch {
    // ignore
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pweewoo_slope')
    .setDescription('Gradually increase votes for an anonymous poll option over time.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('poll_id')
        .setDescription('Anonymous poll ID to target')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option
        .setName('option')
        .setDescription('Which option to boost (1 = A, 2 = B, ...)')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('How many votes to add')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option
        .setName('duration_seconds')
        .setDescription('How long to run the slope (in seconds)')
        .setRequired(true),
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const guildId = interaction.guild.id;
    const pollId = interaction.options.getString('poll_id', true).trim();

    const poll = anonPollState.getAnonPoll(guildId, pollId);
    if (!poll) {
      await interaction.reply({ content: 'I could not find an anonymous poll with that ID in this server.', ephemeral: true });
      return;
    }

    if (poll.kind === 'public') {
      await interaction.reply({ content: 'This command only supports anonymous polls (not public polls).', ephemeral: true });
      return;
    }

    const optionRaw = interaction.options.getInteger('option', true);
    const optionOneBased = clampInt(optionRaw, { min: 1, max: 10 });
    if (!optionOneBased) {
      await interaction.reply({ content: 'Bad `option`. Use an integer between 1 and 10.', ephemeral: true });
      return;
    }

    const optionIndex = optionOneBased - 1;
    const options = Array.isArray(poll.options) ? poll.options : [];
    if (optionIndex < 0 || optionIndex >= options.length) {
      await interaction.reply({ content: `That poll only has ${options.length} option(s).`, ephemeral: true });
      return;
    }

    const amountRaw = interaction.options.getInteger('amount', true);
    const amount = clampInt(amountRaw, { min: 1, max: 5000 });
    if (!amount) {
      await interaction.reply({ content: 'Bad `amount`. Use an integer between 1 and 5000.', ephemeral: true });
      return;
    }

    const durationRaw = interaction.options.getInteger('duration_seconds', true);
    const durationSeconds = clampInt(durationRaw, { min: 1, max: 24 * 60 * 60 });
    if (!durationSeconds) {
      await interaction.reply({ content: 'Bad `duration_seconds`. Use 1 to 86400.', ephemeral: true });
      return;
    }

    const intervalMs = Math.max(500, Math.floor((durationSeconds * 1000) / amount));
    let remaining = amount;
    let lastRefreshAt = 0;

    pweewooJobs.startOrReplaceJob(guildId, pollId, {
      cancel: () => {
        // interval cleared below
      },
    });

    const keyPrefix = 'pweewoo';

    const intervalId = setInterval(async () => {
      if (remaining <= 0) {
        clearInterval(intervalId);
        pweewooJobs.stopJob(guildId, pollId);
        return;
      }

      const updated = anonPollState.addAnonPollSyntheticVotes(guildId, pollId, optionIndex, 1, { prefix: keyPrefix });
      if (updated) {
        const nowMs = Date.now();
        if (nowMs - lastRefreshAt >= 1500) {
          lastRefreshAt = nowMs;
          await refreshAnonPollMessage(interaction.client, updated);
        }
      }

      remaining -= 1;
    }, intervalMs);

    // Wire cancel to stop the interval.
    pweewooJobs.startOrReplaceJob(guildId, pollId, {
      cancel: () => {
        clearInterval(intervalId);
      },
    });

    const label = labelForOptionIndex(optionIndex);
    await interaction.reply({
      content: `Started **pweewoo slope** on poll **${pollId.slice(0, 8)}** (option **${label}**) — adding **${amount}** vote(s) over **${durationSeconds}s** (≈ every ${Math.max(1, Math.round(intervalMs / 1000))}s).`,
      ephemeral: true,
    });
  },
};
