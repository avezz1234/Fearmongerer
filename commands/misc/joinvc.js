const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('joinvc')
    .setDescription('Make the bot join a specified voice channel.')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Voice channel to join')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
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

    const guild = interaction.guild;
    const channel = interaction.options.getChannel('channel', true);

    if (
      channel.type !== ChannelType.GuildVoice &&
      channel.type !== ChannelType.GuildStageVoice
    ) {
      await interaction.reply({
        content: 'Please choose a voice or stage channel.',
        ephemeral: true,
      });
      return;
    }

    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));

    if (!me) {
      await interaction.reply({
        content: 'I could not determine my own member in this server to join voice.',
        ephemeral: true,
      });
      return;
    }

    const perms = channel.permissionsFor(me);
    if (!perms || !perms.has(PermissionFlagsBits.Connect)) {
      await interaction.reply({
        content: 'I do not have permission to connect to that voice channel.',
        ephemeral: true,
      });
      return;
    }

    try {
      await me.voice.setChannel(channel, `Requested via /joinvc by ${interaction.user.tag}`);

      await interaction.reply({
        content: `Joined ${channel.toString()}.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('Error executing /joinvc:', error);
      await interaction.reply({
        content:
          'There was an error while trying to join that voice channel. Check my permissions and try again.',
        ephemeral: true,
      });
    }
  },
};
