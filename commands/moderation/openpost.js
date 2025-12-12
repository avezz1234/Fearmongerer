const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('openpost')
    .setDescription('Unlock this forum post to allow new replies again.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads)
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Optional reason for reopening this post.')
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
      ? `Reopened by ${interaction.user.tag}: ${trimmedReason}`
      : `Reopened by ${interaction.user.tag}`;

    const publicLines = [];
    publicLines.push('\ud83d\udd13 This post has been unlocked by staff.');
    if (trimmedReason.length) {
      publicLines.push(`Reason: ${trimmedReason}`);
    }
    publicLines.push('New replies can now be added.');

    try {
      // Send the public notice in the forum post first, then unarchive/unlock it.
      await interaction.reply({
        content: publicLines.join('\n'),
        ephemeral: false,
      });

      await channel.setArchived(false, auditReason);
      await channel.setLocked(false, auditReason);
    } catch (error) {
      console.error('[openpost] Failed to unlock forum post:', error);
      const errorMessage =
        'There was an error while unlocking this forum post. Please check that I have permission to manage threads in this channel.';

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
