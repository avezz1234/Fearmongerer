const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const {
  normalizeCommandName,
  grantCommandsToUser,
  grantCommandsToRole,
  getAllowedCommandsForUser,
  getAllowedCommandsForRole,
} = require('../../command_perms_state');

function parseCommandList(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return [];
  }

  return text
    .split(/[\s,]+/g)
    .map(part => part.trim())
    .filter(Boolean);
}

function formatCommandList(commands) {
  const list = Array.isArray(commands) ? commands.filter(Boolean) : [];
  if (!list.length) {
    return '(none)';
  }
  const shown = list.map(cmd => `\`/${cmd}\``).join(', ');
  return shown.length <= 1900 ? shown : `${shown.slice(0, 1899)}…`;
}

module.exports = {
  requiredPermissions: PermissionFlagsBits.ManageGuild,
  data: new SlashCommandBuilder()
    .setName('allow_cmd')
    .setDescription('Allow a user or role to use specific bot commands (internal bot perms).')
    .setDMPermission(false)
    .addMentionableOption(option =>
      option
        .setName('target')
        .setDescription('User or role to grant command access to')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('cmds')
        .setDescription('cmd(s)? Space/comma separated, e.g. "ban mute warn". Omit to view current.')
        .setRequired(false),
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Reply ephemerally (default true)')
        .setRequired(false),
    ),

  async execute(interaction) {
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const callerPermissions = interaction.memberPermissions;
    if (!callerPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: 'You do not have permission to use this command. (Manage Server required.)',
        ephemeral: true,
      });
      return;
    }

    const mentionable = interaction.options.getMentionable('target', true);
    if (!mentionable || typeof mentionable !== 'object' || typeof mentionable.id !== 'string') {
      await interaction.reply({ content: 'Invalid target.', ephemeral: true });
      return;
    }

    const isRole = typeof mentionable.name === 'string' && mentionable.permissions !== undefined;
    const targetId = mentionable.id;
    const targetLabel = isRole ? `<@&${targetId}>` : `<@${targetId}>`;

    const cmdsRaw = interaction.options.getString('cmds');
    if (!cmdsRaw || !cmdsRaw.trim()) {
      const current = isRole
        ? getAllowedCommandsForRole(interaction.guildId, targetId)
        : getAllowedCommandsForUser(interaction.guildId, targetId);

      await interaction.reply({
        content: `Allowed commands for ${targetLabel}: ${formatCommandList(current)}`,
        ephemeral: true,
      });
      return;
    }

    const requested = parseCommandList(cmdsRaw)
      .map(normalizeCommandName)
      .filter(Boolean);

    if (!requested.length) {
      await interaction.reply({
        content: 'No command names found. Example: `cmds: ban mute warn`',
        ephemeral: true,
      });
      return;
    }

    const uniqueRequested = Array.from(new Set(requested));

    const valid = [];
    const invalid = [];
    for (const cmd of uniqueRequested) {
      if (interaction.client?.commands?.has?.(cmd)) {
        valid.push(cmd);
      } else {
        invalid.push(cmd);
      }
    }

    if (!valid.length) {
      const invalidPreview = invalid.length ? invalid.slice(0, 25).map(c => `\`/${c}\``).join(', ') : '(none)';
      await interaction.reply({
        content: `None of those commands exist on this bot. Invalid: ${invalidPreview}`,
        ephemeral: true,
      });
      return;
    }

    const updated = isRole
      ? grantCommandsToRole(interaction.guildId, targetId, valid)
      : grantCommandsToUser(interaction.guildId, targetId, valid);

    const invalidPreview = invalid.length ? invalid.map(c => `\`/${c}\``).join(', ') : null;

    const lines = [
      `✅ Granted ${targetLabel} access to: ${formatCommandList(valid)}`,
      `Now allowed: ${formatCommandList(updated)}`,
    ];
    if (invalidPreview) {
      lines.push(`Ignored (unknown): ${invalidPreview}`);
    }

    await interaction.reply({
      content: lines.join('\n'),
      ephemeral,
    });
  },
};
