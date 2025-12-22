const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const WARN_FILE = path.join(DATA_DIR, 'warnings.json');
const MOD_FILE = path.join(DATA_DIR, 'moderations.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadWarnings() {
  ensureDataDir();
  if (!fs.existsSync(WARN_FILE)) return {};

  try {
    const raw = fs.readFileSync(WARN_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to read warnings.json for /undomoderation:', error);
    return {};
  }
}

function saveWarnings(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(WARN_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to write warnings.json from /undomoderation:', error);
  }
}

function loadModerations() {
  ensureDataDir();
  if (!fs.existsSync(MOD_FILE)) return {};

  try {
    const raw = fs.readFileSync(MOD_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to read moderations.json for /undomoderation:', error);
    return {};
  }
}

function saveModerations(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(MOD_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to write moderations.json from /undomoderation:', error);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('undomoderation')
    .setDescription('Undo a previous warn, kick, or ban by Moderation ID.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Type of moderation to undo')
        .setRequired(true)
        .addChoices(
          { name: 'Warn', value: 'warn' },
          { name: 'Kick', value: 'kick' },
          { name: 'Ban', value: 'ban' },
        ),
    )
    .addStringOption(option =>
      option
        .setName('moderation_id')
        .setDescription('Moderation ID assigned by the original command')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for undoing this moderation')
        .setRequired(true),
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Reply ephemerally (default true)')
        .setRequired(false),
    ),
  async execute(interaction) {
    const type = interaction.options.getString('type', true);
    const moderationId = interaction.options.getString('moderation_id', true);
    const undoReason = interaction.options.getString('reason', true);

    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const callerPermissions = interaction.memberPermissions;
    if (!callerPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      await interaction.reply({
        content: 'You do not have permission to use this command. (Moderate Members required.)',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral });

    const sendResult = async ({ title, color, status, targetId, reasonText }) => {
      if (ephemeral) {
        const pieces = [];
        if (status) pieces.push(status);
        if (targetId) pieces.push(`Target: <@${targetId}>`);
        if (reasonText) pieces.push(`Reason: ${reasonText}`);
        pieces.push(`Moderation ID: ${moderationId}`);
        await interaction.editReply(pieces.join(' | '));
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .addFields(
          { name: 'Type', value: type, inline: true },
          { name: 'Moderation ID', value: moderationId, inline: true },
          { name: 'Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: false },
        )
        .setTimestamp(new Date());

      if (targetId) {
        embed.addFields({ name: 'Target', value: `<@${targetId}>`, inline: false });
      }

      if (reasonText) {
        embed.addFields({ name: 'Undo reason', value: reasonText, inline: false });
      }

      if (status) {
        embed.addFields({ name: 'Status', value: status, inline: false });
      }

      await interaction.editReply({ embeds: [embed] });
    };

    const guildId = interaction.guild.id;
    const moderations = loadModerations();
    const guildStore = moderations[guildId] || {};
    const record = guildStore[moderationId];

    if (!record || record.type !== type) {
      await interaction.editReply('I could not find a moderation with that ID and type in this server.');
      return;
    }

    if (record.undone) {
      await interaction.editReply('That moderation has already been marked as undone.');
      return;
    }

    const nowIso = new Date().toISOString();

    if (record.type === 'warn') {
      const warnings = loadWarnings();
      if (warnings[guildId] && Array.isArray(warnings[guildId][record.targetId])) {
        const before = warnings[guildId][record.targetId].length;
        warnings[guildId][record.targetId] = warnings[guildId][record.targetId].filter(entry => entry.id !== moderationId);
        const after = warnings[guildId][record.targetId].length;

        if (before !== after) {
          saveWarnings(warnings);
        }
      }

      record.undone = true;
      record.undoneAt = nowIso;
      record.undoneBy = interaction.user.id;
      record.undoReason = undoReason;
      moderations[guildId][moderationId] = record;
      saveModerations(moderations);

      await sendResult({
        title: 'Warning Undone',
        color: 0x0095a5a6,
        status: '✅ Removed the warning from the active warnings list.',
        targetId: record.targetId,
        reasonText: undoReason,
      });
      return;
    }

    if (record.type === 'ban') {
      let unbanned = false;
      try {
        await interaction.guild.members.unban(record.targetId, `Undo moderation ${moderationId} requested by ${interaction.user.tag}`);
        unbanned = true;
      } catch (error) {
        console.error('Error trying to unban during /undomoderation:', error);
      }

      record.undone = true;
      record.undoneAt = nowIso;
      record.undoneBy = interaction.user.id;
      record.undoReason = undoReason;
      moderations[guildId][moderationId] = record;
      saveModerations(moderations);

      if (unbanned) {
        await sendResult({
          title: 'Ban Undone',
          color: 0x0095a5a6,
          status:
            '✅ Unbanned the user. They will still need to rejoin the server manually.',
          targetId: record.targetId,
          reasonText: undoReason,
        });
      } else {
        await sendResult({
          title: 'Ban Marked Undone',
          color: 0x0095a5a6,
          status:
            'ℹ️ Marked the ban as undone, but could not unban the user (already unbanned, unknown user, or missing permission).',
          targetId: record.targetId,
          reasonText: undoReason,
        });
      }
      return;
    }

    if (record.type === 'kick') {
      record.undone = true;
      record.undoneAt = nowIso;
      record.undoneBy = interaction.user.id;
      record.undoReason = undoReason;
      moderations[guildId][moderationId] = record;
      saveModerations(moderations);

      await sendResult({
        title: 'Kick Marked Undone',
        color: 0x0095a5a6,
        status:
          '✅ Marked the kick as undone. Note: kicks cannot be automatically reversed; the user must rejoin the server manually.',
        targetId: record.targetId,
        reasonText: undoReason,
      });
      return;
    }

    await interaction.editReply('That moderation type is not supported by this command.');
  },
};
