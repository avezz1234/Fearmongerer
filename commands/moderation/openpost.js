const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

module.exports = {
  requiredPermissions: PermissionFlagsBits.ManageThreads,
  data: new SlashCommandBuilder()
    .setName('openpost')
    .setDescription('Unlock this forum post to allow new replies again.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Optional reason for reopening this post.')
        .setRequired(false),
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Reply ephemerally (default true)')
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
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

    const publicEmbed = new EmbedBuilder()
      .setTitle('Forum Post Unlocked')
      .setColor(0x2ecc71)
      .addFields(
        { name: 'Post', value: `${channel}`, inline: false },
        { name: 'Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: false },
      )
      .setTimestamp(new Date());

    if (trimmedReason.length) {
      publicEmbed.addFields({ name: 'Reason', value: trimmedReason, inline: false });
    }

    try {
      if (ephemeral) {
        await interaction.reply({ content: '✅ Unlocked this forum post.', ephemeral: true });
      } else {
        // Send the public notice in the forum post first, then unarchive/unlock it.
        await interaction.reply({
          embeds: [publicEmbed],
          ephemeral: false,
        });
      }

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
