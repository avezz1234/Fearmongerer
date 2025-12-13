const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
} = require('@discordjs/voice');

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

    await interaction.deferReply({ ephemeral: true });

    if (channel.guildId !== guild.id) {
      await interaction.editReply('Please choose a voice channel from **this** server.');
      return;
    }

    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));

    if (!me) {
      await interaction.editReply('I could not determine my own member in this server to join voice.');
      return;
    }

    const perms = channel.permissionsFor(me);
    if (!perms || !perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.Connect)) {
      await interaction.editReply('I do not have permission to view/connect to that voice channel.');
      return;
    }

    try {
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
      });

      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

      const speakNote = perms.has(PermissionFlagsBits.Speak)
        ? ''
        : ' (Connected, but I do not have **Speak** permission in that channel)';

      await interaction.editReply(`Joined ${channel.toString()}.${speakNote}`);
    } catch (error) {
      console.error('Error executing /joinvc:', error);
      const detail = error && typeof error.message === 'string'
        ? ` (${error.message.slice(0, 180)})`
        : '';
      await interaction.editReply(
        `There was an error while trying to join that voice channel. Check my permissions and try again.${detail}`,
      );
    }
  },
};
