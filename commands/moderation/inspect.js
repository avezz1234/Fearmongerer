const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MOD_FILE = path.join(DATA_DIR, 'moderations.json');

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
    console.error('Failed to read moderations.json for /inspect:', error);
    return {};
  }
}

module.exports = {
  requiredPermissions: PermissionFlagsBits.ModerateMembers,
  data: new SlashCommandBuilder()
    .setName('inspect')
    .setDescription('Inspect a moderation record by Moderation ID.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('moderation_id')
        .setDescription('Moderation ID to inspect (from warn/kick/ban messages).')
        .setRequired(true),
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Reply ephemerally (default true)')
        .setRequired(false),
    ),
  async execute(interaction) {
    const moderationId = interaction.options.getString('moderation_id', true);

    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

    const callerPermissions = interaction.memberPermissions;
    if (!callerPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply({
        content:
          'You do not have permission to use this command. (Moderate Members required.)',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral });

    const guildId = interaction.guild.id;
    const store = loadModerationsSafe();
    const guildStore = store[guildId] || {};
    const record = guildStore[moderationId];

    if (!record) {
      await interaction.editReply(
        'I could not find a moderation with that ID in this server. Double-check the Moderation ID and try again.',
      );
      return;
    }

    const type = record.type || 'unknown';
    const targetId = record.targetId || null;
    const targetTag = record.targetTag || null;
    const reason = record.reason || 'No reason recorded.';
    const issuedBy = record.issuedBy || null;
    const issuedAtIso = record.issuedAt || null;
    const expiresAtIso = record.expiresAt || null;
    const undone = record.undone === true;
    const undoneAtIso = record.undoneAt || null;
    const undoneBy = record.undoneBy || null;
    const undoReason = record.undoReason || null;

    const issuedTs = issuedAtIso ? Date.parse(issuedAtIso) : NaN;
    const issuedUnix = Number.isFinite(issuedTs) ? Math.floor(issuedTs / 1000) : null;

    const expiresTs = expiresAtIso ? Date.parse(expiresAtIso) : NaN;
    const expiresUnix = Number.isFinite(expiresTs) ? Math.floor(expiresTs / 1000) : null;

    const undoneTs = undoneAtIso ? Date.parse(undoneAtIso) : NaN;
    const undoneUnix = Number.isFinite(undoneTs) ? Math.floor(undoneTs / 1000) : null;

    let color = 0x002b2d31;
    if (type === 'warn') color = 0x00ffcc00;
    else if (type === 'kick') color = 0x00e67e22;
    else if (type === 'ban') color = 0x00e74c3c;

    if (undone) {
      color = 0x0095a5a6;
    }

    const targetLabel = targetId
      ? `${targetTag || 'Unknown user'} (<@${targetId}>)`
      : targetTag || 'Unknown user';

    const issuedByLabel = issuedBy ? `<@${issuedBy}>` : 'Unknown moderator';

    const fields = [
      { name: 'Moderation ID', value: moderationId, inline: false },
      { name: 'Type', value: type, inline: true },
      { name: 'Target', value: targetLabel, inline: true },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Issued by', value: issuedByLabel, inline: true },
    ];

    if (issuedUnix) {
      fields.push({
        name: 'Issued at',
        value: `<t:${issuedUnix}:F> (<t:${issuedUnix}:R>)`,
        inline: true,
      });
    }

    if (expiresUnix) {
      fields.push({
        name: 'Expires at',
        value: `<t:${expiresUnix}:F> (<t:${expiresUnix}:R>)`,
        inline: true,
      });
    }

    if (undone) {
      const undoneByLabel = undoneBy ? `<@${undoneBy}>` : 'Unknown moderator';
      const when = undoneUnix ? `<t:${undoneUnix}:F> (<t:${undoneUnix}:R>)` : 'unknown time';

      fields.push({
        name: 'Undone',
        value: `Yes, by ${undoneByLabel} at ${when}.`,
        inline: false,
      });

      if (undoReason) {
        fields.push({
          name: 'Undo reason',
          value: undoReason,
          inline: false,
        });
      }
    } else {
      fields.push({
        name: 'Undone',
        value: 'No (still active in the moderation log).',
        inline: false,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('Moderation Inspection')
      .setColor(color)
      .addFields(fields)
      .setTimestamp(new Date());

    await interaction.editReply({ embeds: [embed] });
  },
};
