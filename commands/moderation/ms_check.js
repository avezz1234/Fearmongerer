const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MOD_FILE = path.join(DATA_DIR, 'moderations.json');

// NOTE: This must match the TICKET_DECISION_LOG_CHANNEL_ID constant in index.js and t_review.js.
const TICKET_DECISION_LOG_CHANNEL_ID = '1447705274243616809';

function getTimeWindow(timeKey) {
  const now = new Date();

  if (!timeKey) {
    return { sinceMs: null, label: 'All time' };
  }

  const key = String(timeKey).trim().toLowerCase();

  if (key === 'd') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { sinceMs: start.getTime(), label: 'Today' };
  }

  if (key === 'w') {
    // Monday-start week in the bot's local timezone.
    const start = new Date(now);
    const day = start.getDay(); // 0=Sun, 1=Mon, ...
    const diffToMonday = (day + 6) % 7;
    start.setDate(start.getDate() - diffToMonday);
    start.setHours(0, 0, 0, 0);
    return { sinceMs: start.getTime(), label: 'This week' };
  }

  if (key === 'm') {
    const start = new Date(now);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return { sinceMs: start.getTime(), label: 'This month' };
  }

  return { sinceMs: null, label: 'All time' };
}

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

function getModerationActionCount({ guildId, moderatorId, sinceMs }) {
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

    if (sinceMs) {
      const issuedAtRaw = entry.issuedAt;
      const issuedAtMs = Date.parse(issuedAtRaw);
      if (!Number.isFinite(issuedAtMs) || issuedAtMs < sinceMs) {
        continue;
      }
    }

    if (issuedBy === moderatorId && !undone) {
      count += 1;
    }
  }

  return count;
}

async function getTicketDecisionStatsForModerator(guild, moderatorId, { sinceMs } = {}) {
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
    const MAX_MESSAGES_TO_SCAN = 1000;
    let scanned = 0;
    let beforeId = null;

    // We page backwards until we either hit the start of the requested window or
    // reach our scan cap.
    // NOTE: This keeps "today/week/month" reasonably accurate even for busy channels.
    // (All-time still limited by MAX_MESSAGES_TO_SCAN, same as the previous 100 message cap.)
    while (scanned < MAX_MESSAGES_TO_SCAN) {
      const fetched = await logChannel.messages.fetch({
        limit: 100,
        ...(beforeId ? { before: beforeId } : {}),
      });

      if (fetched.size === 0) break;

      scanned += fetched.size;

      for (const message of fetched.values()) {
        if (sinceMs && message.createdTimestamp && message.createdTimestamp < sinceMs) {
          // This message is older than our window; keep scanning only if the collection
          // isn't strictly ordered. (In practice it is, so we can return early.)
          continue;
        }

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

      const oldest = fetched.last();
      if (!oldest) break;

      beforeId = oldest.id;

      if (sinceMs && oldest.createdTimestamp && oldest.createdTimestamp < sinceMs) {
        break;
      }
    }
  } catch (error) {
    console.error('[ms_check] Failed to scan ticket decision history:', error);
  }

  return result;
}

module.exports = {
  requiredPermissions: PermissionFlagsBits.BanMembers,
  data: new SlashCommandBuilder()
    .setName('ms_check')
    .setDescription('Check a moderator\'s ticket and moderation stats.')
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('moderator')
        .setDescription('Moderator to check; defaults to yourself')
        .setRequired(false),
    )
    .addStringOption(option =>
      option
        .setName('time')
        .setDescription('Time window: d=today, w=this week, m=this month (defaults to all time)')
        .setRequired(false)
        .addChoices(
          { name: 'Today (d)', value: 'd' },
          { name: 'This week (w)', value: 'w' },
          { name: 'This month (m)', value: 'm' },
        ),
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Reply ephemerally (default true)')
        .setRequired(false),
    ),
  async execute(interaction) {
    const guild = interaction.guild;

    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

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
      await interaction.deferReply({ ephemeral });

      const guildId = guild.id;
      const moderatorId = targetUser.id;

      const timeKey = interaction.options.getString('time') ?? null;
      const { sinceMs, label: timeLabel } = getTimeWindow(timeKey);

      const modActionCount = getModerationActionCount({
        guildId,
        moderatorId,
        sinceMs,
      });

      const ticketStats = await getTicketDecisionStatsForModerator(guild, moderatorId, {
        sinceMs,
      });

      const acceptedTickets = ticketStats.accepted;
      const deniedTickets = ticketStats.denied;
      const totalScore = acceptedTickets + deniedTickets + modActionCount;

      const label = targetUser.tag ?? targetUser.username ?? `<@${moderatorId}>`;

      const embed = new EmbedBuilder()
        .setTitle('Moderator Scorecard')
        .setColor(0x002b2d31)
        .setDescription(`Scorecard for **${label}**\nTime window: **${timeLabel}**`)
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
