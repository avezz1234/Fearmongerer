const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  requiredPermissions: PermissionFlagsBits.ManageMessages,
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Clear a number of recent messages in a chosen channel.')
    .setDMPermission(false)
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Number of recent messages to delete (1–100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to clear messages from (defaults to this channel)')
        .setRequired(false),
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Reply ephemerally (default true)')
        .setRequired(false),
    ),
  async execute(interaction) {
    const guild = interaction.guild;

    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const callerPermissions = interaction.memberPermissions;
    if (!callerPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content:
          'You do not have permission to use this command. (Manage Messages required.)',
        ephemeral: true,
      });
      return;
    }

    const targetChannel =
      interaction.options.getChannel('channel') ?? interaction.channel;

    if (!targetChannel || !targetChannel.isTextBased()) {
      await interaction.reply({
        content:
          'Please select a text-based channel in this server to clear messages from.',
        ephemeral: true,
      });
      return;
    }

    if (targetChannel.guildId !== guild.id) {
      await interaction.reply({
        content: 'You can only purge messages from channels in this server.',
        ephemeral: true,
      });
      return;
    }

    const botMember = guild.members.me;
    const botPerms = targetChannel.permissionsFor(botMember ?? guild.client.user);

    if (!botPerms || !botPerms.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content:
          'I do not have permission to manage messages in that channel. (Manage Messages required.)',
        ephemeral: true,
      });
      return;
    }

    const amount = interaction.options.getInteger('amount', true);

    await interaction.deferReply({ ephemeral });

    try {
      const deleted = await targetChannel.bulkDelete(amount, true);
      const deletedCount = deleted.size;

      if (deletedCount === 0) {
        await interaction.editReply(
          'I could not delete any messages. Messages older than 14 days cannot be bulk-deleted, and there may be nothing to remove.',
        );
        return;
      }

      await interaction.editReply(
        `✅ Deleted **${deletedCount}** message(s) from ${targetChannel} (requested: ${amount}).`,
      );
    } catch (error) {
      console.error('Error executing /purge:', error);

      const message =
        'There was an error while trying to clear messages in that channel. Please try again later.';

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message);
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  },
};
