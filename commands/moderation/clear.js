const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear messages from this channel from the last N days.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addIntegerOption(option =>
      option
        .setName('days')
        .setDescription('Number of days of messages to clear from this channel')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(30),
    ),
  async execute(interaction) {
    const days = interaction.options.getInteger('days', true);

    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const callerPermissions = interaction.memberPermissions;
    if (!callerPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: 'You do not have permission to use this command. (Manage Messages required.)',
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.channel;

    if (!channel || !channel.isTextBased()) {
      await interaction.reply({
        content: 'This command can only be used in a text-based channel in a server.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const clampedDays = Math.min(Math.max(days, 1), 30);
    const cutoffTimestamp = now - clampedDays * dayMs;

    const maxMessagesToScan = 5000;
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

    let scanned = 0;
    let totalDeleted = 0;
    let lastId;

    try {
      while (scanned < maxMessagesToScan) {
        const fetchLimit = Math.min(100, maxMessagesToScan - scanned);
        const fetched = await channel.messages.fetch(
          lastId
            ? { limit: fetchLimit, before: lastId }
            : { limit: fetchLimit },
        );

        if (fetched.size === 0) {
          break;
        }

        scanned += fetched.size;
        const lastMessage = fetched.last();
        if (!lastMessage) {
          break;
        }
        lastId = lastMessage.id;

        const messagesInRange = fetched.filter(
          message => !message.pinned && message.createdTimestamp >= cutoffTimestamp,
        );

        if (messagesInRange.size === 0) {
          const newest = fetched.first();
          if (newest && newest.createdTimestamp < cutoffTimestamp) {
            break;
          }
          continue;
        }

        const recentMessages = messagesInRange.filter(
          message => now - message.createdTimestamp < fourteenDaysMs,
        );

        const olderMessages = messagesInRange.filter(
          message => now - message.createdTimestamp >= fourteenDaysMs,
        );

        if (recentMessages.size > 0) {
          const deleted = await channel.bulkDelete(recentMessages, true).catch(() => null);
          if (deleted) {
            totalDeleted += deleted.size;
          }
        }

        for (const msg of olderMessages.values()) {
          try {
            await msg.delete();
            totalDeleted += 1;
          } catch {
            // Ignore failures for individual messages
          }
        }
      }

      if (totalDeleted === 0) {
        await interaction.editReply(
          `I couldn't find any messages in this channel from the last ${clampedDays} day(s) to delete (within the last ${maxMessagesToScan} messages I scanned).`,
        );
        return;
      }

      await interaction.editReply(
        `✅ Deleted **${totalDeleted}** message(s) from this channel from the last ${clampedDays} day(s) (scanned up to ${maxMessagesToScan} messages).`,
      );
    } catch (error) {
      console.error('Error executing /clear:', error);

      const message = 'There was an error while trying to clear messages from this channel.';

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message);
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  },
};
