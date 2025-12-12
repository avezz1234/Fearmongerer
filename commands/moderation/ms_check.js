const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MOD_FILE = path.join(DATA_DIR, 'moderations.json');

// NOTE: This must match the TICKET_DECISION_LOG_CHANNEL_ID constant in index.js and t_review.js.
const TICKET_DECISION_LOG_CHANNEL_ID = '1447705274243616809';

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadModerationsSafe() {
  ensureDataDir();
  if (!fs.existsSync(MOD_FILE)) return {};

  try {
    const raw = fs.readFileSync(MOD_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to read moderations.json for /ms_check:', error);
    return {};
  }
}

function getModerationActionCount({ guildId, moderatorId }) {
  if (!guildId || !moderatorId) return 0;

  const store = loadModerationsSafe();
  const guildStore = store[guildId];
  if (!guildStore || typeof guildStore !== 'object') {
    return 0;
  }

  let count = 0;

  for (const entry of Object.values(guildStore)) {
    if (!entry || typeof entry !== 'object') continue;

    const issuedBy = entry.issuedBy;
    const undone = entry.undone === true;

    if (issuedBy === moderatorId && !undone) {
      count += 1;
    }
  }

  return count;
}

async function getTicketDecisionStatsForModerator(guild, moderatorId) {
  const result = {
    accepted: 0,
    denied: 0,
  };

  if (!guild || !moderatorId) {
    return result;
  }

  let logChannel = null;

  try {
    logChannel = await guild.channels.fetch(TICKET_DECISION_LOG_CHANNEL_ID);
  } catch (error) {
    console.error('[ms_check] Failed to fetch ticket decision log channel:', error);
    return result;
  }

  if (!logChannel || !logChannel.isTextBased()) {
    return result;
  }

  try {
    const messages = await logChannel.messages.fetch({ limit: 100 });

    for (const message of messages.values()) {
      if (!Array.isArray(message.embeds) || message.embeds.length === 0) {
        continue;
      }

      const embed = message.embeds[0];
      const fields = embed.fields ?? [];

      const staffField = fields.find(field => field.name === 'Staff');
      const decisionField = fields.find(field => field.name === 'Decision');

      if (!staffField || !decisionField) continue;

      const staffValue = staffField.value || '';
      const idMatch = staffValue.match(/\((\d{5,})\)\s*$/);
      const staffId = idMatch ? idMatch[1] : null;

      if (staffId !== moderatorId) continue;

      const decision = (decisionField.value || '').trim().toLowerCase();

      if (decision === 'accepted') {
        result.accepted += 1;
      } else if (decision === 'denied') {
        result.denied += 1;
      }
    }
  } catch (error) {
    console.error('[ms_check] Failed to scan ticket decision history:', error);
  }

  return result;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ms_check')
    .setDescription('Check a moderator\'s ticket and moderation stats.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('moderator')
        .setDescription('Moderator to check; defaults to yourself')
        .setRequired(false),
    ),
  async execute(interaction) {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true,
      });
      return;
    }

    const member = interaction.member;
    const permissions = member?.permissions;

    if (!permissions || !permissions.has(PermissionFlagsBits.BanMembers)) {
      await interaction.reply({
        content: 'You need the **Ban Members** permission to use this command.',
        ephemeral: true,
      });
      return;
    }

    const targetUser =
      interaction.options.getUser('moderator') ?? interaction.user;

    try {
      await interaction.deferReply({ ephemeral: true });

      const guildId = guild.id;
      const moderatorId = targetUser.id;

      const modActionCount = getModerationActionCount({
        guildId,
        moderatorId,
      });

      const ticketStats = await getTicketDecisionStatsForModerator(
        guild,
        moderatorId,
      );

      const acceptedTickets = ticketStats.accepted;
      const deniedTickets = ticketStats.denied;
      const totalScore = acceptedTickets + deniedTickets + modActionCount;

      const label = targetUser.tag ?? targetUser.username ?? `<@${moderatorId}>`;

      const embed = new EmbedBuilder()
        .setTitle('Moderator Scorecard')
        .setColor(0x2b2d31)
        .setDescription(`Scorecard for **${label}**`)
        .addFields(
          {
            name: 'Tickets accepted',
            value: String(acceptedTickets),
            inline: true,
          },
          {
            name: 'Tickets denied',
            value: String(deniedTickets),
            inline: true,
          },
          {
            name: 'Moderation actions',
            value: String(modActionCount),
            inline: true,
          },
          {
            name: 'Total',
            value: `${totalScore}`,
            inline: false,
          },
        )
        .setTimestamp(new Date());

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error executing /ms_check:', error);

      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({
            content:
              'There was an error while checking moderator stats. Please try again later.',
          });
        } else if (!interaction.replied) {
          await interaction.reply({
            content:
              'There was an error while checking moderator stats. Please try again later.',
            ephemeral: true,
          });
        }
      } catch {
        // Ignore follow-up failures
      }
    }
  },
};
