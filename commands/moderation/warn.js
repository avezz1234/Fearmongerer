const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const WARN_TTL_DAYS = 30;
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
    console.error('Failed to read warnings.json, starting fresh:', error);
    return {};
  }
}

function saveWarnings(store) {
  ensureDataDir();
  try {
    fs.writeFileSync(WARN_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to write warnings.json:', error);
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
    .setName('warn')
    .setDescription('Send a warning DM to a member and track active warns.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('Member to warn')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the warning')
        .setRequired(false),
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Reply ephemerally (default true)')
        .setRequired(false),
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('target', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided.';

    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral });

    const now = Date.now();
    const warnTtlMs = WARN_TTL_DAYS * 24 * 60 * 60 * 1000;
    const expiresAt = now + warnTtlMs;
    const expiresAtUnix = Math.floor(expiresAt / 1000);

    const guildId = interaction.guild.id;
    const userId = targetUser.id;

    const moderationId = generateModerationId();

    const store = loadWarnings();
    if (!store[guildId]) store[guildId] = {};
    if (!store[guildId][userId]) store[guildId][userId] = [];

    const existing = store[guildId][userId].filter(entry => {
      if (!entry.expiresAt) return true;
      const ts = Date.parse(entry.expiresAt);
      return Number.isFinite(ts) && ts > now;
    });

    const newWarn = {
      id: moderationId,
      reason,
      issuedBy: interaction.user.id,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    };

    existing.push(newWarn);
    store[guildId][userId] = existing;

    const activeCount = existing.length;

    saveWarnings(store);

    const moderations = loadModerations();
    if (!moderations[guildId]) moderations[guildId] = {};
    moderations[guildId][moderationId] = {
      id: moderationId,
      type: 'warn',
      targetId: userId,
      targetTag: targetUser.tag,
      reason,
      issuedBy: interaction.user.id,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      undone: false,
    };
    saveModerations(moderations);

    try {
      try {
        const dmEmbed = new EmbedBuilder()
          .setTitle(`You have been warned in ${interaction.guild.name}`)
          .setColor(0x00ffcc00)
          .setDescription(reason)
          .addFields(
            { name: 'Active warnings (this server)', value: String(activeCount), inline: true },
            { name: 'Expires', value: `<t:${expiresAtUnix}:F> (<t:${expiresAtUnix}:R>)`, inline: true },
            { name: 'Moderation ID', value: moderationId, inline: false },
          )
          .setTimestamp();

        await targetUser.send({ embeds: [dmEmbed] });
      } catch {
        // Ignore DM failures (user may have DMs disabled or blocked the bot)
      }

      if (ephemeral) {
        await interaction.editReply(
          `⚠️ Warned **${targetUser.tag}**. Active warnings in this server: ${activeCount}. Expires <t:${expiresAtUnix}:F> (<t:${expiresAtUnix}:R>). Reason: ${reason} (Moderation ID: ${moderationId})`,
        );
      } else {
        const publicEmbed = new EmbedBuilder()
          .setTitle('Member Warned')
          .setColor(0x00f1c40f)
          .addFields(
            { name: 'Target', value: `${targetUser.tag} (<@${targetUser.id}>)`, inline: true },
            { name: 'Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
            { name: 'Reason', value: reason, inline: false },
            { name: 'Active warnings (this server)', value: String(activeCount), inline: true },
            { name: 'Expires', value: `<t:${expiresAtUnix}:F> (<t:${expiresAtUnix}:R>)`, inline: true },
            { name: 'Moderation ID', value: moderationId, inline: false },
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [publicEmbed] });
      }
    } catch (error) {
      console.error('Error executing /warn:', error);
      await interaction.editReply('There was an error while trying to warn that member.');
    }
  },
};
