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
    .setName('kick')
    .setDescription('Kick a member and DM them the reason.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('Member to kick')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the kick')
        .setRequired(false),
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('target', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided.';

    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      await interaction.reply({ content: 'I could not find that member in this server.', ephemeral: true });
      return;
    }

    if (!member.kickable) {
      await interaction.reply({ content: 'I cannot kick that member (insufficient permissions or higher role).', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const moderationId = generateModerationId();
    const moderations = loadModerations();
    const guildId = interaction.guild.id;

    if (!moderations[guildId]) moderations[guildId] = {};
    moderations[guildId][moderationId] = {
      id: moderationId,
      type: 'kick',
      targetId: targetUser.id,
      targetTag: targetUser.tag,
      reason,
      issuedBy: interaction.user.id,
      issuedAt: new Date().toISOString(),
      undone: false,
    };
    saveModerations(moderations);

    try {
      try {
        const embed = new EmbedBuilder()
          .setTitle(`You have been kicked from ${interaction.guild.name}`)
          .setColor(0x00ffa500)
          .setDescription(reason)
          .addFields({ name: 'Moderation ID', value: moderationId, inline: false })
          .setTimestamp();

        await targetUser.send({ embeds: [embed] });
      } catch {
        // Ignore DM failures
      }

      await member.kick(`${reason} | Kicked by ${interaction.user.tag}`);

      await interaction.editReply(`✅ Kicked **${targetUser.tag}**. Reason: ${reason} (Moderation ID: ${moderationId})`);
    } catch (error) {
      console.error('Error executing /kick:', error);
      await interaction.editReply('There was an error while trying to kick that member.');
    }
  },
};
