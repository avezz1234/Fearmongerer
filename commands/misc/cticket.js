const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAcceptedTicketsCount } = require('../../ticket_stats');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ctickets')
    .setDescription('See how many accepted tickets you or another user has!')
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to check; defaults to yourself')
        .setRequired(false),
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used inside a server.',
        ephemeral: true,
      });
      return;
    }

    const targetUser =
      interaction.options.getUser('user') ?? interaction.user;

    const guildId = interaction.guild.id;
    const userId = targetUser.id;

    try {
      const count = getAcceptedTicketsCount({ guildId, userId });

      const label = targetUser.tag ?? targetUser.username ?? `<@${userId}>`;
      const description = `${label} has ${count} accepted ticket${
        count === 1 ? '' : 's'
      }!`;

      const embed = new EmbedBuilder()
        .setColor(0x003498db)
        .setDescription(description)
        .setTimestamp(new Date());

      await interaction.reply({ embeds: [embed], ephemeral: false });
    } catch (error) {
      console.error('Error executing /cticket:', error);
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content:
              'There was an error while checking accepted ticket stats for that user.',
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content:
              'There was an error while checking accepted ticket stats for that user.',
            ephemeral: true,
          });
        }
      } catch {
        // ignore follow-up failures
      }
    }
  },
};
