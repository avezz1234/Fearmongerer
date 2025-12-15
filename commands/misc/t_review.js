const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { ticketState } = require('../../ticket_state');
const { getArchivedTicket } = require('../../ticket_archive_state');

// NOTE: This must match the TICKET_DECISION_LOG_CHANNEL_ID constant in index.js.
const TICKET_DECISION_LOG_CHANNEL_ID = '1447705274243616809';

function truncateText(value, maxLen) {
  const text = value == null ? '' : String(value);
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

function formatTicketSubmission(stored) {
  if (!stored || typeof stored !== 'object') return [];
  const type = stored.type;
  const lines = [];

  if (type === 'report') {
    if (stored.reporterTag) lines.push(`**Reporter:** ${stored.reporterTag}`);
    if (stored.rulebreaker) lines.push(`**Reported user:** ${truncateText(stored.rulebreaker, 512)}`);
    if (stored.evidence) lines.push(`**Evidence:** ${truncateText(stored.evidence, 512)}`);
    if (stored.reason) lines.push(`**Reason:** ${truncateText(stored.reason, 900)}`);
    if (stored.notes) lines.push(`**Additional info:** ${truncateText(stored.notes, 900)}`);
    return lines;
  }

  if (type === 'appeal') {
    if (stored.reporterTag) lines.push(`**User:** ${stored.reporterTag}`);
    if (stored.robloxUsername) lines.push(`**Roblox username:** ${truncateText(stored.robloxUsername, 256)}`);
    if (stored.whenBanned) lines.push(`**When banned (approx):** ${truncateText(stored.whenBanned, 512)}`);
    if (stored.whyBanned) lines.push(`**Why banned:** ${truncateText(stored.whyBanned, 900)}`);
    if (stored.whyReturn) lines.push(`**Why should we unban:** ${truncateText(stored.whyReturn, 900)}`);
    return lines;
  }

  if (type === 'other') {
    if (stored.reporterTag) lines.push(`**User:** ${stored.reporterTag}`);
    if (stored.description) lines.push(`**Request:** ${truncateText(stored.description, 900)}`);
    return lines;
  }

  // Fallback: show a few common fields if present.
  if (stored.reporterTag) lines.push(`**User:** ${stored.reporterTag}`);
  if (stored.description) lines.push(`**Description:** ${truncateText(stored.description, 900)}`);
  if (stored.reason) lines.push(`**Reason:** ${truncateText(stored.reason, 900)}`);
  return lines;
}

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

    // 1) Check in-memory ticket state (open tickets)
    // 2) Fallback to on-disk archive (closed/deleted tickets)
    const stored = ticketState.get(ticketId) ?? getArchivedTicket(ticketId) ?? null;

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
      const submissionLines = formatTicketSubmission(stored);
      if (submissionLines.length) {
        embed.addFields({
          name: 'Ticket submission',
          value: submissionLines.join('\n').slice(0, 1024),
          inline: false,
        });
      }

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
