const {
  SlashCommandBuilder,
} = require('discord.js');

const tsState = require('../../ts_state');
const tsLeaderboardState = require('../../ts_leaderboard_state');
const { buildTsLeaderboardEmbed } = require('../../ts_leaderboard_lib');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ts_leaderboard')
    .setDescription('Post a live TS leaderboard embed (auto-updates).')
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const channel = interaction.channel;
    if (!channel || !channel.isTextBased()) {
      await interaction.reply({ content: "I can't post a leaderboard in this channel.", ephemeral: true });
      return;
    }

    const guildId = interaction.guild.id;
    const testers = tsState.listTesters(guildId);

    if (!testers.length) {
      await interaction.reply({
        content: 'No TS data yet. Run `/ts_setup` first (or use `/give_ts` to seed someone).',
        ephemeral: true,
      });
      return;
    }

    const embed = buildTsLeaderboardEmbed(guildId, testers);

    const message = await interaction.reply({ embeds: [embed], fetchReply: true });

    // Persist so the bot can keep refreshing it, even after restarts.
    try {
      tsLeaderboardState.addLeaderboard(guildId, channel.id, message.id, interaction.user?.id);
    } catch {
      // ignore persistence failures
    }
  },
};
