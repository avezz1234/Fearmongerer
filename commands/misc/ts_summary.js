const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');

const tsState = require('../../ts_state');

const TESTER_ROLE_ID = '1447218798112538654';

function buildLeaderboardLines(rows, maxChars) {
  const lines = [];
  let used = 0;

  for (const line of rows) {
    const nextUsed = used + (lines.length ? 1 : 0) + line.length;
    if (nextUsed > maxChars) {
      break;
    }
    lines.push(line);
    used = nextUsed;
  }

  return lines;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ts_summary')
    .setDescription('Show TS leaderboard for all tracked testers.')
    .setDMPermission(false)
    .addBooleanOption(option =>
      option
        .setName('ping')
        .setDescription('Ping testers')
        .setRequired(false),
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const guildId = interaction.guild.id;
    const testers = tsState.listTesters(guildId);

    const ping = interaction.options.getBoolean('ping', false) ?? false;

    if (!testers.length) {
      await interaction.reply({
        content: 'No TS data yet. Run `/ts_setup` first (or use `/give_ts` to seed someone).',
        ephemeral: true,
      });
      return;
    }

    testers.sort((a, b) => {
      if (b.ts !== a.ts) return b.ts - a.ts;
      return String(a.userId).localeCompare(String(b.userId));
    });

    const rows = testers.map((t, idx) => {
      const rank = idx + 1;
      return `${rank}. <@${t.userId}> — **${t.ts} TS**`;
    });

    const descriptionLimit = 3900;
    const lines = buildLeaderboardLines(rows, descriptionLimit);

    const embed = new EmbedBuilder()
      .setTitle('Tester Score (TS) Leaderboard')
      .setColor(0x005865f2)
      .setDescription(lines.join('\n'))
      .setFooter({ text: lines.length < rows.length ? `Showing ${lines.length} of ${rows.length}` : `${rows.length} total` })
      .setTimestamp(new Date());

    const content = ping ? `<@&${TESTER_ROLE_ID}>` : undefined;
    const allowedMentions = ping
      ? { parse: [], roles: [TESTER_ROLE_ID], users: [] }
      : { parse: [] };

    await interaction.reply({ content, embeds: [embed], allowedMentions });
  },
};
