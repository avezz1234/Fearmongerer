const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

module.exports = {
  requiredPermissions: PermissionFlagsBits.ManageMessages,
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock this channel for a duration to stop regular users from chatting.')
    .setDMPermission(false)
    .addIntegerOption(option =>
      option
        .setName('duration')
        .setDescription('How long to lock this channel (in minutes).')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(4320), // up to 3 days
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Optional message to send when locking the channel.')
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

    if (!guild || !channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'This command can only be used in a server text channel.',
        ephemeral: true,
      });
      return;
    }

    const durationMinutes = interaction.options.getInteger('duration', true);
    const customMessage = interaction.options.getString('message') ?? '';

    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

    const durationMs = durationMinutes * 60 * 1000;
    const unlockAt = new Date(Date.now() + durationMs);

    const everyoneRole = guild.roles.everyone;
    const staffRoles = guild.roles.cache.filter(
      role =>
        role.id !== everyoneRole.id &&
        role.permissions.has(PermissionFlagsBits.ManageMessages),
    );

    try {
      await channel.permissionOverwrites.edit(
        everyoneRole,
        { SendMessages: false },
        `Channel locked by ${interaction.user.tag} for ${durationMinutes} minute(s)`,
      );

      for (const role of staffRoles.values()) {
        await channel.permissionOverwrites.edit(
          role,
          { SendMessages: true },
          `Allow staff with Manage Messages to talk while channel is locked by ${interaction.user.tag}`,
        );
      }

      const lines = [];
      lines.push(`🔒 This channel has been locked for **${durationMinutes}** minute(s).`);
      if (customMessage.trim().length) {
        lines.push(customMessage.trim());
      }
      lines.push(
        `Only staff should talk here until it unlocks at <t:${Math.floor(
          unlockAt.getTime() / 1000,
        )}:t>.`,
      );

      if (ephemeral) {
        await interaction.reply({
          content: lines.join('\n'),
          ephemeral: true,
        });
      } else {
        const unix = Math.floor(unlockAt.getTime() / 1000);
        const embed = new EmbedBuilder()
          .setTitle('Channel Locked')
          .setColor(0x00e67e22)
          .addFields(
            { name: 'Channel', value: `${channel}`, inline: true },
            { name: 'Moderator', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
            { name: 'Duration', value: `${durationMinutes} minute(s)`, inline: true },
            { name: 'Unlocks at', value: `<t:${unix}:t> (<t:${unix}:R>)`, inline: true },
          )
          .setTimestamp(new Date());

        if (customMessage.trim().length) {
          embed.addFields({ name: 'Message', value: customMessage.trim(), inline: false });
        }

        await interaction.reply({ embeds: [embed], ephemeral: false });
      }

      setTimeout(async () => {
        try {
          await channel.permissionOverwrites.edit(
            everyoneRole,
            { SendMessages: null },
            `Channel automatically unlocked after ${durationMinutes} minute(s)`,
          );
          if (!ephemeral) {
            await channel.send('🔓 Channel unlocked.');
          }
        } catch {
          // ignore failures on unlock (channel deleted, perms changed, etc.)
        }
      }, durationMs);
    } catch (error) {
      console.error('[lock] Failed to lock channel:', error);
      try {
        await interaction.reply({
          content:
            'There was an error while locking this channel. Please check that I have permission to manage channel permissions.',
          ephemeral: true,
        });
      } catch {
        // ignore follow-up failures
      }
    }
  },
};
