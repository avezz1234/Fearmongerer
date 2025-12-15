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

function normalizePollId(value) {
  return String(value || '').trim().toLowerCase().replaceAll('-', '');
}

function resolveAnonPollByIdOrPrefix(guildId, input) {
  const needle = normalizePollId(input);
  if (!needle) return null;

  const polls = anonPollState.listAnonPolls(guildId);
  const matches = polls.filter(p => {
    const hay = normalizePollId(p?.id);
    return hay && hay.startsWith(needle);
  });

  if (matches.length !== 1) {
    return { poll: null, ambiguous: matches.length > 1 };
  }

  return { poll: matches[0], ambiguous: false };
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
    .setName('pweewoo_leech')
    .setDescription('Gradually siphon votes away from an anonymous poll option over time.')
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
        .setDescription('Which option to leech from (1 = A, 2 = B, ...)')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('How many votes to remove')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option
        .setName('duration_seconds')
        .setDescription('How long to run the leech (in seconds)')
        .setRequired(true),
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const guildId = interaction.guild.id;
    const pollIdInput = interaction.options.getString('poll_id', true).trim();

    const resolved = resolveAnonPollByIdOrPrefix(guildId, pollIdInput);
    if (!resolved || !resolved.poll) {
      const msg = resolved && resolved.ambiguous
        ? 'That poll ID prefix matches multiple polls. Please paste a longer prefix or the full UUID.'
        : 'I could not find an anonymous poll with that ID in this server. (Tip: you can paste the 8-char Poll ID from the embed footer.)';
      await interaction.reply({ content: msg, ephemeral: true });
      return;
    }

    const poll = resolved.poll;
    const pollId = poll.id;

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
    let removedTotal = 0;
    let lastRefreshAt = 0;

    const preferPrefix = 'pweewoo';

    const intervalId = setInterval(async () => {
      if (remaining <= 0) {
        clearInterval(intervalId);
        pweewooJobs.stopJob(guildId, pollId);
        return;
      }

      const result = anonPollState.removeAnonPollVotesFromChoice(guildId, pollId, optionIndex, 1, { preferPrefix });
      if (result && result.poll) {
        removedTotal += result.removed || 0;
        const nowMs = Date.now();
        if (nowMs - lastRefreshAt >= 1500) {
          lastRefreshAt = nowMs;
          await refreshAnonPollMessage(interaction.client, result.poll);
        }
      }

      remaining -= 1;
    }, intervalMs);

    pweewooJobs.startOrReplaceJob(guildId, pollId, {
      cancel: () => {
        clearInterval(intervalId);
      },
    });

    const label = labelForOptionIndex(optionIndex);
    await interaction.reply({
      content: `Started **pweewoo leech** on poll **${pollId.slice(0, 8)}** (option **${label}**) — removing up to **${amount}** vote(s) over **${durationSeconds}s** (≈ every ${Math.max(1, Math.round(intervalMs / 1000))}s).`,
      ephemeral: true,
    });
  },
};
