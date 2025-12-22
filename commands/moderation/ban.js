const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MOD_FILE = path.join(DATA_DIR, 'moderations.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadModerations() {
  ensureDataDir();
  if (!fs.existsSync(MOD_FILE)) return {};

  try {
    const raw = fs.readFileSync(MOD_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to read moderations.json, starting fresh:', error);
    return {};
  }
}

function saveModerations(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(MOD_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to write moderations.json:', error);
  }
}

function generateModerationId() {
  return crypto.randomBytes(4).toString('hex');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member and DM them the reason.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('Member to ban')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the ban')
        .setRequired(true),
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Reply ephemerally (default true)')
        .setRequired(false),
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('target', true);
    const rawReason = interaction.options.getString('reason', true);
    const reason = rawReason.trim();

    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

    if (!reason.length) {
      await interaction.reply({
        content: 'You must provide a non-empty reason for this ban.',
        ephemeral: true,
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const callerPermissions = interaction.memberPermissions;
    if (!callerPermissions?.has(PermissionFlagsBits.BanMembers)) {
      await interaction.reply({
        content: 'You do not have permission to use this command. (Ban Members required.)',
        ephemeral: true,
      });
      return;
    }

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      await interaction.reply({ content: 'I could not find that member in this server.', ephemeral: true });
      return;
    }

    if (!member.bannable) {
      await interaction.reply({ content: 'I cannot ban that member (insufficient permissions or higher role).', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral });

    const moderationId = generateModerationId();
    const moderations = loadModerations();
    const guildId = interaction.guild.id;

    if (!moderations[guildId]) moderations[guildId] = {};
    moderations[guildId][moderationId] = {
      id: moderationId,
      type: 'ban',
      targetId: targetUser.id,
      targetTag: targetUser.tag,
      reason,
      issuedBy: interaction.user.id,
      issuedAt: new Date().toISOString(),
      undone: false,
    };
    saveModerations(moderations);

    interaction.moderationId = moderationId;

    try {
      try {
        const embed = new EmbedBuilder()
          .setTitle(`You have been banned from ${interaction.guild.name}`)
          .setColor(0x00ff0000)
          .setDescription(reason)
          .addFields({ name: 'Moderation ID', value: moderationId, inline: false })
          .setTimestamp();

        await targetUser.send({ embeds: [embed] });
      } catch {
        // Ignore DM failures
      }

      await member.ban({ reason: `${reason} | Banned by ${interaction.user.tag}` });

      if (ephemeral) {
        await interaction.editReply(
          `✅ Banned **${targetUser.tag}**. Reason: ${reason} (Moderation ID: ${moderationId})`,
        );
      } else {
        const publicEmbed = new EmbedBuilder()
          .setTitle('Member Banned')
          .setColor(0x00e74c3c)
          .addFields(
            { name: 'Target', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
            { name: 'Reason', value: reason, inline: false },
            { name: 'Moderation ID', value: moderationId, inline: false },
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [publicEmbed] });
      }
    } catch (error) {
      console.error('Error executing /ban:', error);
      await interaction.editReply('There was an error while trying to ban that member.');
    }
  },
};
