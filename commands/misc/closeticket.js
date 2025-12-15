const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const { ticketState } = require('../../ticket_state');
const { incrementAcceptedTickets } = require('../../ticket_stats');
const { dmTicketPresenter } = require('../../ticket_dm');

// NOTE: This must match the TICKET_DECISION_LOG_CHANNEL_ID constant in index.js and t_review.js.
const TICKET_DECISION_LOG_CHANNEL_ID = '1447705274243616809';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('accept_ticket')
    .setDescription('Mark this ticket as accepted, log the decision, and close this ticket channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for accepting this ticket (optional)')
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
        'Error determining if channel is a ticket (/accept_ticket):',
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

    const reason =
      interaction.options.getString('reason') ?? 'No reason provided.';

    const guild = interaction.guild;
    const staffUser = interaction.user;

    let ticketIdForLog = null;
    let reporterIdForStats = null;
    let storedTicket = null;

    try {
      await interaction.deferReply({ ephemeral: true });

      await interaction.editReply({
        content: 'Accepting and closing this ticket channel...',
      });

      await channel.send(
        `This ticket has been **accepted** by ${interaction.user}.\nReason: ${reason}`,
      );

      // Clean up the corresponding logged ticket created by the ticket panel so it
      // no longer appears as pending in the ticket list channel.
      try {
        const channelName = channel.name ?? '';
        let ticketId = null;
        let reporterId = null;

        // 1) Try to extract from channel name, e.g. "Report-ticket(ABC123)".
        const nameMatch = channelName.match(/\(([^)]+)\)\s*$/);
        if (nameMatch) {
          ticketId = nameMatch[1];
        }

        // 2) Fallback: if we still don't have an ID, inspect the original ticket
        //    embed for a Ticket ID field or parse it from the title, and try to
        //    recover the reporting user from the embed fields.
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

          const reporterField =
            fields.find(field => field.name === 'Reporter') ??
            fields.find(field => field.name === 'User');
          const reporterValue = reporterField?.value ?? '';
          const reporterMatch = reporterValue.match(/\((\d{5,})\)\s*$/);
          if (reporterMatch) {
            reporterId = reporterMatch[1];
          }
        }

        ticketIdForLog = ticketId ?? null;

        if (reporterId) {
          reporterIdForStats = reporterId;
        }

        if (ticketId) {
          const stored = ticketState.get(ticketId);
          if (stored) {
            storedTicket = stored;
            if (!reporterId && typeof stored.reporterTag === 'string') {
              const storedMatch = stored.reporterTag.match(/\((\d{5,})\)\s*$/);
              if (storedMatch) {
                reporterId = storedMatch[1];
                reporterIdForStats = reporterId;
              }
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
          '[tickets] Failed to clean up logged ticket when accepting ticket:',
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
          'Error deleting original ticket embed when accepting ticket:',
          error,
        );
      }

      // Log the final decision (Accepted) in the ticket decision log channel.
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
            const ticketIdValue = ticketIdForLog ?? channel.id;

            const fields = [
              { name: 'Ticket ID', value: String(ticketIdValue), inline: true },
              { name: 'Decision', value: 'Accepted', inline: true },
              {
                name: 'Staff',
                value: `${staffUser.tag} (${staffUser.id})`,
                inline: false,
              },
              {
                name: 'Reason for acceptance',
                value: String(reason || 'Not provided.').trim() || 'Not provided.',
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
              .setColor(0x002ecc71)
              .addFields(fields)
              .setTimestamp(new Date());

            await decisionChannel.send({ embeds: [embed] });

            if (reporterIdForStats && guild) {
              try {
                const member = await guild.members
                  .fetch(reporterIdForStats)
                  .catch(() => null);

                let isModerator = false;
                if (member && member.permissions) {
                  const perms = member.permissions;
                  isModerator =
                    perms.has(PermissionFlagsBits.ModerateMembers) ||
                    perms.has(PermissionFlagsBits.ManageGuild) ||
                    perms.has(PermissionFlagsBits.ManageChannels) ||
                    perms.has(PermissionFlagsBits.BanMembers) ||
                    perms.has(PermissionFlagsBits.KickMembers);
                }

                if (!isModerator) {
                  incrementAcceptedTickets({
                    guildId: guild.id,
                    userId: reporterIdForStats,
                  });
                }
              } catch (error) {
                console.error(
                  '[tickets] Failed to update accepted ticket stats when accepting ticket:',
                  error,
                );
              }
            }
          }
        }
      } catch (error) {
        console.error(
          '[tickets] Failed to log accepted ticket decision from /accept_ticket:',
          error,
        );
      }

      if (storedTicket) {
        dmTicketPresenter(interaction.client, storedTicket, {
          decision: 'Accepted',
          reason,
        });
      }

      setTimeout(() => {
        channel
          .delete(`Ticket accepted by ${interaction.user.tag}: ${reason}`)
          .catch(() => {
            // ignore delete failures
          });
      }, 5000);
    } catch (error) {
      console.error('Error executing /accept_ticket:', error);
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({
            content:
              'There was an error while trying to accept and close this ticket.',
          });
        } else if (!interaction.replied) {
          await interaction.reply({
            content:
              'There was an error while trying to accept and close this ticket.',
            ephemeral: true,
          });
        }
      } catch {
        // ignore follow-up failures
      }
    }
  },
};
