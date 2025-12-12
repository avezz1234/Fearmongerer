const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ticketState } = require('../../ticket_state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('my_tickets')
    .setDescription('Show all of your tickets and their current moderation phase.')
    .setDMPermission(false),
  async execute(interaction) {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true,
      });
      return;
    }

    const user = interaction.user;
    const userId = user.id;

    // Collect all tickets in ticketState that belong to this user.
    const userTickets = [];

    for (const [ticketId, record] of ticketState.entries()) {
      if (!record || typeof ticketId !== 'string') continue;

      let reporterId = record.reporterId ?? null;

      if (!reporterId && typeof record.reporterTag === 'string') {
        const match = record.reporterTag.match(/\((\d{5,})\)\s*$/);
        if (match) {
          reporterId = match[1];
        }
      }

      if (reporterId !== userId) {
        continue;
      }

      const phase =
        typeof record.phase === 'number' && Number.isFinite(record.phase)
          ? record.phase
          : 1;

      let phaseLabel = '1 — Not yet reviewed';
      if (phase === 2) {
        phaseLabel = '2 — In Review';
      } else if (phase === 3) {
        phaseLabel = '3 — Ticket has been attended to and resolved';
      }

      let typeLabel = 'Ticket';
      if (record.type === 'report') typeLabel = 'Report';
      else if (record.type === 'appeal') typeLabel = 'Appeal';
      else if (record.type === 'other') typeLabel = 'Support';

      userTickets.push({
        ticketId,
        typeLabel,
        phase,
        phaseLabel,
      });
    }

    if (userTickets.length === 0) {
      await interaction.reply({
        content:
          'You do not currently have any tickets recorded in this server (since the last bot restart).',
        ephemeral: true,
      });
      return;
    }

    userTickets.sort((a, b) => a.ticketId.localeCompare(b.ticketId));

    const lines = userTickets.map(entry => {
      return `• [${entry.typeLabel}] **${entry.ticketId}** — Phase ${entry.phaseLabel}`;
    });

    const description = lines.join('\n').slice(0, 4096);

    const embed = new EmbedBuilder()
      .setTitle('Your Tickets')
      .setColor(0x2b2d31)
      .setDescription(description)
      .addFields({
        name: 'Phase legend',
        value:
          '1 — Not yet reviewed\n2 — In Review\n3 — Ticket has been attended to and resolved',
        inline: false,
      })
      .setTimestamp(new Date());

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};
