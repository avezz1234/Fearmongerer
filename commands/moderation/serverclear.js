const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverclear')
    .setDescription('Clear a user\'s messages across all channels in this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('player')
        .setDescription('User whose messages to clear across the server')
        .setRequired(true),
    )
    .addBooleanOption(option =>
      option
        .setName('ephemeral')
        .setDescription('Reply ephemerally (default true)')
        .setRequired(false),
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser('player', true);

    const ephemeral = interaction.options.getBoolean('ephemeral') ?? true;

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

    const guild = interaction.guild;
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));

    if (!me) {
      await interaction.reply({
        content: 'I could not determine my own member in this server to check permissions.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral });

    const maxMessagesPerChannel = 500;
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    let totalDeleted = 0;
    let channelsScanned = 0;

    try {
      const channels = await guild.channels.fetch();

      for (const channel of channels.values()) {
        if (!channel || !channel.isTextBased()) {
          continue;
        }

        const permissions = channel.permissionsFor(me);
        if (
          !permissions?.has(PermissionFlagsBits.ViewChannel) ||
          !permissions?.has(PermissionFlagsBits.ReadMessageHistory) ||
          !permissions?.has(PermissionFlagsBits.ManageMessages)
        ) {
          continue;
        }

        channelsScanned += 1;

        let scanned = 0;
        let lastId;

        while (scanned < maxMessagesPerChannel) {
          const fetchLimit = Math.min(100, maxMessagesPerChannel - scanned);
          const fetched = await channel.messages
            .fetch(lastId ? { limit: fetchLimit, before: lastId } : { limit: fetchLimit })
            .catch(() => null);

          if (!fetched || fetched.size === 0) {
            break;
          }

          scanned += fetched.size;
          const lastMessage = fetched.last();
          if (!lastMessage) {
            break;
          }
          lastId = lastMessage.id;

          const messagesFromUser = fetched.filter(
            message => message.author.id === targetUser.id && !message.pinned,
          );

          if (messagesFromUser.size === 0) {
            continue;
          }

          const now = Date.now();
          const recentMessages = messagesFromUser.filter(
            message => now - message.createdTimestamp < fourteenDaysMs,
          );
          const olderMessages = messagesFromUser.filter(
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
      }

      if (totalDeleted === 0) {
        await interaction.editReply(
          `I couldn't find any messages from **${targetUser.tag}** to delete across this server (within the last ${maxMessagesPerChannel} messages per text channel I scanned).`,
        );
        return;
      }

      await interaction.editReply(
        `\u2705 Deleted **${totalDeleted}** message(s) from **${targetUser.tag}** across this server (scanned up to ${maxMessagesPerChannel} messages per text channel).`,
      );
    } catch (error) {
      console.error('Error executing /serverclear:', error);

      const message = 'There was an error while trying to clear messages for that user across the server.';

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message);
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  },
};
