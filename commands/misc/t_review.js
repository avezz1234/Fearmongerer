const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { ticketState } = require('../../ticket_state');

// NOTE: This must match the TICKET_DECISION_LOG_CHANNEL_ID constant in index.js.
const TICKET_DECISION_LOG_CHANNEL_ID = '1447705274243616809';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('t_review')
    .setDescription('Review a ticket by its ID.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('ticket_id')
        .setDescription('The ticket ID to review, e.g. ABC123.')
        .setRequired(true),
    ),
  async execute(interaction) {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true,
      });
      return;
    }

    const rawId = interaction.options.getString('ticket_id');
    const ticketId = (rawId || '').trim().toUpperCase();

    if (!ticketId) {
      await interaction.reply({
        content: 'Please provide a valid ticket ID.',
        ephemeral: true,
      });
      return;
    }

    // 1) Check in-memory ticket state (open tickets only)
    const stored = ticketState.get(ticketId) ?? null;

    // 2) Find any active ticket channels whose name contains (TICKETID)
    const matchingChannels = guild.channels.cache.filter(channel => {
      try {
        return (
          channel &&
          typeof channel.name === 'string' &&
          channel.name.includes(`(${ticketId})`) &&
          channel.isTextBased()
        );
      } catch {
        return false;
      }
    });

    // 3) Look for decision log entries in the ticket decision log channel
    let decisions = [];
    try {
      const logChannel = await guild.channels.fetch(TICKET_DECISION_LOG_CHANNEL_ID);
      if (logChannel && logChannel.isTextBased()) {
        const fetched = await logChannel.messages.fetch({ limit: 100 });

        decisions = fetched
          .filter(msg => Array.isArray(msg.embeds) && msg.embeds.length > 0)
          .map(msg => {
            const embed = msg.embeds[0];
            const fields = embed.fields ?? [];
            const ticketField = fields.find(f => f.name === 'Ticket ID');

            if (!ticketField) return null;

            const value = (ticketField.value || '').trim().toUpperCase();
            if (value !== ticketId) return null;

            const decisionField = fields.find(f => f.name === 'Decision');
            const reasonField = fields.find(f => f.name === 'Reason for denial');

            return {
              message: msg,
              decision: decisionField ? decisionField.value : 'Unknown',
              reason: reasonField ? reasonField.value : null,
              at: msg.createdAt ?? new Date(msg.createdTimestamp || Date.now()),
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.at - b.at);
      }
    } catch {
      // If the log channel cannot be fetched, we simply omit decisions from the summary.
    }

    if (!stored && matchingChannels.size === 0 && decisions.length === 0) {
      await interaction.reply({
        content: `No information found for ticket ID **${ticketId}** in this server.`,
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Ticket Review — ${ticketId}`)
      .setColor(0x002b2d31)
      .setTimestamp(new Date());

    // Basic/open metadata from ticketState if present
    if (stored) {
      embed.addFields({
        name: 'Stored metadata',
        value: [
          stored.type ? `Type: **${stored.type}**` : null,
          stored.reporterTag ? `Reporter: **${stored.reporterTag}**` : null,
          stored.rulebreaker ? `Rulebreaker: **${stored.rulebreaker}**` : null,
          stored.evidence ? `Evidence: ${stored.evidence}` : null,
          stored.reason ? `Reason: ${stored.reason}` : null,
          stored.description ? `Description: ${stored.description}` : null,
        ]
          .filter(Boolean)
          .join('\n') || 'No additional stored metadata.',
        inline: false,
      });
    }

    // Active ticket channels
    if (matchingChannels.size > 0) {
      const channelList = matchingChannels
        .map(ch => `${ch.toString()} (ID: ${ch.id})`)
        .join('\n');

      embed.addFields({
        name: 'Active ticket channels',
        value: channelList.slice(0, 1024),
        inline: false,
      });
    } else {
      embed.addFields({
        name: 'Active ticket channels',
        value: 'None found (ticket channel may have been closed or renamed).',
        inline: false,
      });
    }

    // Decision history
    if (decisions.length > 0) {
      const lines = decisions.map(entry => {
        const when = Math.floor(entry.at.getTime() / 1000);
        const decisionText = entry.decision || 'Unknown';
        const reasonText = entry.reason ? `\nReason: ${entry.reason}` : '';
        return `- <t:${when}:f> — **${decisionText}** by ${entry.message.author} ${reasonText}`;
      });

      embed.addFields({
        name: 'Decision history',
        value: lines.join('\n').slice(0, 1024),
        inline: false,
      });
    } else {
      embed.addFields({
        name: 'Decision history',
        value: 'No decisions logged for this ticket ID.',
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
