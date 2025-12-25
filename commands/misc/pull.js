const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  requiredPermissions: PermissionFlagsBits.ManageChannels,
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Pull a user into this ticket channel by granting them access.')
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('User to pull into this ticket')
        .setRequired(true),
    ),
  async execute(interaction) {
    const channel = interaction.channel;

    if (!interaction.guild || !channel || !channel.isTextBased()) {
      await interaction.reply({
        content: 'This command can only be used in a server text channel.',
        ephemeral: true,
      });
      return;
    }
    const botId = interaction.client?.user?.id;
    if (!botId) {
      await interaction.reply({
        content:
          'Unable to determine bot identity; cannot verify whether this is a ticket channel.',
        ephemeral: true,
      });
      return;
    }

    let isTicketChannel = false;
    try {
      let lastMessage = null;
      // Walk backwards through the channel history to find the oldest message.
      // Ticket channels are typically small, so this should be inexpensive.
      // We avoid relying on channel naming and instead look at who created
      // the channel's first message. If the first message was sent by this
      // bot, we treat this channel as a ticket.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const fetched = await channel.messages.fetch({
          limit: 100,
          ...(lastMessage ? { before: lastMessage.id } : {}),
        });

        if (fetched.size === 0) break;

        lastMessage = fetched.last();
        if (fetched.size < 100) break;
      }

      const firstMessage = lastMessage;
      if (firstMessage && firstMessage.author.id === botId) {
        isTicketChannel = true;
      }
    } catch (error) {
      console.error('Error determining if channel is a ticket (pull):', error);
    }

    if (!isTicketChannel) {
      await interaction.reply({
        content:
          'This command can only be used inside a ticket channel created by this bot.',
        ephemeral: true,
      });
      return;
    }

    const targetUser = interaction.options.getUser('target', true);

    try {
      await channel.permissionOverwrites.edit(targetUser.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });

      await interaction.reply({
        content: `Pulled **${targetUser.tag}** into this ticket channel.`,
        ephemeral: true,
      });

      await channel.send(
        `Pulling ${targetUser} into this ticket (requested by ${interaction.user}).`,
      );
    } catch (error) {
      console.error('Error executing /pull:', error);
      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({
            content:
              'There was an error while trying to pull that user into this ticket.',
            ephemeral: true,
          });
        } catch {
          // ignore follow-up failures
        }
      }
    }
  },
};
