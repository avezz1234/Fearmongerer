const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('closepost')
    .setDescription('Lock this forum post to stop new replies, with an optional reason.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads)
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Optional reason for closing this post.')
        .setRequired(false),
    ),
  async execute(interaction) {
    const channel = interaction.channel;
    const guild = interaction.guild;

    if (!guild || !channel || !channel.isThread() || channel.parent?.type !== ChannelType.GuildForum) {
      await interaction.reply({
        content: 'This command can only be used inside a forum post (thread).',
        ephemeral: true,
      });
      return;
    }

    const reason = interaction.options.getString('reason') ?? '';
    const trimmedReason = reason.trim();
    const auditReason = trimmedReason.length
      ? `Closed by ${interaction.user.tag}: ${trimmedReason}`
      : `Closed by ${interaction.user.tag}`;

    const publicLines = [];
    publicLines.push('🔒 This post has been locked by staff.');
    if (trimmedReason.length) {
      publicLines.push(`Reason: ${trimmedReason}`);
    }
    publicLines.push('No new replies can be added.');

    try {
      // Send the public notice in the forum post first, then lock/archive it.
      await interaction.reply({
        content: publicLines.join('\n'),
        ephemeral: false,
      });

      await channel.setLocked(true, auditReason);
      await channel.setArchived(true, auditReason);
    } catch (error) {
      console.error('[closepost] Failed to lock forum post:', error);
      const errorMessage =
        'There was an error while locking this forum post. Please check that I have permission to manage threads in this channel.';

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
          await interaction.reply({ content: errorMessage, ephemeral: true });
        }
      } catch {
        // Ignore follow-up failures
      }
    }
  },
};
