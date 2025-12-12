const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setWelcomeChannelId, setWelcomeEnabled } = require('../../welcome_state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome_channel')
    .setDescription('Configure which channel join welcome messages are sent to.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to send welcome messages in')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild;
    const channel = interaction.options.getChannel('channel', true);

    if (!channel.isTextBased() || channel.guildId !== guild.id) {
      await interaction.reply({
        content: 'Please choose a text channel from **this** server.',
        ephemeral: true,
      });
      return;
    }

    setWelcomeChannelId(guild.id, channel.id);
    setWelcomeEnabled(guild.id, true);

    await interaction.reply({
      content: `Join welcome messages will now be sent in ${channel} and have been **enabled** for this server.`,
      ephemeral: true,
    });
  },
};
