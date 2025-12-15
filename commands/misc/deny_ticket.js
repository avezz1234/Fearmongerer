const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const { ticketState } = require('../../ticket_state');
const { dmTicketPresenter } = require('../../ticket_dm');

// NOTE: This must match the TICKET_DECISION_LOG_CHANNEL_ID constant in index.js and t_review.js.
const TICKET_DECISION_LOG_CHANNEL_ID = '1447705274243616809';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deny_ticket')
    .setDescription('Mark this ticket as denied, log the decision, and close this ticket channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for denying this ticket (optional)')
        .setRequired(false),
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
    let firstMessage = null;
    try {
      let lastMessage = null;
      // Walk backwards through the channel history to find the oldest message.
      // If the first message was sent by this bot, we treat this channel as a ticket.
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

      firstMessage = lastMessage;
      if (firstMessage && firstMessage.author.id === botId) {
        isTicketChannel = true;
      }
    } catch (error) {
      console.error(
        'Error determining if channel is a ticket (/deny_ticket):',
        error,
      );
    }

    if (!isTicketChannel) {
      await interaction.reply({
        content:
          'This command can only be used inside a ticket channel created by this bot.',
        ephemeral: true,
      });
      return;
    }

    const rawReason = interaction.options.getString('reason') ?? '';
    const reason = rawReason.trim().length
      ? rawReason.trim()
      : 'No reason provided.';

    const guild = interaction.guild;
    const staffUser = interaction.user;

    let ticketIdForLog = null;
    let storedTicket = null;

    try {
      await interaction.deferReply({ ephemeral: true });

      await interaction.editReply({
        content: 'Denying and closing this ticket channel...',
      });

      await channel.send(
        `This ticket has been **denied** by ${interaction.user}.\nReason: ${reason}`,
      );

      // Clean up the corresponding logged ticket created by the ticket panel so it
      // no longer appears as pending in the ticket list channel.
      try {
        const channelName = channel.name ?? '';
        let ticketId = null;

        // 1) Try to extract from channel name, e.g. "Report-ticket(ABC123)".
        const nameMatch = channelName.match(/\(([^)]+)\)\s*$/);
        if (nameMatch) {
          ticketId = nameMatch[1];
        }

        // 2) Fallback: if we still don't have an ID, inspect the original ticket
        //    embed for a Ticket ID field or parse it from the title.
        if (
          !ticketId &&
          firstMessage &&
          Array.isArray(firstMessage.embeds) &&
          firstMessage.embeds.length > 0
        ) {
          const embed = firstMessage.embeds[0];
          const fields = embed.fields ?? [];
          const idField = fields.find(field => field.name === 'Ticket ID');
          const fromField = idField?.value?.trim();

          if (fromField) {
            ticketId = fromField;
          } else if (typeof embed.title === 'string') {
            const titleMatch = embed.title.match(/Ticket\s+([A-Za-z0-9]+)/i);
            if (titleMatch) {
              ticketId = titleMatch[1].toUpperCase();
            }
          }
        }

        ticketIdForLog = ticketId ?? null;

        if (ticketId) {
          const stored = ticketState.get(ticketId);
          if (stored) {
            storedTicket = stored;
            if (typeof stored === 'object') {
              stored.finalDecision = 'Denied';
              stored.finalReason = reason;
              stored.finalizedBy = `${staffUser.tag} (${staffUser.id})`;
              stored.finalizedAt = new Date().toISOString();
              stored.finalizedFromChannelId = channel.id;
            }
            try {
              if (guild && stored.channelId && stored.messageId) {
                const logChannel =
                  guild.channels.cache.get(stored.channelId) ??
                  (await guild.channels
                    .fetch(stored.channelId)
                    .catch(() => null));

                if (logChannel && logChannel.isTextBased()) {
                  const logMessage = await logChannel.messages
                    .fetch(stored.messageId)
                    .catch(() => null);

                  if (logMessage && logMessage.deletable) {
                    await logMessage.delete();
                  }
                }
              }
            } finally {
              ticketState.delete(ticketId);
            }
          }
        }
      } catch (error) {
        console.error(
          '[tickets] Failed to clean up logged ticket when denying ticket:',
          error,
        );
      }

      // Try to delete the original ticket embed message in this channel, if we found it earlier.
      try {
        if (firstMessage && firstMessage.deletable) {
          await firstMessage.delete();
        }
      } catch (error) {
        console.error(
          'Error deleting original ticket embed when denying ticket:',
          error,
        );
      }

      // Log the final decision (Denied) in the ticket decision log channel.
      // NOTE: We intentionally log even if we couldn't extract a friendly ticket ID so
      // staff still get credit in /ms_check (which keys off Staff + Decision fields).
      try {
        if (guild && staffUser) {
          let decisionChannel = null;
          try {
            decisionChannel = await guild.channels.fetch(
              TICKET_DECISION_LOG_CHANNEL_ID,
            );
          } catch (error) {
            console.error(
              '[tickets] Failed to fetch ticket decision log channel:',
              error,
            );
          }

          if (decisionChannel && decisionChannel.isTextBased()) {
            const reasonFieldValue = reason && reason.trim().length
              ? reason.trim()
              : 'Not provided.';

            const ticketIdValue = ticketIdForLog ?? channel.id;

            const fields = [
              { name: 'Ticket ID', value: String(ticketIdValue), inline: true },
              { name: 'Decision', value: 'Denied', inline: true },
              {
                name: 'Staff',
                value: `${staffUser.tag} (${staffUser.id})`,
                inline: false,
              },
              {
                name: 'Reason for denial',
                value: reasonFieldValue,
                inline: false,
              },
              {
                name: 'Ticket channel',
                value: `${channel.toString()} (${channel.id})`,
                inline: false,
              },
            ];

            const embed = new EmbedBuilder()
              .setTitle('Ticket Decision')
              .setColor(0x00e74c3c)
              .addFields(fields)
              .setTimestamp(new Date());

            await decisionChannel.send({ embeds: [embed] });
          }
        }
      } catch (error) {
        console.error(
          '[tickets] Failed to log denied ticket decision from /deny_ticket:',
          error,
        );
      }

      if (storedTicket) {
        dmTicketPresenter(interaction.client, storedTicket, {
          decision: 'Denied',
          reason,
        });
      }

      setTimeout(() => {
        channel
          .delete(`Ticket denied by ${interaction.user.tag}: ${reason}`)
          .catch(() => {
            // ignore delete failures
          });
      }, 5000);
    } catch (error) {
      console.error('Error executing /deny_ticket:', error);
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({
            content:
              'There was an error while trying to deny and close this ticket.',
          });
        } else if (!interaction.replied) {
          await interaction.reply({
            content:
              'There was an error while trying to deny and close this ticket.',
            ephemeral: true,
          });
        }
      } catch {
        // ignore follow-up failures
      }
    }
  },
};
