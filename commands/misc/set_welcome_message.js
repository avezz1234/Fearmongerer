const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setWelcomeMessageTemplate } = require('../../welcome_state');

module.exports = {
  requiredPermissions: PermissionFlagsBits.ManageGuild,
  data: new SlashCommandBuilder()
    .setName('set_welcome_message')
    .setDescription('Set the custom welcome message template for this server.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription(
          'Custom welcome text; use {user} where the member mention should appear',
        )
        .setRequired(true),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const guildId = interaction.guild.id;
    const raw = interaction.options.getString('message', true);
    const trimmed = raw.trim();

    if (!trimmed.length) {
      setWelcomeMessageTemplate(guildId, '');
      await interaction.reply({
        content: 'Welcome message cleared; the default message will be used.',
        ephemeral: true,
      });
      return;
    }

    setWelcomeMessageTemplate(guildId, trimmed);

    await interaction.reply({
      content:
        'Custom welcome message updated. `{user}` will be replaced with the joining member mention.',
      ephemeral: true,
    });
  },
};
