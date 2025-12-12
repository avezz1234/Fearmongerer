const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const {
  setWelcomeEnabled,
  setWelcomeMessageTemplate,
} = require('../../welcome_state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Turn the join welcome message on or off for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('state')
        .setDescription('Whether the welcome message should be enabled')
        .setRequired(true)
        .addChoices(
          { name: 'ON', value: 'on' },
          { name: 'OFF', value: 'off' },
        ),
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription(
          'Optional custom welcome text; use {user} where the member mention should appear',
        )
        .setRequired(false),
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
    const rawState = interaction.options.getString('state', true);
    const normalized = rawState.toLowerCase();
    const enabled = normalized === 'on';

    setWelcomeEnabled(guildId, enabled);

    const customTemplate = interaction.options.getString('message');
    if (customTemplate !== null) {
      setWelcomeMessageTemplate(guildId, customTemplate);
    }

    const statusText = enabled ? 'enabled' : 'disabled';

    let extra = '';
    if (customTemplate !== null) {
      const trimmed = customTemplate.trim();
      if (trimmed.length) {
        extra =
          '\n\nCustom welcome message updated. `{user}` will be replaced with the joining member mention.';
      } else {
        extra =
          '\n\nCustom welcome message cleared; the default message will be used.';
      }
    }

    await interaction.reply({
      content: `Join welcome messages are now **${statusText}** for this server.${extra}`,
      ephemeral: true,
    });
  },
};
