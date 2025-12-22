const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// Legacy stub: this command has been replaced by /channel_blacklist.

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ki_blacklist')
    .setDescription('Deprecated: use /channel_blacklist instead.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to blacklist (ignored; use /channel_blacklist instead).')
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
    await interaction.reply({
      content:
        'This command has been replaced by `/channel_blacklist`. Please use that command and pick the appropriate channel instead.',
      ephemeral,
    });
  },
};
