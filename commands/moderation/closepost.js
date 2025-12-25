const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

module.exports = {
  requiredPermissions: PermissionFlagsBits.ManageThreads,
  data: new SlashCommandBuilder()
    .setName('closepost')
    .setDescription('Lock this forum post to stop new replies, with an optional reason.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Optional reason for closing this post.')
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
    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;
    const auditReason = trimmedReason.length
      ? `Closed by ${interaction.user.tag}: ${trimmedReason}`
      : `Closed by ${interaction.user.tag}`;

    const publicEmbed = new EmbedBuilder()
      .setTitle('Forum Post Locked')
      .setColor(0x00e67e22)
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
        await interaction.reply({ content: '✅ Locked this forum post.', ephemeral: true });
      } else {
        // Send the public notice in the forum post first, then lock/archive it.
        await interaction.reply({
          embeds: [publicEmbed],
          ephemeral: false,
        });
      }

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
